import { useMemo, useState, type ReactNode } from 'react';
import {
  APPEARANCE,
  APPEARANCE_RANGES,
  DEFAULT_APPEARANCE,
  FONT_FAMILY,
  type AccentId,
  type AppearanceSettings,
  type BackgroundMode,
  type ThemeId,
} from '@jam/protocol';
import { useAppearance, useAppearanceStore } from '../appearance/store';
import { ACCENTS, THEMES, legible, type ThemeDefinition } from '../appearance/themes';
import { MONO_FONTS, UI_FONTS, isFontAvailable, type FontChoice } from '../appearance/fonts';
import { WALLPAPER_ACCEPT, prepareWallpaper } from '../appearance/wallpaper';
import { alpha } from '../appearance/color';

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

/** Paper's theme tile: a miniature window drawn from the theme's own roles. */
function ThemeTile({
  theme,
  selected,
  onSelect,
}: {
  theme: ThemeDefinition;
  selected: boolean;
  onSelect(): void;
}) {
  const [sidebar, sidebarAlpha] = theme.surfaces.sidebar;
  const [pane, paneAlpha] = theme.surfaces.pane;
  return (
    <button
      type="button"
      className={`theme-tile ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span
        className="theme-preview"
        style={{
          backgroundColor: theme.base,
          backgroundImage: theme.glow,
        }}
      >
        <span
          className="theme-preview-sidebar"
          style={{ background: alpha(sidebar, sidebarAlpha) }}
        >
          <i style={{ background: alpha(theme.accent, 25), width: 36 }} />
          <i style={{ background: alpha(theme.accent, 25), height: 8 }} />
          <i style={{ background: alpha(theme.tint, 10), width: 30 }} />
          <i style={{ background: alpha(theme.tint, 10), width: 38 }} />
        </span>
        <span className="theme-preview-pane" style={{ background: alpha(pane, paneAlpha) }}>
          <i style={{ background: alpha(theme.text.body, 25), width: '80%' }} />
          <i style={{ background: alpha(theme.text.body, 18), width: '60%' }} />
          <span
            className="theme-preview-composer"
            style={{ background: theme.raised, borderColor: alpha(theme.tint, 12) }}
          >
            <i style={{ background: theme.accent }} />
          </span>
        </span>
      </span>
      <span className="theme-label">
        <span>{theme.name}</span>
        <small>{theme.note}</small>
      </span>
    </button>
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
  const opaque = (appearance.paneOpacity ?? theme.surfaces.pane[1]) >= 100;

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
          <div className="theme-grid">
            {APPEARANCE.themes.map((id: ThemeId) => (
              <ThemeTile
                key={id}
                theme={THEMES[id]}
                selected={appearance.theme === id}
                onSelect={() => update({ theme: id })}
              />
            ))}
          </div>
        </section>

        <section className="settings-card">
          <Row
            label="Accent"
            hint="Focus, selection, links and the selected row. Success, warning and error keep their own colours."
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
            <Row
              label="Pane opacity"
              hint={
                opaque && appearance.background !== 'theme'
                  ? `${theme.name} draws opaque panes. Lower this to let the background show through.`
                  : 'How much of the background shows through panes and the sidebar.'
              }
            >
              <Slider
                label="Pane opacity"
                value={appearance.paneOpacity ?? theme.surfaces.pane[1]}
                range={APPEARANCE.limits.paneOpacity}
                unit="%"
                onChange={(paneOpacity) => update({ paneOpacity })}
              />
              <button
                type="button"
                className="button quiet"
                disabled={appearance.paneOpacity === undefined}
                onClick={() => update({ paneOpacity: undefined })}
              >
                Theme default
              </button>
            </Row>
            <Row
              label="Pane blur"
              hint="Blurs an image behind panes so text stays readable. Used only with an image."
            >
              <Slider
                label="Pane blur"
                value={appearance.paneBlur}
                range={APPEARANCE_RANGES.paneBlur}
                unit="px"
                disabled={appearance.background !== 'image'}
                onChange={(paneBlur) => update({ paneBlur })}
              />
            </Row>
          </div>
        </section>
        {appearance.theme === DEFAULT_APPEARANCE.theme ? null : (
          <p className="settings-footnote">
            {theme.name} changes JAM only. Pages open in Browser keep their own colours.
          </p>
        )}
      </div>
    </div>
  );
}
