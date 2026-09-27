import { useMemo, useState, type ReactNode } from 'react';
import {
  APPEARANCE,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  FONT_FAMILY,
  type AccentId,
  type AppearanceSettings,
  type BackgroundMode,
  type BackgroundPattern,
  type ThemeId,
} from '@jam/protocol';
import { useAppearance, useAppearanceStore } from '../appearance/store';
import { ACCENTS, JAM_THEMES, THEMES, legible, type Scheme } from '../appearance/themes';
import { MONO_FONTS, UI_FONTS, isFontAvailable, type FontChoice } from '../appearance/fonts';
import { WALLPAPER_ACCEPT, prepareWallpaper } from '../appearance/wallpaper';
import { alpha } from '../appearance/color';
import { effectTokens } from '../appearance/resolve';

/**
 * Settings → Appearance.
 *
 * The page follows the Settings frames' vocabulary: a header, then raised
 * groups of rows with a label and hint on the left and the control on the
 * right; choices with a picture use the Snapshots frame's option tiles, and
 * themes use the tiles from Paper's "Same components, remapped tokens" frame.
 * Every change applies at once and is saved by the runtime.
 */

type Update = (changes: Partial<AppearanceSettings>) => void;

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-row appearance-row">
      <div>
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <span className="settings-controls">{children}</span>
    </div>
  );
}

function Slider({
  label,
  value,
  range: [min, max],
  unit,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  unit: string;
  onChange(value: number): void;
  disabled?: boolean;
}) {
  return (
    <span className="appearance-slider">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      />
      <output className="mono">
        {value}
        {unit}
      </output>
    </span>
  );
}

function sizes([min, max]: readonly [number, number], step = 1) {
  const values: number[] = [];
  for (let value = min; value <= max; value += step) values.push(value);
  return values;
}

function NumberSelect({
  label,
  value,
  range,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  range: readonly [number, number];
  suffix: string;
  onChange(value: number): void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {sizes(range).map((size) => (
        <option key={size} value={size}>
          {size}
          {suffix}
        </option>
      ))}
    </select>
  );
}

const OTHER = '\u0000other';

/**
 * A font family from a short list of common faces (marked when this computer
 * does not have them), or any installed family typed by name.
 */
function FontSelect({
  label,
  value,
  choices,
  inherit,
  onChange,
}: {
  label: string;
  value: string;
  choices: FontChoice[];
  /** Label for `''` when the field follows another font instead of the bundled one. */
  inherit?: string;
  onChange(value: string): void;
}) {
  const known = choices.some((choice) => choice.value === value);
  const [typing, setTyping] = useState(!known);
  const [draft, setDraft] = useState(known ? '' : value);
  const options = useMemo(
    () =>
      choices.map((choice) => ({
        ...choice,
        missing: !!choice.value && !isFontAvailable(choice.value),
      })),
    [choices],
  );
  const valid = FONT_FAMILY.test(draft) && draft.length <= APPEARANCE.limits.fontUtf16;
  return (
    <span className="font-select">
      <select
        aria-label={label}
        value={typing ? OTHER : value}
        onChange={(event) => {
          if (event.target.value === OTHER) {
            setTyping(true);
            return;
          }
          setTyping(false);
          onChange(event.target.value);
        }}
      >
        {inherit && <option value="">{inherit}</option>}
        {options
          .filter((choice) => !(inherit && choice.value === ''))
          .map((choice) => (
            <option key={choice.label} value={choice.value}>
              {choice.label}
              {choice.missing ? ' · not installed' : choice.note ? ` · ${choice.note}` : ''}
            </option>
          ))}
        <option value={OTHER}>Other installed font…</option>
      </select>
      {typing && (
        <input
          className="font-name"
          aria-label={`${label} name`}
          placeholder="Family name"
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => valid && draft.trim() && onChange(draft.trim())}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid && draft.trim()) onChange(draft.trim());
          }}
        />
      )}
      {typing && draft.trim() && valid && !isFontAvailable(draft.trim()) && (
        <small className="font-warning">Not found on this computer</small>
      )}
    </span>
  );
}

/**
 * Themes as a compact list: an "Aa" chip in the theme's own canvas and accent,
 * the name, and a check on the current one. Dark and light are two tabs, and a
 * theme's other version sits in the same place on the other tab.
 */
