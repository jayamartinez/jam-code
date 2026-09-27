import { createContext, useContext, useSyncExternalStore } from 'react';
import {
  DEFAULT_APPEARANCE,
  type AppearanceSettings,
  type JamTransport,
  type Wallpaper,
} from '@jam/protocol';
import { applyAppearance, cacheAppearance, cachedAppearance } from './apply';
import { normalizeAppearance } from './resolve';
import { paletteFromImage, type WallpaperPalette } from './palette';

/**
 * Client projection of the runtime's appearance record.
 *
 * The runtime owns the record; this store applies it, lets Settings change it
 * immediately, and writes it back. Slider drags produce many changes, so
 * writes are coalesced: the screen updates on every change, the runtime on
 * the last one.
 */

export interface AppearanceSnapshot {
  appearance: AppearanceSettings;
  wallpaper?: Wallpaper;
  /** Colours sampled from the wallpaper, for "Match colours to image". Not stored. */
  palette?: WallpaperPalette;
  /** The runtime's record has been read (or failed to be). */
  loaded: boolean;
  /** Why the last save failed, until the next one succeeds. */
  error: string | null;
}

const SAVE_DELAY_MS = 300;
/** Where the editor font preferences lived before appearance was a runtime setting. */
const LEGACY_EDITOR_KEY = 'jam.editorPreferences';

function legacyEditorPreferences(): Partial<AppearanceSettings> | undefined {
  try {
    const stored = localStorage.getItem(LEGACY_EDITOR_KEY);
    if (!stored) return undefined;
    const value = JSON.parse(stored) as {
      fontFamily?: unknown;
      fontSize?: unknown;
      lineHeight?: unknown;
    };
    return {
      ...(typeof value.fontFamily === 'string' ? { codeFont: value.fontFamily } : {}),
      ...(typeof value.fontSize === 'number' ? { codeFontSize: value.fontSize } : {}),
      ...(typeof value.lineHeight === 'number' ? { codeLineHeight: value.lineHeight } : {}),
    };
  } catch {
    return undefined;
  }
}

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Appearance could not be saved.';

export class AppearanceStore {
  private snapshot: AppearanceSnapshot;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Changed locally before the runtime answered; its record must not overwrite that. */
  private touched = false;

  constructor(private readonly transport: JamTransport) {
    this.snapshot = {
      appearance: cachedAppearance() ?? DEFAULT_APPEARANCE,
      loaded: false,
      error: null,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(next: Partial<AppearanceSnapshot>) {
    const wallpaperChanged = 'wallpaper' in next && next.wallpaper !== this.snapshot.wallpaper;
    this.snapshot = { ...this.snapshot, ...next };
    if (wallpaperChanged) {
      this.snapshot = { ...this.snapshot, palette: undefined };
      void this.sample(this.snapshot.wallpaper);
    }
    applyAppearance(this.snapshot.appearance, this.snapshot.wallpaper, this.snapshot.palette);
    this.listeners.forEach((listener) => listener());
  }

  /** Samples a wallpaper's colours once, off the change path. */
  private async sample(wallpaper: Wallpaper | undefined) {
    if (!wallpaper) return;
    try {
      const palette = await paletteFromImage(wallpaper.dataUrl);
      if (palette && this.snapshot.wallpaper === wallpaper) this.set({ palette });
    } catch {
      // Without a palette, "Match colours to image" keeps the theme's colours.
    }
  }

  async load() {
    try {
      const stored = await this.transport.request('appearance.get', {});
      if (this.touched) {
        this.set({ wallpaper: stored.wallpaper, loaded: true });
        return;
      }
      let appearance: AppearanceSettings;
      if (stored.appearance) appearance = normalizeAppearance(stored.appearance);
      else {
        // First run with a runtime record: carry the old per-profile editor font over once.
        const legacy = legacyEditorPreferences();
        appearance = normalizeAppearance({ ...DEFAULT_APPEARANCE, ...legacy });
        if (legacy) this.schedule(0);
      }
      cacheAppearance(appearance);
      this.set({ appearance, wallpaper: stored.wallpaper, loaded: true });
    } catch (cause) {
      this.set({ loaded: true, error: message(cause) });
    }
  }

  update(changes: Partial<AppearanceSettings>) {
    this.touched = true;
    const appearance = normalizeAppearance({ ...this.snapshot.appearance, ...changes });
    if ('paneOpacity' in changes && changes.paneOpacity === undefined)
      delete appearance.paneOpacity;
    cacheAppearance(appearance);
    this.set({ appearance });
    this.schedule(SAVE_DELAY_MS);
  }

  reset() {
    this.update({ ...DEFAULT_APPEARANCE, paneOpacity: undefined });
  }

  /** Stores a copy of the image in the runtime; the original file is never referenced. */
  async setWallpaper(wallpaper: Wallpaper | undefined) {
    await this.transport.request('appearance.setWallpaper', wallpaper ? { wallpaper } : {});
    this.set({ wallpaper, error: null });
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save();
    }, delay);
  }

  /** Saves run one at a time, each sending the latest record, so an older write never lands last. */
  private saving: Promise<void> = Promise.resolve();
  private save() {
    this.saving = this.saving.then(() => this.write());
    return this.saving;
  }

  private async write() {
    try {
      await this.transport.request('appearance.update', { appearance: this.snapshot.appearance });
      try {
        localStorage.removeItem(LEGACY_EDITOR_KEY);
      } catch {
        // Nothing to clean up in a profile without storage.
      }
      if (this.snapshot.error) this.set({ error: null });
    } catch (cause) {
      this.set({ error: message(cause) });
    }
  }

  /** Writes a pending change immediately, e.g. when the window is about to close. */
  flush() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.save();
  }

  dispose() {
    this.flush();
    this.listeners.clear();
  }
}

export const AppearanceContext = createContext<AppearanceStore | null>(null);

const fallback: AppearanceSnapshot = { appearance: DEFAULT_APPEARANCE, loaded: false, error: null };
const noop = () => () => {};

/** The current appearance. Surfaces that cannot read CSS (xterm, CodeMirror metrics) use this. */
export function useAppearance(): AppearanceSnapshot {
  const store = useContext(AppearanceContext);
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    store?.getSnapshot ?? (() => fallback),
    store?.getSnapshot ?? (() => fallback),
  );
}

export function useAppearanceStore(): AppearanceStore | null {
  return useContext(AppearanceContext);
}
