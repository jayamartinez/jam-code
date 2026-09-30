import { useEffect, useRef, useState } from 'react';
import { Folder, FolderOpen, Plus, X } from 'lucide-react';
import { PROJECT_ICONS, initialsOf, type Project, type ProjectIcon } from '@jam/protocol';
import { Dialog } from './Controls';
import { PRESET_GLYPHS, ProjectBadge, TONE_LABELS, squareProjectImage } from './ProjectBadge';

/**
 * A project's name, icon and folders (Paper, Core flows "16 · New project
 * dialog"): New project when `project` is absent, otherwise Edit project from
 * its context menu. Everything is staged here and sent in one request when
 * saved, so cancelling changes nothing.
 *
 * Folders read as their names with a folder mark; clicking one opens the
 * system chooser in that folder to swap it. With a chooser, folders only come
 * from it. The icon's choices live in a popover under the icon.
 */

type IconKind = ProjectIcon['kind'];

export function ProjectEditor({
  project,
  projects,
  onPickFolder,
  onSave,
  onClose,
}: {
  /** Absent for a new project. */
  project?: Project;
  /** Every project, so a folder another one has is caught before saving. */
  projects: readonly Project[];
  /** The system folder chooser, opened in `start` when given. */
  onPickFolder?(start?: string): Promise<string | null>;
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
  // Emoji icons can no longer be chosen; one a project already has is kept.
  const emoji = project?.icon?.kind === 'emoji' ? (project.icon.value ?? '') : '';
  const [image, setImage] = useState(
    project?.icon?.kind === 'image' ? project.icon.value : undefined,
  );
  const [iconOpen, setIconOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);

  const icon: ProjectIcon =
    kind === 'preset'
      ? { kind, value: preset, tone }
      : kind === 'emoji' && emoji
        ? { kind, value: emoji, tone }
        : kind === 'image' && image
          ? { kind, value: image }
          : tone === 'blue'
            ? { kind: 'initials' }
            : { kind: 'initials', tone };
  const shownName = name.trim() || project?.name || 'New project';
  const preview: Project = {
    id: project?.id ?? 'new',
    branch: project?.branch ?? '',
    ...project,
    name: shownName,
    initials: initialsOf(shownName),
    icon,
  };
  const limits = PROJECT_ICONS.limits;
  /** The other project that already has this folder, if one does. */
  const ownerOf = (path: string) =>
    projects.find(
      (other) =>
        other.id !== project?.id && (other.paths ?? []).some((known) => sameFolder(known, path)),
    );
  const taken = paths.map(ownerOf).find(Boolean);

  /** Adds a folder, or swaps the one at `index`, through the system chooser. */
  const choose = async (index?: number) => {
    if (!onPickFolder) return;
    const chosen = await onPickFolder(index === undefined ? undefined : paths[index]);
    if (!chosen) return;
    setPaths((current) => {
      if (index !== undefined) return current.map((item, i) => (i === index ? chosen : item));
      return current.includes(chosen) ? current : [...current, chosen];
    });
    if (!named && (index === 0 || !paths.length)) setName(folderName(chosen));
    requestAnimationFrame(() => nameField.current?.focus());
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError('A project needs a name.');
    if (!paths.length) return setError('Choose the project’s folder.');
    if (taken) return setError(`A folder here is already in ${taken.name}.`);
    if (kind === 'emoji' && !emoji) return setError('Choose an emoji, or another kind of icon.');
    if (kind === 'image' && !image) return setError('Choose an image first.');
    setSaving(true);
    try {
      await onSave({ name: name.trim(), paths, icon });
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
      className="project-dialog"
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="project-dialog-title">
          <h2>{project ? 'Edit project' : 'New project'}</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        {creating && !paths.length ? (
          <button
            type="button"
            className="project-dialog-choose"
            disabled={!onPickFolder}
            onClick={() => void choose()}
            autoFocus
          >
            <FolderOpen size={26} strokeWidth={1.5} />
            <strong>Choose a folder…</strong>
            <small>
              {onPickFolder
                ? 'Any folder on this computer. Git is optional.'
                : 'Choosing a folder needs the desktop app.'}
            </small>
          </button>
        ) : (
          <>
            <div className="project-dialog-identity">
              <div className="project-dialog-icon">
                <button
                  type="button"
                  className="project-dialog-icon-button"
                  aria-label="Choose icon"
                  aria-expanded={iconOpen}
                  onClick={() => setIconOpen((open) => !open)}
                >
                  <ProjectBadge project={preview} size={40} />
                </button>
                {iconOpen && (
                  <IconPopover
                    kind={kind}
                    tone={tone}
                    preset={preset}
                    image={image}
                    onKind={setKind}
                    onTone={setTone}
                    onPreset={setPreset}
                    onImage={setImage}
                    onError={setError}
                    onClose={() => setIconOpen(false)}
                  />
                )}
              </div>
              <input
                ref={nameField}
                className="project-dialog-name"
                aria-label="Project name"
                value={name}
                maxLength={limits.nameUtf16}
                placeholder="Project name"
                onChange={(event) => {
                  setName(event.target.value);
                  setNamed(true);
                }}
                autoFocus={!creating}
              />
            </div>

            <div className="project-dialog-folders" role="group" aria-label="Folders">
              <span className="project-dialog-label">Folders</span>
              {paths.map((path, index) => (
                <div className={`project-folder ${ownerOf(path) ? 'taken' : ''}`} key={path}>
                  <button
                    type="button"
                    className="project-folder-choose"
                    aria-label={`${folderName(path)}. Choose another folder`}
                    disabled={!onPickFolder}
                    onClick={() => void choose(index)}
                  >
                    <Folder size={15} strokeWidth={1.7} />
                    <span className="truncate">{folderName(path)}</span>
                  </button>
                  {ownerOf(path) ? (
                    <span className="project-folder-taken" role="alert">
                      Already in {ownerOf(path)?.name}
                    </span>
                  ) : (
                    index === 0 &&
                    paths.length > 1 && <span className="project-folder-primary">Primary</span>
                  )}
                  <button
                    type="button"
                    className="icon-button project-folder-remove"
                    aria-label={`Remove ${folderName(path)}`}
                    onClick={() => setPaths((current) => current.filter((_, i) => i !== index))}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {paths.length < limits.paths && onPickFolder && (
                <button type="button" className="project-folder-add" onClick={() => void choose()}>
                  <Plus size={15} strokeWidth={1.7} />
                  Add folder
                </button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="project-dialog-error" role="alert">
            {error}
          </p>
        )}
        <footer className="project-dialog-footer">
          <span className="project-dialog-hint">
            {paths.length && !taken ? `Enter to ${creating ? 'create' : 'save'}` : ''}
          </span>
          <button type="button" className="button quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={saving || !paths.length || Boolean(taken)}
          >
            {saving ? 'Saving…' : creating ? 'Create project' : 'Save'}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}

/** The icon's kinds, glyphs, image and tones, under the icon. */
function IconPopover({
  kind,
  tone,
  preset,
  image,
  onKind,
  onTone,
  onPreset,
  onImage,
  onError,
  onClose,
}: {
  kind: IconKind;
  tone: string;
  preset: string;
  image: string | undefined;
  onKind(kind: IconKind): void;
  onTone(tone: string): void;
  onPreset(preset: string): void;
  onImage(image: string): void;
  onError(message: string | null): void;
  onClose(): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      // The icon button toggles the popover itself.
      if (!root.current?.parentElement?.contains(target)) onClose();
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [onClose]);

  return (
    <div
      className="icon-popover"
      ref={root}
      role="dialog"
      aria-label="Project icon"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="icon-popover-kinds" role="tablist" aria-label="Icon type">
        {(['initials', 'preset', 'image'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={kind === option}
            className={kind === option ? 'active' : ''}
            onClick={() => onKind(option)}
          >
            {KIND_LABELS[option]}
          </button>
        ))}
      </div>

      {kind === 'preset' && (
        <div className="icon-popover-grid" role="listbox" aria-label="Glyph">
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
                onClick={() => onPreset(name)}
              >
                {Glyph && <Glyph size={15} strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}

      {kind === 'image' && (
        <div className="icon-popover-image">
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
                onError(null);
                try {
                  onImage(await squareProjectImage(file));
                } catch (cause) {
                  onError(cause instanceof Error ? cause.message : 'That image could not be used.');
                }
              }}
            />
          </label>
          <small>Cropped to a square, never stretched.</small>
        </div>
      )}

      {kind !== 'image' && (
        <div className="icon-popover-tones" role="radiogroup" aria-label="Colour">
          {PROJECT_ICONS.tones.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={tone === option}
              aria-label={TONE_LABELS[option] ?? option}
              title={TONE_LABELS[option] ?? option}
              className={`tone-swatch tone-${option} ${tone === option ? 'selected' : ''}`}
              onClick={() => onTone(option)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_LABELS: Record<IconKind, string> = {
  initials: 'Initials',
  preset: 'Glyph',
  emoji: 'Emoji',
  image: 'Image',
};

/** The last part of a folder path, written on either platform. */
function folderName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() || path
  );
}

/** Whether two folder paths name the same folder: separators, a trailing one and case aside. */
function sameFolder(a: string, b: string) {
  const plain = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return plain(a) === plain(b);
}
