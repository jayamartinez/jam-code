import { useMemo, useState } from 'react';
import {
  APPEARANCE,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  SURFACE_ROLES,
  customThemeRef,
  parseCustomThemeRef,
  type AccentId,
  type AppearanceSettings,
  type BackgroundMode,
  type BackgroundPattern,
  type CustomTheme,
  type SurfaceRole,
  type ThemeRef,
} from '@jam/protocol';
import { useAppearance, useAppearanceStore } from '../appearance/store';
import { ACCENTS, legible, type Scheme } from '../appearance/themes';
import { MONO_FONTS, UI_FONTS } from '../appearance/fonts';
import { WALLPAPER_ACCEPT, prepareWallpaper } from '../appearance/wallpaper';
import { drawnSurfaces, effectTokens, matchesImage, themeOf } from '../appearance/resolve';
import {
  canAddCustomTheme,
  colorsFromDefinition,
  newCustomThemeId,
  ownCopyName,
  withThemeColor,
} from '../appearance/custom';
import { libraryFamilies, libraryOrder } from '../appearance/library';
import { THEME_FILE_BYTES, exportTheme, importTheme } from '../appearance/import';
import { Card, Row, Section, Segmented, Toggle } from './settings/controls';
import { ColorInput, FontSelect, NumberSelect, Slider } from './appearance/controls';
import { Library } from './appearance/Library';
import { ThemeColors } from './appearance/ThemeColors';
import { Stage } from './appearance/Stage';
import { ThemeEditor, type ThemeDraft } from './appearance/ThemeEditor';

/**
 * Settings → Appearance, from the Settings v2 frames: a live preview stage,
 * Interface (accent and type), Background & surfaces, and the theme library
 * with the reader's own themes. The theme editor replaces the page while a
 * theme is being made, edited or imported. Every change applies at once and
 * the runtime saves it.
 */

type Update = (changes: Partial<AppearanceSettings>) => void;

function AccentPicker({ appearance, update }: { appearance: AppearanceSettings; update: Update }) {
  const theme = themeOf(appearance);
  const swatches: { id: AccentId; name: string; color: string }[] = [
    { id: 'theme', name: `${theme.name} accent`, color: theme.accent },
    ...ACCENTS.map((accent) => ({
      id: accent.id,
      name: accent.name,
      color: accent[theme.scheme][0],
    })),
  ];
  return (
    <span className="accent-picker" role="radiogroup" aria-label="Accent">
      {swatches.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          role="radio"
          aria-checked={appearance.accent === swatch.id}
          className={`accent-swatch ${appearance.accent === swatch.id ? 'selected' : ''} ${
            swatch.id === 'theme' ? 'theme-accent' : ''
          }`}
          title={swatch.name}
          aria-label={swatch.name}
          style={{ '--swatch': swatch.color } as React.CSSProperties}
          onClick={() => update({ accent: swatch.id })}
        />
      ))}
      <label
        className={`accent-swatch custom ${appearance.accent === 'custom' ? 'selected' : ''}`}
        title="Custom accent"
        style={{ '--swatch': legible(appearance.customAccent, theme) } as React.CSSProperties}
      >
        <input
          type="color"
          aria-label="Custom accent color"
          value={appearance.customAccent}
          onChange={(event) =>
            update({ accent: 'custom', customAccent: event.target.value.toLowerCase() })
          }
          onClick={() => appearance.accent !== 'custom' && update({ accent: 'custom' })}
        />
      </label>
    </span>
  );
}

type SurfacePreset = 'glass' | 'solid' | 'clear';

/**
 * Glass: the theme's own translucency, blurred over an image or pattern.
 * Solid: opaque sidebar and panes, no blur. Clear: an opaque sidebar and a
 * transparent main pane over an unblurred background, dimmed and faded so
 * text stays readable.
 */
const SURFACE_PRESETS: Record<
  SurfacePreset,
  (appearance: AppearanceSettings) => Partial<AppearanceSettings>