function ThemePicker({ appearance, update }: { appearance: AppearanceSettings; update: Update }) {
  const current = THEMES[appearance.theme];
  const [scheme, setScheme] = useState<Scheme>(current.scheme);
  const ids = APPEARANCE.themes.filter((id) => THEMES[id].scheme === scheme);
  const groups: [string, ThemeId[]][] = [
    ['JAM', ids.filter((id) => JAM_THEMES.includes(id))],
    ['Editor themes', ids.filter((id) => !JAM_THEMES.includes(id))],
  ];
  const counterpart = APPEARANCE.themes.find(
    (id) => THEMES[id].family === current.family && THEMES[id].scheme !== current.scheme,
  );
  return (
    <div className="theme-picker">
      <div className="theme-picker-bar">
        <span className="view-capsule" role="tablist" aria-label="Theme brightness">
          {(['dark', 'light'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={scheme === option}
              className={scheme === option ? 'active' : ''}
              onClick={() => setScheme(option)}
            >
              {option === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </span>
        {counterpart && (
          <button
            type="button"
            className="button quiet"
            onClick={() => {
              update({ theme: counterpart });
              setScheme(THEMES[counterpart].scheme);
            }}
          >
            Switch to {THEMES[counterpart].name}
          </button>
        )}
      </div>
      {groups.map(([label, group]) =>
        group.length ? (
          <div key={label} className="theme-group">
            <div className="settings-group-label">{label}</div>
            <div className="theme-list" role="radiogroup" aria-label={`${label} themes`}>
              {group.map((id) => {
                const theme = THEMES[id];
                const selected = appearance.theme === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`theme-row ${selected ? 'selected' : ''}`}
                    onClick={() => update({ theme: id })}
                  >
                    <span
                      className="theme-chip"
                      aria-hidden="true"
                      style={{
                        backgroundColor: theme.surfaces.pane[0],
                        backgroundImage: theme.glow,
                        borderColor: alpha(theme.tint, 14),
                        color: theme.accentRoles?.strong ?? theme.accent,
                      }}
                    >
                      Aa
                    </span>
                    <span className="theme-row-name">{theme.name}</span>
                    <small>{theme.note}</small>
                    <span className="theme-row-check" aria-hidden="true">
                      {selected ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

function AccentPicker({ appearance, update }: { appearance: AppearanceSettings; update: Update }) {
  const theme = THEMES[appearance.theme];
  const swatches: { id: AccentId; name: string; colour: string }[] = [
    { id: 'theme', name: `${theme.name} accent`, colour: theme.accent },
    ...ACCENTS.map((accent) => ({
      id: accent.id,
      name: accent.name,
      colour: accent[theme.scheme][0],
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
          style={{ '--swatch': swatch.colour } as React.CSSProperties}
          onClick={() => update({ accent: swatch.id })}
        />
      ))}
      <label
        className={`accent-swatch custom ${appearance.accent === 'custom' ? 'selected' : ''}`}
        title="Custom accent"
        style={
          {
            '--swatch': legible(appearance.customAccent, theme),
          } as React.CSSProperties
        }
      >
        <input
          type="color"
          aria-label="Custom accent colour"
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

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange(on: boolean): void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
    />
  );
}

type SurfacePreset = 'glass' | 'solid' | 'clear';

/**
 * Glass: the theme's own translucency, blurred over an image or pattern.
 * Solid: opaque sidebar and panes, no blur. Clear: an opaque sidebar and a
 * transparent main pane over an unblurred background, dimmed and faded so text
 * stays readable — a picture you work on, not behind glass.
 */
const SURFACE_PRESETS: {
  id: SurfacePreset;
  label: string;
  changes(appearance: AppearanceSettings): Partial<AppearanceSettings>;
}[] = [
  {
    id: 'glass',
    label: 'Glass',
    changes: () => ({
      sidebarOpacity: undefined,
      paneOpacity: undefined,
      sidebarBlur: 24,
      paneBlur: 24,
    }),
  },
  {
    id: 'solid',
    label: 'Solid',
    changes: () => ({ sidebarOpacity: 100, paneOpacity: 100 }),
  },
  {
    id: 'clear',
    label: 'Clear',
    changes: (appearance) => ({
      sidebarOpacity: 100,
      paneOpacity: 0,
      paneBlur: 0,
      ...(appearance.backgroundFade ? {} : { backgroundFade: 55 }),
      // Text sits straight on the picture, so a full-brightness one is dimmed.
      ...(appearance.backgroundBrightness >= 100 ? { backgroundBrightness: 60 } : {}),
    }),
  },
];

function surfacePreset(appearance: AppearanceSettings): SurfacePreset | null {
  const { sidebarOpacity, paneOpacity } = appearance;
  if (sidebarOpacity === undefined && paneOpacity === undefined) return 'glass';
  if (sidebarOpacity === 100 && paneOpacity === 100) return 'solid';
  if (sidebarOpacity === 100 && paneOpacity === 0) return 'clear';
  return null;
}

function SurfaceSettings({
  appearance,
  update,
}: {
  appearance: AppearanceSettings;
  update: Update;
}) {
  const theme = THEMES[appearance.theme];
  const preset = surfacePreset(appearance);
  const blurHint = 'Softens an image or pattern behind it. Off when the surface is opaque.';
  const surface = (
    label: string,
    opacityKey: 'sidebarOpacity' | 'paneOpacity',
    blurKey: 'sidebarBlur' | 'paneBlur',
    own: number,
  ) => {
    const opacity = appearance[opacityKey] ?? own;
    return (
      <>
        <Row label={`${label} opacity`}>
          <Slider
            label={`${label} opacity`}
            value={opacity}
            range={APPEARANCE.limits[opacityKey]}
            unit="%"
            onChange={(value) => update({ [opacityKey]: value })}
          />
          <button
            type="button"
            className="button quiet"
            disabled={appearance[opacityKey] === undefined}
            onClick={() => update({ [opacityKey]: undefined })}
          >
            Theme default
          </button>
        </Row>
        <Row label={`${label} blur`} hint={blurHint}>
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
  return (
    <section aria-labelledby="appearance-surfaces">
      <h3 id="appearance-surfaces" className="settings-group-label">
        Surfaces
      </h3>
      <div className="settings-card">
        <Row
          label="Style"
          hint={
            theme.surfaces.pane[1] >= 100 && preset === 'glass'
              ? `${theme.name} draws opaque surfaces; Clear or a lower opacity lets the background through.`
              : 'The sidebar and the main panes, each set on its own below.'
          }
        >
          <span className="option-tiles">
            {SURFACE_PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`option-tile ${preset === option.id ? 'selected' : ''}`}
                aria-pressed={preset === option.id}
                onClick={() => update(option.changes(appearance))}
              >
                <span
                  className={`option-picture surface-picture surface-${option.id}`}
                  aria-hidden="true"
                >
                  <i />
                  <b />
                </span>
                <span>{option.label}</span>
              </button>
            ))}
          </span>
        </Row>
        {surface('Sidebar', 'sidebarOpacity', 'sidebarBlur', theme.surfaces.sidebar[1])}
        {surface('Pane', 'paneOpacity', 'paneBlur', theme.surfaces.pane[1])}
      </div>
    </section>
  );
}

const PATTERNS: { id: BackgroundPattern; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'halftone', label: 'Halftone' },
  { id: 'scanlines', label: 'Scanlines' },
  { id: 'grid', label: 'Grid' },
  { id: 'grain', label: 'Grain' },
];

function EffectSettings({
  appearance,
  update,
}: {
  appearance: AppearanceSettings;
  update: Update;
}) {
  const pictured = (pattern: BackgroundPattern) => {
    const tokens = effectTokens({
      ...appearance,
      backgroundPattern: pattern,
      backgroundFade: 0,
      backgroundVignette: 0,
      patternStrength: Math.max(appearance.patternStrength, 45),
      patternSize: 3,
    });
    return {
      backgroundImage: `${tokens['--wallpaper-effects'] === 'none' ? '' : `${tokens['--wallpaper-effects']}, `}linear-gradient(135deg, var(--color-accent), var(--color-bg-base))`,
      backgroundSize: `${tokens['--wallpaper-effects'] === 'none' ? '' : `${tokens['--wallpaper-effects-size']}, `}auto`,
    };
  };
  return (
    <section aria-labelledby="appearance-effects">
      <h3 id="appearance-effects" className="settings-group-label">
        Effects
      </h3>
      <div className="settings-card">
        <Row label="Pattern" hint="Drawn over the background, under every pane.">
          <span className="option-tiles">
            {PATTERNS.map((pattern) => (
              <button
                key={pattern.id}
                type="button"
                className={`option-tile ${appearance.backgroundPattern === pattern.id ? 'selected' : ''}`}
                aria-pressed={appearance.backgroundPattern === pattern.id}
                onClick={() => update({ backgroundPattern: pattern.id })}
              >
                <span className="option-picture" style={pictured(pattern.id)} aria-hidden="true" />
                <span>{pattern.label}</span>
              </button>
            ))}
          </span>
        </Row>
        {appearance.backgroundPattern !== 'none' && (
          <>
            <Row label="Strength">
              <Slider
                label="Pattern strength"
                value={appearance.patternStrength}
                range={APPEARANCE_RANGES.patternStrength}
                unit="%"
                onChange={(patternStrength) => update({ patternStrength })}
              />
            </Row>
            <Row label="Size">
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
        <Row
          label="Fade"
          hint="Darkens the background towards the bottom edge (lightens, on a light theme)."
        >
          <Slider
            label="Background fade"
            value={appearance.backgroundFade}
            range={APPEARANCE_RANGES.backgroundFade}
            unit="%"
            onChange={(backgroundFade) => update({ backgroundFade })}
          />
        </Row>
        <Row label="Vignette">
          <Slider
            label="Background vignette"
            value={appearance.backgroundVignette}
            range={APPEARANCE_RANGES.backgroundVignette}
            unit="%"
            onChange={(backgroundVignette) => update({ backgroundVignette })}
          />
        </Row>
      </div>
    </section>
  );
}

const BACKGROUNDS: { id: BackgroundMode; label: string }[] = [
  { id: 'theme', label: 'Theme' },
  { id: 'solid', label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'image', label: 'Image' },
];

function BackgroundTile({
  mode,
  appearance,
  wallpaper,
  onSelect,
}: {
  mode: (typeof BACKGROUNDS)[number];
  appearance: AppearanceSettings;
  wallpaper?: string;
  onSelect(): void;
}) {
  const theme = THEMES[appearance.theme];
  const selected = appearance.background === mode.id;
  const fill = {
    theme: { backgroundColor: theme.base, backgroundImage: theme.glow },
    solid: { backgroundColor: appearance.backgroundColor },
    gradient: {
      backgroundImage: `linear-gradient(${appearance.gradientAngle}deg, ${appearance.gradientFrom}, ${appearance.gradientTo})`,
    },
    image: wallpaper
      ? {
          backgroundImage: `url("${wallpaper}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : {},
  }[mode.id];
  return (
    <button
      type="button"
      className={`option-tile ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span
        className={`option-picture ${mode.id === 'image' && !wallpaper ? 'empty' : ''}`}
        style={fill}
      >
        {mode.id === 'image' && !wallpaper && <span aria-hidden="true">+</span>}
      </span>
      <span>{mode.label}</span>
    </button>
  );
}

export default function AppearanceSettings() {
  const { appearance, wallpaper, error } = useAppearance();
  const store = useAppearanceStore();
  const [wallpaperError, setWallpaperError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const update: Update = (changes) => store?.update(changes);
  const theme = THEMES[appearance.theme];

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

  return (
    <div className="settings-content-scroll">
      <div className="settings-content appearance-settings">
        <header className="settings-heading with-actions">
          <div>
            <h2>Appearance</h2>
            <p>
              Theme, accent, type and background. Changes apply immediately and are saved by the JAM
              runtime with your other settings.
            </p>
          </div>
          <button type="button" className="button" onClick={() => store?.reset()}>
            Reset to defaults
          </button>
        </header>
        {error && (
          <p className="settings-error" role="alert">
            Appearance could not be saved: {error}
          </p>
        )}

        <section aria-labelledby="appearance-theme">
          <h3 id="appearance-theme" className="settings-group-label">
            Theme
          </h3>
          <ThemePicker appearance={appearance} update={update} />
        </section>

        <section className="settings-card">
          <Row
            label="Accent"
            hint={
              appearance.autoColors && appearance.background === 'image' && wallpaper
                ? 'Taken from the image while Match colours to image is on. Choosing one here is kept for when it is off.'
                : 'Focus, selection, links and the selected row. Success, warning and error keep their own colours.'
            }
          >
            <AccentPicker appearance={appearance} update={update} />
          </Row>
        </section>

        <section aria-labelledby="appearance-type">
          <h3 id="appearance-type" className="settings-group-label">
            Type
          </h3>
          <div className="settings-card">
            <Row label="Interface" hint="Menus, lists, chat and Markdown.">
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
                suffix="px"
                onChange={(uiFontSize) => update({ uiFontSize })}
              />
            </Row>
            <Row label="Code" hint="The file editor and code in Markdown.">
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
                suffix="px"
                onChange={(codeFontSize) => update({ codeFontSize })}
              />
              <NumberSelect
                label="Code line height"
                value={appearance.codeLineHeight}
                range={APPEARANCE_RANGES.codeLineHeight}
                suffix="px line"
                onChange={(codeLineHeight) => update({ codeLineHeight })}
              />
            </Row>
            <Row label="Terminal">
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
                suffix="px"
                onChange={(terminalFontSize) => update({ terminalFontSize })}
              />
              <NumberSelect
                label="Terminal line height"
                value={appearance.terminalLineHeight}
                range={APPEARANCE_RANGES.terminalLineHeight}
                suffix="px line"
                onChange={(terminalLineHeight) => update({ terminalLineHeight })}
              />
            </Row>
            <div className="type-preview" aria-label="Type preview">
              <p>The quick brown fox reads the release notes.</p>
              <pre className="type-preview-code">
                <span className="syntax-keyword">const</span>{' '}
                <span className="syntax-definition">handle</span>{' '}
                <span className="syntax-operator">=</span>{' '}
                <span className="syntax-function">attach</span>
                <span className="syntax-punctuation">(</span>
                <span className="syntax-string">&apos;session-42&apos;</span>
                <span className="syntax-punctuation">);</span>{' '}
                <span className="syntax-comment">// keeps the PTY alive</span>
              </pre>
              <pre className="type-preview-terminal">
                <span className="ansi-green">✓</span> 94 tests passed{' '}
                <span className="ansi-bright-black">in 740ms</span>
              </pre>
            </div>
          </div>
          <p className="settings-footnote">
            JAM bundles Geist and Geist Mono. Other families are used only if this computer already
            has them; nothing is downloaded.
          </p>
        </section>

        <section aria-labelledby="appearance-background">
          <h3 id="appearance-background" className="settings-group-label">
            Background
          </h3>
          <div className="settings-card">
            <Row label="Background" hint="Drawn behind every pane.">
              <span className="option-tiles">
                {BACKGROUNDS.map((mode) => (
                  <BackgroundTile
                    key={mode.id}
                    mode={mode}
                    appearance={appearance}
                    wallpaper={wallpaper?.dataUrl}
                    onSelect={() => update({ background: mode.id })}
                  />
                ))}
              </span>
            </Row>
            {appearance.background === 'solid' && (
              <Row label="Colour">
                <input
                  type="color"
                  className="colour-input"
                  aria-label="Background colour"
                  value={appearance.backgroundColor}
                  onChange={(event) =>
                    update({ backgroundColor: event.target.value.toLowerCase() })
                  }
                />
              </Row>
            )}
            {appearance.background === 'gradient' && (
              <Row label="Gradient">
                <input
                  type="color"
                  className="colour-input"
                  aria-label="Gradient start colour"
                  value={appearance.gradientFrom}
                  onChange={(event) => update({ gradientFrom: event.target.value.toLowerCase() })}
                />
                <input
                  type="color"
                  className="colour-input"
                  aria-label="Gradient end colour"
                  value={appearance.gradientTo}
                  onChange={(event) => update({ gradientTo: event.target.value.toLowerCase() })}
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
                label="Image"
                hint={
                  wallpaper
                    ? `${wallpaper.name || 'Wallpaper'} · ${wallpaper.width}×${wallpaper.height}. JAM keeps its own copy, so moving or deleting the original changes nothing.`
                    : 'JAM keeps a copy no larger than 2560px, so moving or deleting the original changes nothing.'
                }
              >
                <label className="button file-button">
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
                    className="button quiet"
                    onClick={() =>
                      void store
                        ?.setWallpaper(undefined)
                        .then(() => update({ background: 'theme' }))
                        .catch((cause: unknown) =>
                          setWallpaperError(
                            cause instanceof Error
                              ? cause.message
                              : 'The image could not be removed.',
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
                label="Match colours to image"
                hint="Takes the accent from the image's most vivid colour and tints surfaces with its own dark tone. Text keeps its contrast."
              >
                <Toggle
                  label="Match colours to image"
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
                <Row label="Brightness">
                  <Slider
                    label="Background brightness"
                    value={appearance.backgroundBrightness}
                    range={APPEARANCE_RANGES.backgroundBrightness}
                    unit="%"
                    onChange={(backgroundBrightness) => update({ backgroundBrightness })}
                  />
                </Row>
                <Row label="Saturation">
                  <Slider
                    label="Background saturation"
                    value={appearance.backgroundSaturation}
                    range={APPEARANCE_RANGES.backgroundSaturation}
                    unit="%"
                    onChange={(backgroundSaturation) => update({ backgroundSaturation })}
                  />
                </Row>
                <Row label="Blur">
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
          </div>
        </section>
        <SurfaceSettings appearance={appearance} update={update} />
        <EffectSettings appearance={appearance} update={update} />
        {appearance.theme === DEFAULT_APPEARANCE.theme ? null : (
          <p className="settings-footnote">
            {theme.name} changes JAM only. Pages open in Browser keep their own colours.
          </p>
        )}
      </div>
    </div>
  );
}
