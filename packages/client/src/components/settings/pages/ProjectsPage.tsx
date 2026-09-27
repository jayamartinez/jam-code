import { useRef, useState, type KeyboardEvent } from 'react';
import { PROJECT_ICONS, type Project } from '@jam/protocol';
import { QUICK_EMOJI } from '../../ProjectEditor';
import { PRESET_GLYPHS, ProjectBadge, TONE_LABELS, squareProjectImage } from '../../ProjectBadge';
import { Planned, Row, Segmented, Select, Toggle } from '../controls';
import {
  buildIcon,
  iconDraft,
  initialProjectId,
  normalizePaths,
  projectSummary,
  sameIcon,
  samePaths,
  type IconDraft,
  type IconKind,
} from '../projects-model';
import type { ProjectChanges, SettingsPageProps } from '../types';

const ICON_KINDS: { value: IconKind; label: string }[] = [
  { value: 'initials', label: 'Initials' },
  { value: 'preset', label: 'Glyph' },
  { value: 'emoji', label: 'Emoji' },
  { value: 'image', label: 'Image' },
];
const limits = PROJECT_ICONS.limits;

/**
 * Projects as a list and a detail. Name, icon, folders and pinning save as
 * they change through `project.update`; per-project overrides and removal
 * have no runtime support yet and are marked Planned.
 */
export default function ProjectsPage({ projects, platform, onUpdateProject }: SettingsPageProps) {
  const [selectedId, setSelectedId] = useState(() => initialProjectId(projects));
  const selected =
    projects.find((project) => project.id === selectedId) ??
    projects.find((project) => project.id === initialProjectId(projects));

  return (
    <div className="sv-page wide">
      <p className="sv-providers-intro">Projects JAM works in. Changes save as you make them.</p>
      <div className="sv-split">
        <nav className="sv-split-list" aria-label="Projects">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`sv-project-row ${project.id === selected?.id ? 'selected' : ''}`}
              aria-current={project.id === selected?.id ? 'true' : undefined}
              onClick={() => setSelectedId(project.id)}
            >
              <ProjectBadge project={project} />
              <span className="sv-provider-name">
                <strong>{project.name}</strong>
                <small>{projectSummary(project)}</small>
              </span>
              {project.pinned && <PinMark />}
            </button>
          ))}
          <div className="sv-split-divider" />
          <div className="sv-project-row add" aria-disabled="true">
            <span className="sv-add-badge" aria-hidden="true">
              +
            </span>
            <span className="sv-provider-name">
              <span>Add project…</span>
            </span>
            <Planned />
          </div>
        </nav>
        {selected ? (
          <ProjectDetail
            key={selected.id}
            project={selected}
            platform={platform}
            onUpdate={(changes) => onUpdateProject(selected.id, changes)}
          />
        ) : (
          <div className="sv-split-detail empty">No projects yet.</div>
        )}
      </div>
    </div>
  );
}

