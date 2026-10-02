import type { AppearanceSettings, Wallpaper } from '@jam/protocol';
import type { WallpaperPalette } from './palette';
import { appearanceTokens, normalizeAppearance, tokenStylesheet } from './resolve';

/**
 * The single place appearance reaches the DOM.
 *
 * Tokens go into one `<style>` element, so a theme change is one style
 * recalculation rather than a hundred `setProperty` calls, and no component
 * re-renders to change color. The wallpaper image is set separately and only
 * when it changes, so moving a slider never re-parses image data.
 */

const STYLE_ID = 'jam-appearance';
/** A projection for first paint only; the runtime's record is authoritative. */
const CACHE_KEY = 'jam.appearance';

let appliedWallpaper: string | undefined;

export function applyAppearance(
  appearance: AppearanceSettings,
  wallpaper?: Wallpaper,
  palette?: WallpaperPalette,
) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const { tokens, scheme, background } = appearanceTokens(appearance, {
    present: !!wallpaper,
    ...(palette ? { palette } : {}),
  });
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  const css = tokenStylesheet(tokens, scheme);
  if (style.textContent !== css) style.textContent = css;
  root.dataset.theme = appearance.theme;
  root.dataset.scheme = scheme;
  root.dataset.background = background;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', scheme);
  const image = wallpaper?.dataUrl;
  if (image !== appliedWallpaper) {
    appliedWallpaper = image;
    if (image) root.style.setProperty('--wallpaper-image', `url("${image}")`);
    else root.style.removeProperty('--wallpaper-image');
  }
}

export function cacheAppearance(appearance: AppearanceSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(appearance));
  } catch {
    // First paint falls back to Nightglass; the runtime record still applies.
  }
}

export function cachedAppearance(): AppearanceSettings | undefined {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    return stored ? normalizeAppearance(JSON.parse(stored)) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Call before the first render so a reader on Frost does not see a flash of
 * Nightglass while the runtime answers. The wallpaper is not cached; it
 * arrives with the runtime's record a moment later.
 */
export function applyCachedAppearance() {
  const cached = cachedAppearance();
  if (cached) applyAppearance(cached);
}
