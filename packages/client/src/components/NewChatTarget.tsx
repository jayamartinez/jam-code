import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, FolderOpen, GitBranch, Search, TriangleAlert } from 'lucide-react';
import type { GitBranch as Branch, GitBranches, JamTransport, Project } from '@jam/protocol';
import { moveMenuFocus, useAnchoredMenu } from './anchored-menu';
import { ChoicePill } from './ChoicePill';
import { ProjectBadge } from './ProjectBadge';
import { WorktreeIcon } from './icons';
import type { ChatHome, DraftWorkspace } from '../state/chat-draft';
import { filterBranches, sameFolder, switchProblem, useBranches } from '../state/branches';

/**
 * Where a new chat works (Paper, "14 · New chat: project, workspace &
 * branch"). The project is chosen from the heading; the workspace and branch
 * sit in the composer's footer. Nothing here changes Git: the choices are
 * applied by the runtime on the first Send.
 */

/** The project name in "What should we work on in …?", opening the project list. */
export function ProjectSwitcher({
  projects,
  project,
  onChange,
  onAddProject,
}: {
  projects: readonly Project[];
  project?: Project;
  onChange(projectId: string): void;
  /** Opens the folder picker; absent where the host has none. */
  onAddProject?(): Promise<Project | null>;
}) {
  const { open, place, root, trigger, menu, layer, toggle, close, tabOut } = useAnchoredMenu({
    compact: true,
    onOpened: (element) =>
      (
        element.querySelector<HTMLElement>('[aria-checked="true"]') ??
        element.querySelector<HTMLElement>('[role="menuitemradio"]')
      )?.focus(),
  });
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>(
      '[role="menuitemradio"], [role="menuitem"]:not([disabled])',
    ) ?? []),
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
      {open &&
        layer(
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
              } else if (event.key === 'Tab') tabOut();
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
                  {item.folderMissing ? (
                    <small className="project-option-note">folder missing</small>
                  ) : (
                    !item.paths?.length && <small className="project-option-note">no folder</small>
                  )}
                  <span className="choice-option-check">
                    {selected && <Check size={12} strokeWidth={2} />}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              role="menuitem"
              className="choice-option project-menu-new"
              disabled={!onAddProject}
              title={onAddProject ? undefined : 'Adding a folder needs the desktop app'}
              onClick={() => {
                close(true);
                void onAddProject?.().then((added) => {
                  if (added && added.id !== project?.id) onChange(added.id);
                });
              }}
            >
              <span className="project-menu-new-badge" aria-hidden="true">
                +
              </span>
              <span className="choice-option-copy">
                <strong>New project…</strong>
              </span>
            </button>
          </div>,
        )}
    </span>
  );
}

const WORKSPACES = [
  {
    value: 'checkout',
    label: 'Current checkout',
    description: 'Work in the project’s folder on its current branch',
  },
  {
    value: 'worktree',
    label: 'New worktree',
    description:
      'Its own branch and folder, created when you send. Chats in parallel never edit the same files.',
  },
];

/** Shown only while the chat is in, or is going to, a worktree that exists. */
const EXISTING = {
  value: 'existing',
  label: 'Worktree',
  description: 'A worktree that already exists, with its own branch and folder',
};

/**
 * A chat's workspace and branch, reading the branches itself: a draft's
 * choice for its first Send, or a started chat's (`home`) for its next one.
 */
export function DraftWorkspacePicker({
  transport,
  projectId,
  worktreeId,
  home,
  checkoutFolder,
  workspace,
  chatRunning,
  disabled,
  onChange,
}: {
  transport: JamTransport;
  projectId: string;
  /** The worktree a started chat works in; its branches are read from there. */
  worktreeId?: string;
  home?: ChatHome;
  checkoutFolder?: string;
  workspace: DraftWorkspace;
  /** A chat is at work in the folder: the project's checkout, or this chat's. */
  chatRunning: boolean;
  disabled?: boolean;
  onChange(workspace: DraftWorkspace): void;
}) {
  const { list, error, refresh } = useBranches(transport, projectId, worktreeId);
  // A chat's agent may switch the checkout's branch itself, so the branch is
  // read again whenever one starts or stops there.
  const wasRunning = useRef(chatRunning);
  useEffect(() => {
    if (wasRunning.current === chatRunning) return;
    wasRunning.current = chatRunning;
    refresh();
  }, [chatRunning, refresh]);
  return (
    <WorkspaceTarget
      workspace={workspace}
      branches={list}
      error={error}
      home={home}
      checkoutFolder={checkoutFolder}
      disabled={disabled}
      onChange={onChange}
      onRefresh={refresh}
    />
  );
}