function PinMark() {
  return (
    <svg className="sv-pin" width="12" height="12" viewBox="0 0 16 16" aria-label="Pinned">
      <path
        d="M6 2.5h4l-.8 4 2.3 2H4.5l2.3-2zM8 8.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProjectDetail({
  project,
  platform,
  onUpdate,
}: {
  project: Project;
  platform: SettingsPageProps['platform'];
  onUpdate(changes: ProjectChanges): Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [draft, setDraft] = useState<IconDraft>(() => iconDraft(project.icon));
  const [paths, setPaths] = useState<string[]>(project.paths ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(0);
  const lastPath = useRef<HTMLInputElement>(null);

  const save = async (changes: ProjectChanges) => {
    setError(null);
    setSaving((count) => count + 1);
    try {
      await onUpdate(changes);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be saved.');
    } finally {
      setSaving((count) => count - 1);
    }
  };

  const saveName = () => {
    const next = name.trim();
    if (!next) {
      setName(project.name);
      return setError('A project needs a name.');
    }
    if (next !== project.name) void save({ name: next });
  };

  const changeIcon = (next: IconDraft) => {
    setDraft(next);
    const icon = buildIcon(next);
    if (icon && !sameIcon(icon, project.icon)) void save({ icon });
  };

  const savePaths = (next: string[]) => {
    const normalized = normalizePaths(next);
    if (!samePaths(normalized, project.paths)) void save({ paths: normalized });
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const emojiShortcut =
    platform === 'windows'
      ? 'Win + .'
      : platform === 'macos'
        ? 'Ctrl + ⌘ + Space'
        : 'your emoji picker';
  const preview: Project = { ...project, icon: buildIcon(draft) ?? project.icon };

  return (
    <section className="sv-split-detail" aria-label={project.name}>
      <header className="sv-detail-header">
        <ProjectBadge project={preview} size={28} className="sv-project-badge-large" />
        <div>
          <h2>{project.name}</h2>
          <p>{projectSummary(project)}</p>
        </div>
        <span className="sv-save-state" role="status">
          {saving > 0 ? 'Saving…' : ''}
        </span>
      </header>
      {error && (
        <p className="sv-error" role="alert">
          {error}
        </p>
      )}

      <div className="sv-detail-group">
        <h3>Name &amp; icon</h3>
        <div className="sv-detail-card">
          <Row title="Name">
            <input
              className="sv-input"
              aria-label="Project name"
              value={name}
              maxLength={limits.nameUtf16}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={onEnter}
            />
          </Row>
          <div className="sv-icon-editor">
            <div className="sv-icon-editor-head">
              <strong>Icon</strong>
              <Segmented
                label="Icon type"
                value={draft.kind}
                options={ICON_KINDS}
                onChange={(kind) => changeIcon({ ...draft, kind })}
              />
            </div>
            {draft.kind !== 'image' && (
              <div className="sv-icon-line">
                <span className="sv-icon-line-label">Tone</span>
                <div className="sv-tones" role="radiogroup" aria-label="Colour">
                  {PROJECT_ICONS.tones.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      role="radio"
                      aria-checked={draft.tone === tone}
                      aria-label={TONE_LABELS[tone] ?? tone}
                      title={TONE_LABELS[tone] ?? tone}
                      className={`icon-choice sv-tone tone-${tone} ${draft.tone === tone ? 'selected' : ''}`}
                      onClick={() => changeIcon({ ...draft, tone })}
                    >
                      <span />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {draft.kind === 'preset' && (
              <div className="sv-glyph-grid" role="listbox" aria-label="Glyph">
                {PROJECT_ICONS.presets.map((preset) => {
                  const Glyph = PRESET_GLYPHS[preset];
                  return (
                    <button
                      key={preset}
                      type="button"
                      role="option"
                      aria-selected={draft.preset === preset}
                      title={preset}
                      className={`icon-choice tone-${draft.tone} ${draft.preset === preset ? 'selected' : ''}`}
                      onClick={() => changeIcon({ ...draft, preset })}
                    >
                      {Glyph && <Glyph size={14} strokeWidth={2} />}
                    </button>
                  );
                })}
              </div>
            )}
            {draft.kind === 'emoji' && (
              <>
                <div className="sv-glyph-grid emoji" role="listbox" aria-label="Emoji">
                  {QUICK_EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      role="option"
                      aria-selected={draft.emoji === emoji}
                      className={`icon-choice ${draft.emoji === emoji ? 'selected' : ''}`}
                      onClick={() => changeIcon({ ...draft, emoji })}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div className="sv-icon-line">
                  <input
                    className="sv-input emoji"
                    aria-label="Emoji"
                    placeholder="🙂"
                    value={draft.emoji}
                    maxLength={limits.emojiUtf16}
                    onChange={(event) => setDraft({ ...draft, emoji: event.target.value })}
                    onBlur={() => changeIcon(draft)}
                    onKeyDown={onEnter}
                  />
                  <span className="sv-hint">Or open the system picker with {emojiShortcut}.</span>
                </div>
              </>
            )}
            {draft.kind === 'image' && (
              <div className="sv-icon-line">
                <label className="sv-button">
                  {draft.image ? 'Replace image…' : 'Choose image…'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                    hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (!file) return;
                      setError(null);
                      try {
                        changeIcon({ ...draft, image: await squareProjectImage(file) });
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : 'That image could not be used.',
                        );
                      }
                    }}
                  />
                </label>
                <span className="sv-hint">Cropped to a square and stored at 64px.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="sv-detail-group">
        <h3>
          Folders
          <span className="sv-detail-hint">Agents and Review use the first folder</span>
        </h3>
        <div className="sv-detail-card">
          {paths.map((path, index) => (
            <div className="sv-folder" key={index}>
              <FolderGlyph />
              <input
                ref={index === paths.length - 1 ? lastPath : undefined}
                className="sv-folder-input"
                aria-label={`Folder ${index + 1}`}
                value={path}
                placeholder={
                  platform === 'windows' ? 'C:\\code\\project' : '/Users/you/code/project'
                }
                maxLength={limits.pathUtf16}
                onChange={(event) =>
                  setPaths((current) =>
                    current.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
                onBlur={() => savePaths(paths)}
                onKeyDown={onEnter}
              />
              {index === 0 && path.trim() && <span className="sv-chip">Primary</span>}
              <button
                type="button"
                className="sv-folder-remove"
                aria-label={`Remove ${path || 'folder'}`}
                onClick={() => {
                  const next = paths.filter((_, i) => i !== index);
                  setPaths(next);
                  savePaths(next);
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path
                    d="M2.5 2.5l5 5M7.5 2.5l-5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))}
          {paths.length < limits.paths && (
            <button
              type="button"
              className="sv-folder add"
              onClick={() => {
                setPaths((current) => [...current, '']);
                requestAnimationFrame(() => lastPath.current?.focus());
              }}
            >
              <span aria-hidden="true">+</span>
              Add folder
            </button>
          )}
        </div>
      </div>

      <div className="sv-detail-group">
        <h3>
          For this project
          <span className="sv-detail-hint">Anything left on default follows General</span>
        </h3>
        <div className="sv-detail-card">
          <Row title="Pinned in sidebar" sub="Stays at the top of the project list.">
            <Toggle
              label="Pinned in sidebar"
              on={!!project.pinned}
              onChange={(pinned) => void save({ pinned })}
            />
          </Row>
          <Row
            title={
              <>
                Default agent
                <Planned />
              </>
            }
            disabled
          >
            <Select
              label="Default agent"
              value="default"
              options={[{ value: 'default', label: 'Use General default' }]}
              disabled
            />
          </Row>
          <Row
            title={
              <>
                New threads start in
                <Planned />
              </>
            }
            disabled
          >
            <Segmented
              label="New threads start in"
              value="default"
              options={[
                { value: 'default', label: 'General default' },
                { value: 'worktree', label: 'New worktree' },
                { value: 'checkout', label: 'Current checkout' },
              ]}
              disabled
            />
          </Row>
        </div>
      </div>

      <div className="sv-danger-row">
        <div>
          <strong>
            Remove from JAM
            <Planned />
          </strong>
          <p>Files stay on disk; conversations are kept until you delete them.</p>
        </div>
        <button type="button" className="sv-button danger" disabled>
          Remove…
        </button>
      </div>
    </section>
  );
}

function FolderGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" className="sv-folder-glyph">
      <path
        d="M2 4.5h4l1.2 1.5H14v6.5H2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
