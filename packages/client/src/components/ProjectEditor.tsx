import { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { PROJECT_ICONS, initialsOf, type Project, type ProjectIcon } from '@jam/protocol';
import { Dialog } from './Controls';
import { PRESET_GLYPHS, ProjectBadge, TONE_LABELS, squareProjectImage } from './ProjectBadge';

/**
 * A project's name, folders and badge: New project when `project` is absent,
 * otherwise Edit project from its context menu. Everything is staged in the
 * dialog and sent in one request when saved, so cancelling changes nothing.
 * Where the host has a folder chooser, new folders come only from it.
 */

type IconKind = ProjectIcon['kind'];
export const QUICK_EMOJI = [
  '🚀',
  '⚡',
  '🔥',
  '✨',
  '🌱',
  '🍓',
  '🧪',
  '🛠️',
  '🎨',
  '🎮',
  '📦',
  '🧠',
  '🤖',
  '🐛',
  '🌊',
  '🌙',
  '☕',
  '🦊',
  '🐙',
  '🦀',
  '🐍',
  '💎',
  '📚',
  '🎵',
];

export function ProjectEditor({
  project,
  platform,
  onPickFolder,
  onSave,
  onClose,
}: {
  /** Absent for a new project. */
  project?: Project;
  platform: 'macos' | 'windows' | 'web';
  /** The system folder chooser; absent where the host has none. */
  onPickFolder?(): Promise<string | null>;
  onSave(changes: { name: string; paths: string[]; icon: ProjectIcon }): Promise<void>;
  onClose(): void;
}) {
  const creating = !project;
  const [name, setName] = useState(project?.name ?? '');
  /** A new project's name follows its first folder until it is typed. */
  const [named, setNamed] = useState(!creating);
  const [paths, setPaths] = useState<string[]>(project?.paths ?? []);
  const [kind, setKind] = useState<IconKind>(project?.icon?.kind ?? 'initials');
  const [tone, setTone] = useState(project?.icon?.tone ?? 'blue');
  const [preset, setPreset] = useState(
    project?.icon?.kind === 'preset' ? (project.icon.value ?? 'rocket') : 'rocket',
  );
  const [emoji, setEmoji] = useState(
    project?.icon?.kind === 'emoji' ? (project.icon.value ?? '') : '',
  );
  const [image, setImage] = useState(
    project?.icon?.kind === 'image' ? project.icon.value : undefined,
  );
  const chooseFolder = async () => {
    if (!onPickFolder) return setPaths((current) => [...current, '']);
    const chosen = await onPickFolder();
    if (!chosen) return;
    setPaths((current) => (current.includes(chosen) ? current : [...current, chosen]));
    if (!named && !paths.length) setName(folderName(chosen));
  };
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const icon: ProjectIcon =
    kind === 'preset'
      ? { kind, value: preset, tone }
      : kind === 'emoji'
        ? { kind, value: emoji.trim(), tone }
        : kind === 'image' && image
          ? { kind, value: image }
          : tone === 'blue'
            ? { kind: 'initials' }
            : { kind: 'initials', tone };
  const shownName = name || project?.name || 'New project';
  const preview: Project = {
    id: project?.id ?? 'new',
    branch: project?.branch ?? '',
    ...project,
    name: shownName,
    initials: initialsOf(shownName),
    icon,
  };
  const limits = PROJECT_ICONS.limits;
  const pathPlaceholder =
    platform === 'windows' ? 'C:\\Users\\you\\code\\project' : '/Users/you/code/project';
  const emojiShortcut =
    platform === 'windows'
      ? 'Win + .'
      : platform === 'macos'
        ? 'Ctrl + ⌘ + Space'
        : 'your emoji picker';

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('A project needs a name.');
    if (creating && !paths.some((path) => path.trim()))
      return setError('Choose the project’s folder.');
    if (kind === 'emoji' && !emoji.trim()) return setError('Choose or type an emoji.');
    if (kind === 'image' && !image) return setError('Choose an image first.');
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        paths: paths.map((path) => path.trim()).filter(Boolean),
        icon,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The project could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={project ? `Edit ${project.name}` : 'New project'}
      className="project-editor"
      onClose={onClose}
    >
      <header className="project-editor-header">
        <ProjectBadge project={preview} size={40} />
        <div>
          <h2>{project ? 'Edit project' : 'New project'}</h2>
          {project ? (
            <p className="mono">{project.branch}</p>
          ) : (
            <p>A folder on this computer. Git is optional.</p>
          )}
        </div>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <label className="editor-field">
        <span>Name</span>
        <input
          value={name}
          maxLength={limits.nameUtf16}
          placeholder={creating ? 'Named after its folder' : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setNamed(true);
          }}
          autoFocus={!creating}
        />
      </label>

      <div className="editor-field">
        <span>Folders</span>
        <p className="editor-hint">Agents, the file browser and Review work in the first folder.</p>
        {paths.map((path, index) => (
          <div className="editor-path" key={index}>
            {onPickFolder && creating ? (
              <span className="editor-path-chosen mono" title={path}>
                {path}
              </span>
            ) : (
              <input
                className="mono"
                value={path}
                aria-label={`Folder ${index + 1}`}
                placeholder={pathPlaceholder}
                maxLength={limits.pathUtf16}
                onChange={(event) =>
                  setPaths((current) =>
                    current.map((item, i) => (i === index ? event.target.value : item)),
                  )
                }
              />
            )}
            {index === 0 && paths.length > 1 && (
              <span className="editor-path-primary">Primary</span>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Remove folder"
              onClick={() => setPaths((current) => current.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </button>
          </div>
        ))}
        {paths.length < limits.paths && (
          <button
            type="button"
            className={`button editor-add ${creating && !paths.length ? 'primary' : ''}`}
            onClick={() => void chooseFolder()}
            autoFocus={creating}
          >
            <FolderPlus size={13} />
            {paths.length ? 'Add another folder…' : onPickFolder ? 'Choose folder…' : 'Add folder'}
          </button>
        )}
      </div>

      <div className="editor-field">
        <span>Icon</span>
        <div className="segmented" role="tablist" aria-label="Icon type">
          {(['initials', 'preset', 'emoji', 'image'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={kind === option}
              className={kind === option ? 'active' : ''}
              onClick={() => setKind(option)}
            >
              {option === 'initials'
                ? 'Initials'
                : option === 'preset'
                  ? 'Glyph'
                  : option === 'emoji'
                    ? 'Emoji'
                    : 'Image'}
            </button>
          ))}
        </div>

        {kind === 'preset' && (
          <div className="icon-grid" role="listbox" aria-label="Glyph">
            {PROJECT_ICONS.presets.map((name) => {
              const Glyph = PRESET_GLYPHS[name];
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={preset === name}
                  title={name}
                  className={`icon-choice tone-${tone} ${preset === name ? 'selected' : ''}`}
                  onClick={() => setPreset(name)}
                >
                  {Glyph && <Glyph size={16} strokeWidth={2} />}
                </button>
              );
            })}
          </div>
        )}

        {kind === 'emoji' && (
          <>
            <div className="editor-emoji">
              <input
                value={emoji}
                placeholder="🙂"
                maxLength={limits.emojiUtf16}
                aria-label="Emoji"
                onChange={(event) => setEmoji(event.target.value)}
              />
              <p className="editor-hint">
                Type or paste any emoji, or open the system picker with {emojiShortcut}.
              </p>
            </div>
            <div className="icon-grid emoji-grid" role="listbox" aria-label="Emoji">
              {QUICK_EMOJI.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="option"
                  aria-selected={emoji === value}
                  className={`icon-choice ${emoji === value ? 'selected' : ''}`}
                  onClick={() => setEmoji(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </>
        )}

        {kind === 'image' && (
          <div className="editor-image">
            <label className="button">
              {image ? 'Replace image…' : 'Choose image…'}
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
                    setImage(await squareProjectImage(file));
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : 'That image could not be used.',
                    );
                  }
                }}
              />
            </label>
            <p className="editor-hint">
              PNG, JPEG, SVG, WebP or GIF. It is cropped from the centre to a square and stored at
              64px, so it is never stretched.
            </p>
          </div>
        )}

        {kind !== 'image' && (
          <div className="tone-row" role="radiogroup" aria-label="Colour">
            {PROJECT_ICONS.tones.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={tone === option}
                aria-label={TONE_LABELS[option] ?? option}
                title={TONE_LABELS[option] ?? option}
                className={`tone-swatch tone-${option} ${tone === option ? 'selected' : ''}`}
                onClick={() => setTone(option)}
              />
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      <footer className="project-editor-footer">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={saving || (creating && !paths.length)}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : creating ? 'Create project' : 'Save'}
        </button>
      </footer>
    </Dialog>
  );
}

/** The last part of a folder path, written on either platform. */
function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}