> = {
  glass: () => ({
    sidebarOpacity: undefined,
    paneOpacity: undefined,
    sidebarBlur: 24,
    paneBlur: 24,
  }),
  solid: () => ({ sidebarOpacity: 100, paneOpacity: 100 }),
  clear: (appearance) => ({
    sidebarOpacity: 100,
    paneOpacity: 0,
    paneBlur: 0,
    ...(appearance.backgroundFade ? {} : { backgroundFade: 55 }),
    // Text sits straight on the picture, so a full-brightness one is dimmed.
    ...(appearance.backgroundBrightness >= 100 ? { backgroundBrightness: 60 } : {}),
  }),
};

function surfacePreset(appearance: AppearanceSettings): SurfacePreset | 'custom' {
  const { sidebarOpacity, paneOpacity } = appearance;
  if (sidebarOpacity === undefined && paneOpacity === undefined) return 'glass';
  if (sidebarOpacity === 100 && paneOpacity === 100) return 'solid';
  if (sidebarOpacity === 100 && paneOpacity === 0) return 'clear';
  return 'custom';
}

const PATTERNS: { value: BackgroundPattern; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'halftone', label: 'Halftone' },
  { value: 'scanlines', label: 'Scanlines' },
  { value: 'grid', label: 'Grid' },
  { value: 'grain', label: 'Grain' },
];

const BACKGROUNDS: { value: BackgroundMode; label: string }[] = [
  { value: 'theme', label: 'Theme' },
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
];

function Disclosure({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`ap-disclosure ${open ? 'open' : ''}`}
      aria-expanded={open}
      onClick={onToggle}
    >
      {open ? 'Hide' : 'Adjust'}
      <span aria-hidden="true">›</span>
    </button>
  );
}

