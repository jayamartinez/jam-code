import { useState } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { PROJECT_ICONS, type Project, type ProjectIcon } from '@jam/protocol';
import { Dialog } from './Controls';
import { PRESET_GLYPHS, ProjectBadge, TONE_LABELS, squareProjectImage } from './ProjectBadge';

/**
 * Edit project details: name, folders and badge.
 *
 * Opened from a project's context menu. Everything is staged in the dialog and
 * sent in one `project.update` when saved, so cancelling leaves the project as
 * it was.
 */

type IconKind = ProjectIcon['kind'];
const QUICK_EMOJI = [
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
  onSave,
  onClose,
}: {
  project: Project;
  platform: 'macos' | 'windows' | 'web';
  onSave(changes: { name: string; paths: string[]; icon: ProjectIcon }): Promise<void>;
  onClose(): void;
}) {
  const [name, setName] = useState(project.name);
  const [paths, setPaths] = useState<string[]>(project.paths ?? []);
  const [kind, setKind] = useState<IconKind>(project.icon?.kind ?? 'initials');
  const [tone, setTone] = useState(project.icon?.tone ?? 'blue');
  const [preset, setPreset] = useState(
    project.icon?.kind === 'preset' ? (project.icon.value ?? 'rocket') : 'rocket',
  );
  const [emoji, setEmoji] = useState(
    project.icon?.kind === 'emoji' ? (project.icon.value ?? '') : '',
  );
  const [image, setImage] = useState(
    project.icon?.kind === 'image' ? project.icon.value : undefined,
  );
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
  const preview: Project = { ...project, name: name || project.name, icon };
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
    <Dialog title={`Edit ${project.name}`} className="project-editor" onClose={onClose}>
      <header className="project-editor-header">
        <ProjectBadge project={preview} size={40} />
        <div>
          <h2>Edit project</h2>
          <p className="mono">{project.branch}</p>
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
          onChange={(event) => setName(event.target.value)}
          autoFocus
        />
      </label>

      <div className="editor-field">
        <span>Folders</span>
        <p className="editor-hint">
          Where this project lives on disk. Recorded for now — JAM does not read these folders yet,
          so the file browser still shows the demo tree.
        </p>
        {paths.map((path, index) => (
          <div className="editor-path" key={index}>
            <input
              className="mono"
              value={path}
              placeholder={pathPlaceholder}
              maxLength={limits.pathUtf16}
              onChange={(event) =>
                setPaths((current) =>
                  current.map((item, i) => (i === index ? event.target.value : item)),
                )
              }
            />
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
            className="button editor-add"
            onClick={() => setPaths((current) => [...current, ''])}
          >
            <FolderPlus size={13} />
            Add folder
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
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </Dialog>
  );
}