/**
 * The footer's workspace and branch pills. For a new chat they choose where
 * it starts. For a started chat (`home` says where it works) they stage a
 * change for its next Send, and an empty `workspace` means it stays.
 */
export function WorkspaceTarget({
  workspace,
  branches,
  error,
  home,
  checkoutFolder,
  disabled,
  onChange,
  onRefresh,
}: {
  workspace: DraftWorkspace;
  branches?: GitBranches;
  error?: string;
  home?: ChatHome;
  /** The project's own folder, to tell its checkout from a worktree. */
  checkoutFolder?: string;
  disabled?: boolean;
  onChange(workspace: DraftWorkspace): void;
  /** Reads the branches again, when the branch menu opens. */
  onRefresh(): void;
}) {
  if (error) {
    return (
      <span className="workspace-target">
        <FolderOpen size={11} />
        <span className="truncate">Current checkout · {error}</span>
      </span>
    );
  }
  if (branches && branches.state !== 'repository') {
    return (
      <span className="workspace-target">
        <FolderOpen size={11} />
        <span className="truncate">Current checkout · not a Git repository</span>
      </span>
    );
  }
  const locals = branches?.branches.filter((branch) => !branch.remote) ?? [];
  const chosen = locals.find((branch) => branch.name === workspace.branch);
  // Seen from a worktree, the project's checkout is the folder elsewhere.
  const checkoutBranch = locals.find((branch) => sameFolder(branch.worktree, checkoutFolder));
  // A started chat that picked a branch goes where that branch is checked out.
  const kind =
    workspace.kind ??
    (home && chosen?.worktree ? (chosen === checkoutBranch ? 'checkout' : 'existing') : home);
  const worktree = kind === 'worktree';
  // Returning to the checkout takes the branch it is on.
  const returning = home === 'existing' && workspace.kind === 'checkout';
  const pick = (branch: Branch) => {
    if (worktree)
      return onChange({ ...workspace, branch: branch.current ? undefined : branch.name });
    if (home) return onChange(branch.current ? {} : { branch: branch.name });
    if (branch.worktree) return onChange({ kind: 'existing', branch: branch.name });
    onChange({ kind: 'checkout', ...(branch.current ? {} : { branch: branch.name }) });
  };
  // Only a branch no folder has is switched to; otherwise the chat goes to
  // the folder that has the branch, and nothing is switched.
  const onSend: PendingBranch =
    returning || chosen?.worktree
      ? {
          note: 'works in its folder on Send',
          title: returning
            ? `Works in the checkout, on ${checkoutBranch?.name}, when you send`
            : `Works in ${chosen?.name}’s folder when you send`,
        }
      : {
          note: 'switches on Send',
          title: `Switches ${home === 'existing' ? 'this worktree' : 'the checkout'} to ${workspace.branch} when you send`,
        };
  return (
    <span className="workspace-target">
      <ChoicePill
        label="Workspace"
        rootClassName="workspace-choice"
        className={`workspace-pill ${worktree || kind === 'existing' ? 'worktree' : ''} ${kind ? '' : 'unchosen'}`}
        icon={worktree || kind === 'existing' ? <WorktreeIcon /> : <FolderOpen size={12} />}
        value={kind ?? ''}
        values={[
          ...(kind ? [] : [{ value: '', label: 'Choose where it works' }]),
          ...(kind === 'existing' || home === 'existing' ? [EXISTING] : []),
          ...WORKSPACES,
        ]}
        onChange={(next) => {
          // Another worktree is reached through its branch; choosing this one
          // only keeps a started chat where it is.
          if (next === 'existing') {
            if (home === 'existing') onChange({});
            return;
          }
          // Each workspace starts from the folder's current branch.
          onChange(next === home ? {} : { kind: next === 'worktree' ? 'worktree' : 'checkout' });
        }}
        disabled={disabled}
        compact
      />
      {kind && (
        <BranchPicker
          worktree={worktree}
          chosen={returning ? checkoutBranch?.name : workspace.branch}
          onSend={onSend}
          branches={branches}
          disabled={disabled || returning}
          onOpen={onRefresh}
          onPick={pick}
          onWorktree={() => onChange({ kind: 'worktree' })}
        />
      )}
    </span>
  );
}

/**
 * Searchable branches. Picking a branch no folder has switches the chat's
 * folder to it on Send, taking uncommitted changes along; picking one that a
 * worktree has checked out works in that worktree. For a new worktree, it
 * picks the base, local or as Git last fetched it.
 */
/** What Send will do with a branch other than the folder's current one. */
interface PendingBranch {
  /** Ends the pill's spoken label: "switches on Send". */
  note: string;
  /** The pill's tooltip, in full. */
  title: string;
}