function BackgroundSection({
  appearance,
  update,
}: {
  appearance: AppearanceSettings;
  update: Update;
}) {
  const { wallpaper } = useAppearance();
  const store = useAppearanceStore();
  const theme = themeOf(appearance);
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [surfacesOpen, setSurfacesOpen] = useState(false);
  const [effectsOpen, setEffectsOpen] = useState(false);
  const preset = surfacePreset(appearance);

  const chooseImage = async (file: File | undefined) => {
    if (!file || !store) return;
    setWallpaperError(null);
    setPreparing(true);
    try {
      await store.setWallpaper(await prepareWallpaper(file));
      update({ background: 'image' });
    } catch (cause) {
      setWallpaperError(cause instanceof Error ? cause.message : 'That image could not be used.');
    } finally {
      setPreparing(false);
    }
  };

  const surface = (
    label: string,
    opacityKey: 'sidebarOpacity' | 'paneOpacity',
    blurKey: 'sidebarBlur' | 'paneBlur',
    own: number,
  ) => {
    const opacity = appearance[opacityKey] ?? own;
    return (
      <>
        <Row title={`${label} opacity`}>
          <Slider
            label={`${label} opacity`}
            value={opacity}
            range={APPEARANCE.limits[opacityKey]}
            unit="%"
            onChange={(value) => update({ [opacityKey]: value })}
          />
          <button
            type="button"
            className="sv-button quiet"
            disabled={appearance[opacityKey] === undefined}
            onClick={() => update({ [opacityKey]: undefined })}
          >
            Theme default
          </button>
        </Row>
        <Row title={`${label} blur`} sub={opacity >= 100 ? 'Off while opaque.' : undefined}>
          <Slider
            label={`${label} blur`}
            value={appearance[blurKey]}
            range={APPEARANCE_RANGES[blurKey]}
            unit="px"
            disabled={opacity >= 100}
            onChange={(value) => update({ [blurKey]: value })}
          />
        </Row>
      </>
    );
  };

  const effectsSummary = [
    PATTERNS.find((pattern) => pattern.value === appearance.backgroundPattern)?.label,
    appearance.backgroundFade ? `fade ${appearance.backgroundFade}%` : '',
    appearance.backgroundVignette ? `vignette ${appearance.backgroundVignette}%` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const pictured = (pattern: BackgroundPattern) => {
    const tokens = effectTokens({
      ...appearance,
      backgroundPattern: pattern,
      backgroundFade: 0,
      backgroundVignette: 0,
      patternStrength: Math.max(appearance.patternStrength, 45),
      patternSize: 3,
    });
    const layer = tokens['--wallpaper-effects'];
    return {
      backgroundImage: `${layer === 'none' ? '' : `${layer}, `}linear-gradient(135deg, var(--color-accent), var(--color-bg-base))`,
      backgroundSize: `${layer === 'none' ? '' : `${tokens['--wallpaper-effects-size']}, `}auto`,
    };
  };

  return (
    <Section label="Background & surfaces">
      <Card>
        <Row title="Background" sub="Drawn behind every pane.">
          <Segmented
            label="Background"
            value={appearance.background}
            options={BACKGROUNDS}
            onChange={(background) => update({ background })}
          />
        </Row>
        {appearance.background === 'solid' && (
          <Row title="Color">
            <ColorInput
              label="Background color"
              value={appearance.backgroundColor}
              onChange={(backgroundColor) => update({ backgroundColor })}
            />
          </Row>
        )}
        {appearance.background === 'gradient' && (
          <Row title="Gradient">
            <ColorInput
              label="Gradient start color"
              value={appearance.gradientFrom}
              onChange={(gradientFrom) => update({ gradientFrom })}
            />
            <ColorInput
              label="Gradient end color"
              value={appearance.gradientTo}
              onChange={(gradientTo) => update({ gradientTo })}
            />
            <Slider
              label="Gradient angle"
              value={appearance.gradientAngle}
              range={APPEARANCE_RANGES.gradientAngle}
              unit="°"
              onChange={(gradientAngle) => update({ gradientAngle })}
            />
          </Row>
        )}
        {appearance.background === 'image' && (
          <Row
            title="Image"
            sub={
              wallpaper
                ? `${wallpaper.name || 'Wallpaper'} · ${wallpaper.width}×${wallpaper.height}. JAM keeps its own copy.`
                : 'JAM keeps its own copy, at most 2560px.'
            }
          >
            <label className="sv-button file-button">
              {preparing ? 'Preparing…' : wallpaper ? 'Replace…' : 'Choose image…'}
              <input
                type="file"
                accept={WALLPAPER_ACCEPT}
                disabled={preparing}
                onChange={(event) => {
                  void chooseImage(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {wallpaper && (
              <button
                type="button"
                className="sv-button quiet"
                onClick={() =>
                  void store
                    ?.setWallpaper(undefined)
                    .then(() => update({ background: 'theme' }))
                    .catch((cause: unknown) =>
                      setWallpaperError(
                        cause instanceof Error ? cause.message : 'The image could not be removed.',
                      ),
                    )
                }
              >
                Remove
              </button>
            )}
          </Row>
        )}
        {appearance.background === 'image' && wallpaper && (
          <Row
            title="Match colors to image"
            sub="Accent from the image's most vivid color. The canvas, sidebar and raised surfaces take its dark tone."
          >
            <Toggle
              label="Match colors to image"
              on={appearance.autoColors}
              onChange={(autoColors) => update({ autoColors })}
            />
          </Row>
        )}
        {wallpaperError && (
          <p className="settings-error" role="alert">
            {wallpaperError}
          </p>
        )}
        {appearance.background !== 'theme' && (
          <>
            <Row title="Brightness">
              <Slider
                label="Background brightness"
                value={appearance.backgroundBrightness}
                range={APPEARANCE_RANGES.backgroundBrightness}
                unit="%"
                onChange={(backgroundBrightness) => update({ backgroundBrightness })}
              />
            </Row>
            <Row title="Saturation">
              <Slider
                label="Background saturation"
                value={appearance.backgroundSaturation}
                range={APPEARANCE_RANGES.backgroundSaturation}
                unit="%"
                onChange={(backgroundSaturation) => update({ backgroundSaturation })}
              />
            </Row>
            <Row title="Blur">
              <Slider
                label="Background blur"
                value={appearance.backgroundBlur}
                range={APPEARANCE_RANGES.backgroundBlur}
                unit="px"
                onChange={(backgroundBlur) => update({ backgroundBlur })}
              />
            </Row>
          </>
        )}
        <Row
          title="Surfaces"
          sub={
            theme.surfaces.pane[1] >= 100 && preset === 'glass'
              ? `${theme.name} draws opaque surfaces; Clear or a lower opacity lets the background through.`
              : 'The sidebar and panes. Adjust sets each on its own.'
          }
        >
          <Segmented
            label="Surfaces"
            value={preset}
            options={[
              { value: 'glass', label: 'Glass' },
              { value: 'solid', label: 'Solid' },
              { value: 'clear', label: 'Clear' },
            ]}
            onChange={(next) => next !== 'custom' && update(SURFACE_PRESETS[next](appearance))}
          />
          <Disclosure open={surfacesOpen} onToggle={() => setSurfacesOpen(!surfacesOpen)} />
        </Row>
        {surfacesOpen && (
          <>
            {surface('Sidebar', 'sidebarOpacity', 'sidebarBlur', theme.surfaces.sidebar[1])}
            {surface('Pane', 'paneOpacity', 'paneBlur', theme.surfaces.pane[1])}
          </>
        )}
        <Row title="Effects" sub="Pattern, fade and vignette over the background.">
          <span className="sv-mono">{effectsSummary}</span>
          <Disclosure open={effectsOpen} onToggle={() => setEffectsOpen(!effectsOpen)} />
        </Row>
        {effectsOpen && (
          <>
            <Row title="Pattern">
              <span className="option-tiles">
                {PATTERNS.map((pattern) => (
                  <button
                    key={pattern.value}
                    type="button"
                    className={`option-tile ${appearance.backgroundPattern === pattern.value ? 'selected' : ''}`}
                    aria-pressed={appearance.backgroundPattern === pattern.value}
                    onClick={() => update({ backgroundPattern: pattern.value })}
                  >
                    <span
                      className="option-picture"
                      style={pictured(pattern.value)}
                      aria-hidden="true"
                    />
                    <span>{pattern.label}</span>
                  </button>
                ))}
              </span>
            </Row>
            {appearance.backgroundPattern !== 'none' && (
              <>
                <Row title="Strength">
                  <Slider
                    label="Pattern strength"
                    value={appearance.patternStrength}
                    range={APPEARANCE_RANGES.patternStrength}
                    unit="%"
                    onChange={(patternStrength) => update({ patternStrength })}
                  />
                </Row>
                <Row title="Size">
                  <Slider
                    label="Pattern size"
                    value={appearance.patternSize}
                    range={APPEARANCE_RANGES.patternSize}
                    unit="px"
                    onChange={(patternSize) => update({ patternSize })}
                  />
                </Row>
              </>
            )}
            <Row title="Fade" sub="Towards the bottom edge.">
              <Slider
                label="Background fade"
                value={appearance.backgroundFade}
                range={APPEARANCE_RANGES.backgroundFade}
                unit="%"
                onChange={(backgroundFade) => update({ backgroundFade })}
              />
            </Row>
            <Row title="Vignette">
              <Slider
                label="Background vignette"
                value={appearance.backgroundVignette}
                range={APPEARANCE_RANGES.backgroundVignette}
                unit="%"
                onChange={(backgroundVignette) => update({ backgroundVignette })}
              />
            </Row>
          </>
        )}
      </Card>
    </Section>
  );
}

function download(theme: CustomTheme) {
  const url = URL.createObjectURL(new Blob([exportTheme(theme)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${newCustomThemeId(theme.name, [])}.jam-theme.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AppearanceSettings() {
  const { appearance, wallpaper, palette, error } = useAppearance();
  const store = useAppearanceStore();
  const update: Update = (changes) => store?.update(changes);
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const theme = themeOf(appearance);
  const families = useMemo(
    () => libraryFamilies(appearance.customThemes),
    [appearance.customThemes],
  );
  const order = useMemo(() => libraryOrder(families), [families]);
  const family = families.find((item) =>
    item.variants.some((variant) => variant.ref === appearance.theme),
  );
  const canAdd = canAddCustomTheme(appearance.customThemes);

  const setTheme = (ref: ThemeRef) => update({ theme: ref });

  const startNew = () => {
    const variants: Partial<CustomTheme> = {};
    for (const variant of family?.variants ?? [])
      variants[variant.theme.scheme] ??= colorsFromDefinition(variant.theme);
    variants[theme.scheme] = colorsFromDefinition(theme);
    setDraft({ isNew: true, theme: { id: '', name: `${theme.family} copy`, ...variants } });
  };

  const startImport = async (file: File) => {
    setImportError(null);
    try {
      if (file.size > THEME_FILE_BYTES) throw new Error('Theme files are limited to 512 KB.');
      const result = importTheme(await file.text(), file.name);
      setDraft({
        isNew: true,
        theme: { id: '', ...result.theme },
        report: { ...result, fileName: file.name },
      });
    } catch (cause) {
      setImportError(cause instanceof Error ? cause.message : 'That file could not be read.');
    }
  };

  const save = (saved: CustomTheme, scheme: Scheme) => {
    if (!draft) return;
    const list = appearance.customThemes;
    const id = draft.isNew ? newCustomThemeId(saved.name, list) : saved.id;
    const next = { ...saved, id };
    const target: Scheme = next[scheme] ? scheme : next.dark ? 'dark' : 'light';
    update({
      customThemes: draft.isNew
        ? [...list, next]
        : list.map((item) => (item.id === id ? next : item)),
      theme: customThemeRef(id, target),
    });
    setDraft(null);
  };

  const remove = (id: string) => {
    const active = parseCustomThemeRef(appearance.theme)?.id === id;
    update({
      customThemes: appearance.customThemes.filter((item) => item.id !== id),
      ...(active ? { theme: DEFAULT_APPEARANCE.theme } : {}),
    });
    setDraft(null);
  };

  // The theme's surface colors, changed in place: no draft and no Save.
  const image = { present: !!wallpaper, ...(palette ? { palette } : {}) };
  const matching = matchesImage(appearance, image);
  const mine = appearance.customThemes.find(
    (item) => item.id === parseCustomThemeRef(appearance.theme)?.id,
  );
  const copyName = ownCopyName(theme);
  const full = !mine && !canAdd && !appearance.customThemes.some((item) => item.name === copyName);
  const setSurface = (role: SurfaceRole, value: string) => {
    const next = withThemeColor(appearance, role, value);
    if (!next) return;
    update({
      ...next,
      // Set by hand while the image is matching: the image leaves it alone now.
      ...(matching && {
        ownSurfaces: SURFACE_ROLES.filter(
          (item) => item === role || appearance.ownSurfaces.includes(item),
        ),
      }),
    });
  };

  if (draft)
    return (
      <ThemeEditor
        key={draft.theme.id || 'new'}
        draft={draft}
        appearance={appearance}
        onSave={save}
        onDiscard={() => setDraft(null)}
        onExport={download}
        {...(draft.isNew ? {} : { onDelete: () => remove(draft.theme.id) })}
      />
    );

  return (
    <div className="sv-page wide appearance-settings">
      <Stage
        appearance={appearance}
        theme={theme}
        family={family}
        order={order}
        onTheme={setTheme}
      />
      {error && (
        <p className="settings-error" role="alert">
          Appearance could not be saved: {error}
        </p>
      )}

      <Section label="Interface">
        <Card>
          <Row
            title="Accent"
            sub={
              appearance.autoColors && appearance.background === 'image' && wallpaper
                ? 'Taken from the image while Match colors to image is on.'
                : 'Focus, selection and links. Status colors never change.'
            }
          >
            <AccentPicker appearance={appearance} update={update} />
          </Row>
          <Row title="Interface font">
            <FontSelect
              label="Interface font"
              value={appearance.uiFont}
              choices={UI_FONTS}
              onChange={(uiFont) => update({ uiFont })}
            />
            <NumberSelect
              label="Interface font size"
              value={appearance.uiFontSize}
              range={APPEARANCE_RANGES.uiFontSize}
              format={(size) => `${size}px`}
              onChange={(uiFontSize) => update({ uiFontSize })}
            />
          </Row>
          <Row title="Code font">
            <FontSelect
              label="Code font"
              value={appearance.codeFont}
              choices={MONO_FONTS}
              onChange={(codeFont) => update({ codeFont })}
            />
            <NumberSelect
              label="Code font size"
              value={appearance.codeFontSize}
              range={APPEARANCE_RANGES.codeFontSize}
              format={(size) => `${size}px`}
              onChange={(codeFontSize) => update({ codeFontSize })}
            />
            <NumberSelect
              label="Code line height"
              value={appearance.codeLineHeight}
              range={APPEARANCE_RANGES.codeLineHeight}
              format={(size) => `${size} line`}
              onChange={(codeLineHeight) => update({ codeLineHeight })}
            />
          </Row>
          <Row title="Terminal font">
            <FontSelect
              label="Terminal font"
              value={appearance.terminalFont}
              choices={MONO_FONTS}
              inherit="Same as code"
              onChange={(terminalFont) => update({ terminalFont })}
            />
            <NumberSelect
              label="Terminal font size"
              value={appearance.terminalFontSize}
              range={APPEARANCE_RANGES.terminalFontSize}
              format={(size) => `${size}px`}
              onChange={(terminalFontSize) => update({ terminalFontSize })}
            />
            <NumberSelect
              label="Terminal line height"
              value={appearance.terminalLineHeight}
              range={APPEARANCE_RANGES.terminalLineHeight}
              format={(size) => `${size} line`}
              onChange={(terminalLineHeight) => update({ terminalLineHeight })}
            />
          </Row>
        </Card>
      </Section>

      <BackgroundSection appearance={appearance} update={update} />

      {importError && (
        <p className="settings-error" role="alert">
          {importError}
        </p>
      )}
      <Library
        families={families}
        current={appearance.theme}
        scheme={theme.scheme}
        onTheme={setTheme}
        onNew={startNew}
        onImport={(file) => void startImport(file)}
        onEdit={(id) => {
          const custom = appearance.customThemes.find((item) => item.id === id);
          if (custom) setDraft({ isNew: false, theme: custom });
        }}
        canAdd={canAdd}
      />
      <ThemeColors
        surfaces={drawnSurfaces(appearance, image)}
        saved={
          mine
            ? `Changes save to your theme “${mine.name}”.`
            : full
              ? `${APPEARANCE.limits.customThemes} of your own themes is the most JAM Code keeps. Delete one to change these.`
              : `Changing a color saves ${theme.family} as your own theme, “${copyName}”.`
        }
        full={full}
        onChange={setSurface}
        {...(matching && {
          onFollowImage: (role: SurfaceRole) =>
            update({ ownSurfaces: appearance.ownSurfaces.filter((item) => item !== role) }),
        })}
        onAllColors={() => (mine ? setDraft({ isNew: false, theme: mine }) : startNew())}
      />

      <div className="ap-footer">
        {!canAdd && (
          <span className="sv-mono">
            {APPEARANCE.limits.customThemes} of your own themes is the most JAM keeps.
          </span>
        )}
        <span className="ap-spacer" />
        <button type="button" className="sv-button quiet" onClick={() => store?.reset()}>
          Reset appearance
        </button>
      </div>
    </div>
  );
}
