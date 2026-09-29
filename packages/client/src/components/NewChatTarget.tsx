import { Check, ChevronDown } from 'lucide-react';
import type { Project } from '@jam/protocol';
import { moveMenuFocus, useAnchoredMenu } from './anchored-menu';
import { ProjectBadge } from './ProjectBadge';

/**
 * Where a new chat works (Paper, "14 · New chat: project, workspace &
 * branch"). The project is chosen from the heading.
 */

/** The project name in "What should we work on in …?", opening the project list. */
export function ProjectSwitcher({
  projects,
  project,
  onChange,
}: {
  projects: readonly Project[];
  project?: Project;
  onChange(projectId: string): void;
}) {
  const { open, place, root, trigger, menu, toggle, close } = useAnchoredMenu({
    compact: true,
    onOpened: (element) =>
      (
        element.querySelector<HTMLElement>('[aria-checked="true"]') ??
        element.querySelector<HTMLElement>('[role="menuitemradio"]')
      )?.focus(),
  });
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []),
  ];
  return (
    <span className="project-switcher" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="project-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project: ${project?.name ?? 'none'}`}
        onClick={toggle}
      >
        {project?.name}
        <ChevronDown size={14} className="composer-chevron" />
      </button>
      {open && (
        <div
          ref={menu}
          className="choice-menu project-menu"
          role="menu"
          aria-label="Projects"
          style={place}
          onKeyDown={(event) => {
            if (moveMenuFocus(event, items())) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              close(true);
            } else if (event.key === 'Tab') close(false);
          }}
        >
          <span className="choice-section-label">Projects</span>
          {projects.map((item) => {
            const selected = item.id === project?.id;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`choice-option project-option ${selected ? 'selected' : ''}`}
                onClick={() => {
                  close(true);
                  if (!selected) onChange(item.id);
                }}
              >
                <ProjectBadge project={item} />
                <span className="choice-option-copy">
                  <strong>{item.name}</strong>
                </span>
                {!item.paths?.length && <small className="project-option-note">no folder</small>}
                <span className="choice-option-check">
                  {selected && <Check size={12} strokeWidth={2} />}
                </span>
              </button>
            );
          })}
          <div className="project-menu-new" aria-disabled="true" title="Adding projects is planned">
            <span className="project-menu-new-badge" aria-hidden="true">
              +
            </span>
            <span className="choice-option-copy">
              <strong>New project…</strong>
            </span>
            <small className="project-option-note">Planned</small>
          </div>
        </div>
      )}
    </span>
  );
}