function BranchPicker({
  worktree,
  chosen,
  onSend,
  branches,
  disabled,
  onOpen,
  onPick,
  onWorktree,
}: {
  worktree: boolean;
  chosen?: string;
  onSend: PendingBranch;
  branches?: GitBranches;
  disabled?: boolean;
  onOpen(): void;
  onPick(branch: Branch): void;
  onWorktree(): void;
}) {
  const [query, setQuery] = useState('');
  const { open, place, root, trigger, menu, layer, toggle, close, tabOut } = useAnchoredMenu({
    compact: true,
    onOpened: (element) => element.querySelector<HTMLInputElement>('input')?.focus(),
  });
  const current = branches?.current;
  const target = chosen ?? current;
  const pending = !worktree && chosen !== undefined && chosen !== current;
  const problem = branches && !worktree ? switchProblem(branches) : null;
  const groups = filterBranches(
    (branches?.branches ?? []).filter((branch) => worktree || !branch.remote),
    query,
  );
  const items = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"], [role="menuitemradio"]:not(:disabled)',
    ) ?? []),
  ];
  const finish = () => {
    setQuery('');
    close(true);
  };
  const choose = (branch: Branch) => {
    finish();
    onPick(branch);
  };

  const option = (branch: Branch) => {
    const selected = branch.name === target;
    // A folder that cannot switch can still hand the chat to another folder.
    const unavailable = !worktree && !!problem && !branch.worktree && !branch.current;
    return (
      <button
        key={`${branch.remote ? 'r' : 'l'}:${branch.name}`}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        disabled={unavailable}
        className={`choice-option branch-option ${selected ? 'selected' : ''}`}
        title={branch.worktree ? `Checked out in ${branch.worktree}` : undefined}
        onClick={() => choose(branch)}
      >
        <span className="choice-option-copy">
          <strong className="mono">{branch.name}</strong>
          {branch.worktree && !worktree && (
            <small className="truncate">Checked out in {branch.worktree}</small>
          )}
        </span>
        {branch.worktree && <span className="branch-tag">worktree</span>}
        {branch.current && <span className="branch-note">current</span>}
        {selected && pending && <span className="branch-note pending">on Send</span>}
        <span className="choice-option-check">
          {selected && <Check size={12} strokeWidth={2} />}
        </span>
      </button>
    );
  };

  const label = worktree ? `from ${target ?? 'current branch'}` : (target ?? 'detached');
  return (
    <div className="choice branch compact" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`choice-pill branch-pill ${pending ? 'pending' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${worktree ? 'Base branch' : 'Branch'}: ${target ?? 'none'}${pending ? `, ${onSend.note}` : ''}`}
        title={pending ? onSend.title : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) return finish();
          setQuery('');
          onOpen();
          toggle();
        }}
      >
        <GitBranch size={12} />
        <span className="choice-pill-value mono">{label}</span>
        <ChevronDown size={10} className="composer-chevron" />
      </button>
      {open &&
        layer(
          <div
            ref={menu}
            className="choice-menu model-menu branch-menu"
            role="menu"
            aria-label={worktree ? 'Base branch' : 'Branch'}
            style={place}
            onKeyDown={(event) => {
              if (moveMenuFocus(event, items())) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                finish();
              } else if (event.key === 'Tab') tabOut();
            }}
          >
            <label className="model-search">
              <Search size={13} />
              <input
                aria-label="Search branches"
                placeholder="Search branches"
                value={query}
                maxLength={120}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    items()[0]?.click();
                  }
                }}
              />
            </label>
            {problem && (
              <div className="branch-notice" role="note">
                <TriangleAlert size={12} />
                <span>
                  {problem}
                  <button
                    type="button"
                    role="menuitem"
                    className="branch-notice-action"
                    onClick={() => {
                      finish();
                      onWorktree();
                    }}
                  >
                    Start in a new worktree instead
                  </button>
                </span>
              </div>
            )}
            <div className="model-list">
              {!branches && <p className="model-empty">Reading branches…</p>}
              {!!groups.local.length && (
                <div className="choice-section" role="group" aria-label="Branches">
                  {worktree && <span className="choice-section-label">Start from</span>}
                  {groups.local.map(option)}
                </div>
              )}
              {!!groups.remote.length && (
                <div className="choice-section" role="group" aria-label="Remote branches">
                  <span className="choice-section-label">Remote</span>
                  {groups.remote.map(option)}
                </div>
              )}
              {branches && !groups.local.length && !groups.remote.length && (
                <p className="model-empty">No branches match “{query.trim()}”.</p>
              )}
            </div>
            {worktree && (
              <p className="branch-footnote">Remote branches as last fetched by your Git</p>
            )}
            {branches?.truncated && (
              <p className="branch-footnote">Showing the first 500 branches</p>
            )}
          </div>,
        )}
    </div>
  );
}
