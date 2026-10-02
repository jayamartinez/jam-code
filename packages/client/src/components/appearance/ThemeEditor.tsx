import { useMemo, useState, type CSSProperties } from 'react';
import {
  APPEARANCE,
  customThemeRef,
  type AppearanceSettings,
  type CustomTheme,
  type CustomThemeColors,
  type CustomThemeRole,
} from '@jam/protocol';
import { contrast, ensureContrast } from '../../appearance/color';
import { coloursFromDefinition } from '../../appearance/custom';
import type { ImportedTheme } from '../../appearance/import';
import { colorTokens } from '../../appearance/resolve';
import { THEMES, type Scheme } from '../../appearance/themes';
import { Card, Row, Section, Segmented } from '../settings/controls';
import { ColourInput } from './controls';
import { MiniWindow } from './Stage';

/**
 * Create, edit or finish importing a theme. The reader edits anchor colours
 * per variant; the preview is the same miniature window as the page's stage,
 * wrapped in the draft's own tokens. Colours below JAM's contrast floors are
 * flagged: JAM raises them just enough whenever it draws the theme, and
 * "Raise now" writes the raised values into the draft instead.
 */

type Floor = { role: CustomThemeRole; label: string; ratio: number };

const TEXT_ROLES: Floor[] = [
  { role: 'text', label: 'Text', ratio: 4.5 },
  { role: 'muted', label: 'Muted text', ratio: 4.5 },
  { role: 'accent', label: 'Accent', ratio: 3 },
];
const SYNTAX: Floor[] = [
  { role: 'keyword', label: 'Keyword', ratio: 4.5 },
  { role: 'string', label: 'String', ratio: 4.5 },
  { role: 'function', label: 'Function', ratio: 4.5 },
  { role: 'number', label: 'Number', ratio: 4.5 },
  { role: 'type', label: 'Type', ratio: 4.5 },
  { role: 'property', label: 'Property', ratio: 4.5 },
  { role: 'operator', label: 'Operator', ratio: 4.5 },
  { role: 'comment', label: 'Comment', ratio: 3.5 },
];
const SURFACES: { role: CustomThemeRole; label: string; sub?: string }[] = [
  { role: 'canvas', label: 'Canvas', sub: 'Panes, the editor and chat.' },
  { role: 'sidebar', label: 'Sidebar' },
  { role: 'raised', label: 'Raised', sub: 'Composer, menus and cards.' },
];
const STATUS: { role: CustomThemeRole; label: string }[] = [
  { role: 'success', label: 'Success' },
  { role: 'warning', label: 'Warning' },
  { role: 'danger', label: 'Danger' },
];
const ANSI: CustomThemeRole[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
const FLOORS = [...TEXT_ROLES, ...SYNTAX];

const starter = (scheme: Scheme): CustomThemeColors =>
  coloursFromDefinition(scheme === 'dark' ? THEMES.nightglass : THEMES.frost);

function belowFloor(colours: CustomThemeColors) {
  return FLOORS.filter(({ role, ratio }) => contrast(colours[role], colours.canvas) < ratio);
}

export interface ThemeDraft {
  theme: CustomTheme;
  /** Unsaved: from New theme or an import. */
  isNew: boolean;
  report?: ImportedTheme & { fileName: string };
}

export function ThemeEditor({
  draft,
  appearance,
  onSave,
  onDiscard,
  onDelete,
  onExport,
}: {
  draft: ThemeDraft;
  appearance: AppearanceSettings;
  onSave(theme: CustomTheme, scheme: Scheme): void;
  onDiscard(): void;
  onDelete?(): void;
  onExport(theme: CustomTheme): void;
}) {
  const [theme, setTheme] = useState<CustomTheme>(draft.theme);
  const [scheme, setScheme] = useState<Scheme>(draft.theme.dark ? 'dark' : 'light');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const colours = theme[scheme];
  const name = theme.name.trim();
  const valid = !!name && name.length <= APPEARANCE.limits.customThemeNameUtf16;

  const setColour = (role: CustomThemeRole, value: string) =>
    setTheme((previous) => ({
      ...previous,
      [scheme]: { ...(previous[scheme] ?? starter(scheme)), [role]: value },
    }));

  const previewStyle = useMemo(() => {
    if (!colours) return undefined;
    const draftTheme = { ...theme, id: 'draft', name: name || 'Untitled' };
    return colorTokens({
      ...appearance,
      theme: customThemeRef('draft', scheme),
      customThemes: [draftTheme],
      accent: 'theme',
      autoColors: false,
      paneOpacity: 100,
      sidebarOpacity: 100,
    }) as CSSProperties;
  }, [appearance, colours, name, scheme, theme]);

  const low = colours ? belowFloor(colours) : [];
  const variants = (['light', 'dark'] as const).filter((item) => theme[item]);

  const ratio = (role: CustomThemeRole, floor: number) => {
    if (!colours) return null;
    const value = contrast(colours[role], colours.canvas);
    const text = value.toFixed(1);
    return value < floor ? (
      <span className="sv-chip warning" title={`Drawn at ${floor}:1 or better`}>
        {text} → {floor}
      </span>
    ) : (
      <span className="ap-ratio">{text}</span>
    );
  };

  return (
    <div className="sv-page wide ap-editor">
      <header className="ap-editor-header">
        <button type="button" className="sv-button quiet" onClick={onDiscard}>
          ‹ Library
        </button>
        <span className="ap-divider" />
        <input
          className="ap-name"
          aria-label="Theme name"
          value={theme.name}
          maxLength={APPEARANCE.limits.customThemeNameUtf16}
          placeholder="Theme name"
          onChange={(event) => setTheme({ ...theme, name: event.target.value })}
        />
        <span className="sv-chip">{draft.isNew ? 'Unsaved' : 'Yours'}</span>
        <span className="ap-spacer" />
        {onDelete && (
          <button
            type="button"
            className="sv-button danger"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
            onBlur={() => setConfirmDelete(false)}
          >
            {confirmDelete ? 'Delete theme?' : 'Delete'}
          </button>
        )}
        <button
          type="button"
          className="sv-button"
          disabled={!valid}
          onClick={() => onExport({ ...theme, name })}
        >
          Export
        </button>
        <button type="button" className="sv-button quiet" onClick={onDiscard}>
          Discard
        </button>
        <button
          type="button"
          className="sv-button primary"
          disabled={!valid}
          onClick={() => onSave({ ...theme, name }, scheme)}
        >
          Save theme
        </button>
      </header>

      {draft.report && (
        <div className="ap-import-report" role="status">
          <strong>Imported {draft.report.fileName}</strong>
          <span className="sv-chip">
            {draft.report.format === 'vscode' ? 'VS Code theme' : 'JAM theme'}
          </span>
          <p>
            {draft.report.mapped} roles from the file
            {draft.report.derived
              ? `; ${draft.report.derived} filled from JAM's ${scheme} theme (${draft.report.derivedRoles.join(', ')}).`
              : '.'}
          </p>
        </div>
      )}

      <div className="ap-editor-body">
        <div className="ap-editor-roles">
          <Segmented<Scheme>
            label="Variant"
            value={scheme}
            options={(['light', 'dark'] as const).map((item) => ({
              value: item,
              label: (
                <>
                  <i
                    className="ap-variant-swatch"
                    style={{ background: theme[item]?.canvas ?? 'transparent' }}
                  />
                  {item === 'light' ? 'Light' : 'Dark'}
                  {!theme[item] && ' +'}
                </>
              ),
            }))}
            onChange={setScheme}
          />
          {!colours ? (
            <Card>
              <Row
                title={`No ${scheme} variant`}
                sub={`Add one to use ${name || 'this theme'} with ${scheme} surfaces.`}
              >
                <button
                  type="button"
                  className="sv-button"
                  onClick={() => setTheme({ ...theme, [scheme]: starter(scheme) })}
                >
                  Add {scheme} variant
                </button>
              </Row>
            </Card>
          ) : (
            <>
              <Section
                label="Surfaces"
                {...(appearance.autoColors &&
                  appearance.background === 'image' && {
                    hint: 'Recoloured by the image while Match colours to image is on',
                  })}
              >
                <Card>
                  {SURFACES.map(({ role, label, sub }) => (
                    <Row key={role} title={label} sub={sub}>
                      <ColourInput
                        label={label}
                        value={colours[role]}
                        onChange={(value) => setColour(role, value)}
                      />
                    </Row>
                  ))}
                </Card>
              </Section>
              <Section label="Text & accent" hint="Contrast on the canvas">
                <Card>
                  {TEXT_ROLES.map(({ role, label, ratio: floor }) => (
                    <Row key={role} title={label}>
                      {ratio(role, floor)}
                      <ColourInput
                        label={label}
                        value={colours[role]}
                        onChange={(value) => setColour(role, value)}
                      />
                    </Row>
                  ))}
                  {STATUS.map(({ role, label }) => (
                    <Row key={role} title={label}>
                      <ColourInput
                        label={label}
                        value={colours[role]}
                        onChange={(value) => setColour(role, value)}
                      />
                    </Row>
                  ))}
                </Card>
              </Section>
              <Section label="Syntax">
                <div className="ap-syntax">
                  {SYNTAX.map(({ role, label, ratio: floor }) => (
                    <div key={role} className="ap-syntax-role">
                      <span>{label}</span>
                      {ratio(role, floor)}
                      <ColourInput
                        label={label}
                        value={colours[role]}
                        onChange={(value) => setColour(role, value)}
                      />
                    </div>
                  ))}
                </div>
              </Section>
              <Section label="Terminal">
                <div className="ap-ansi">
                  {ANSI.map((role) => (
                    <ColourInput
                      key={role}
                      label={`Terminal ${role}`}
                      value={colours[role]}
                      onChange={(value) => setColour(role, value)}
                    />
                  ))}
                </div>
              </Section>
              {variants.length > 1 && (
                <button
                  type="button"
                  className="sv-button quiet ap-remove-variant"
                  onClick={() => {
                    const next = { ...theme };
                    delete next[scheme];
                    setTheme(next);
                    setScheme(scheme === 'dark' ? 'light' : 'dark');
                  }}
                >
                  Remove {scheme} variant
                </button>
              )}
            </>
          )}
        </div>

        <div className="ap-editor-preview">
          <div className="ap-editor-stage" style={previewStyle}>
            {colours ? <MiniWindow /> : <p className="sv-mono">No {scheme} variant yet.</p>}
          </div>
          {colours && (
            <div className={`ap-check ${low.length ? 'warn' : ''}`} role="status">
              {low.length ? (
                <>
                  <div>
                    <strong>
                      {low.map((item) => item.label).join(', ')} {low.length === 1 ? 'is' : 'are'}{' '}
                      below the contrast floor
                    </strong>
                    <p>
                      JAM raises {low.length === 1 ? 'it' : 'them'} just enough when it draws the
                      theme.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="sv-button"
                    onClick={() =>
                      setTheme((previous) => {
                        const current = previous[scheme]!;
                        const raised = { ...current };
                        for (const { role, ratio: floor } of belowFloor(current))
                          raised[role] = ensureContrast(current[role], current.canvas, floor);
                        return { ...previous, [scheme]: raised };
                      })
                    }
                  >
                    Raise now
                  </button>
                </>
              ) : (
                <strong>Every text and syntax colour meets its contrast floor.</strong>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
