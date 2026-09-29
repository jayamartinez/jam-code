import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  File,
  FileText,
  Globe,
  Info,
  Pencil,
  Search,
  ShieldAlert,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import type { FileChange, Interaction, Message, MessageBlock } from '@jam/protocol';
import { InteractionCard, type InteractionAnswer } from './InteractionCard';
import { FileLink, type FileLinkActions } from './FileLink';
import { localUrls } from './local-urls';
import { lastActionIndex } from './message-model';

const AgentMarkdown = lazy(() => import('./AgentMarkdown'));

type ToolBlock = Extract<MessageBlock, { type: 'tool' }>;

export interface BlockActions extends FileLinkActions {
  onOpenReview(): void;
  onRespond(interactionId: string, answer: InteractionAnswer): Promise<void>;
  onOpenUrl?(url: string): void;
  /** Opens a local address in the default browser instead of JAM's. */
  onOpenExternal?(url: string): void;
}

const ROW_ICONS = {
  read: FileText,
  search: Search,
  tool: Wrench,
  web: Globe,
  agent: Bot,
  edit: Pencil,
  command: Terminal,
} as const;

/**
 * One agent message (Paper, "10 · Live activity"): the turn's reads,
 * searches, edits and commands stream into one log that is open while the
 * agent works and folds to a summary when it is done. Approvals always show
 * outside the fold, in the card of the action they gate ("9 · Approvals").
 * The answer, the files it changed and any local server stay in view.
 */
export function AgentBlocks({
  message,
  live,
  stream,
  actions,
}: {
  message: Message;
  /** The message is still being written by a running turn. */
  live: boolean;
  /** Reveal text as it streams; otherwise show each block once complete. */
  stream: boolean;
  actions: BlockActions;
}) {
  const { blocks } = message;
  const [open, setOpen] = useState<boolean | null>(null);

  // Approvals belong to the block they are about, when that block is here.
  const approvals = new Map<string, Interaction>();
  const toolIds = new Set(blocks.flatMap((block) => (block.type === 'tool' ? [block.id] : [])));
  for (const block of blocks)
    if (
      block.type === 'interaction' &&
      block.interaction.toolId &&
      toolIds.has(block.interaction.toolId)
    )
      approvals.set(block.interaction.toolId, block.interaction);

  // Everything up to the last action is the log; the prose after it is the answer.
  const lastAction = lastActionIndex(blocks);
  const logged = blocks.slice(0, lastAction + 1);
  const tools = logged.filter((block): block is ToolBlock => block.type === 'tool');
  const lastText = blocks.map((block) => block.type).lastIndexOf('text');
  const expanded = open ?? live;

  const outside: ReactNode[] = [];
  const log: ReactNode[] = [];
  blocks.forEach((block, index) => {
    const inLog = index <= lastAction;
    switch (block.type) {
      case 'tool': {
        const approval = approvals.get(block.id);
        if (approval?.status === 'pending') {
          outside.push(
            <ToolCard key={block.id} block={block} approval={approval} actions={actions} />,
          );
          log.push(<LogRow key={block.id} block={block} actions={actions} waiting />);
        } else
          log.push(<LogRow key={block.id} block={block} approval={approval} actions={actions} />);
        break;
      }
      case 'reasoning':
        if (block.text.trim())
          log.push(
            <details className="reasoning-block" key={index}>
              <summary>
                <Brain size={13} />
                <span>Thinking</span>
              </summary>
              <p>{block.text}</p>
            </details>,
          );
        break;
      case 'text':
        if (inLog)
          log.push(
            <div className="log-text" key={index}>
              <Markdown text={block.text} actions={actions} />
            </div>,
          );
        else
          outside.push(
            <StreamedText
              key={index}
              text={block.text}
              live={live && index === lastText && index === blocks.length - 1}
              stream={stream}
              actions={actions}
            />,
          );
        break;
      case 'notice': {
        const Icon =
          block.tone === 'error' ? CircleAlert : block.tone === 'warning' ? TriangleAlert : Info;
        outside.push(
          <p
            key={index}
            className={`notice-block ${block.tone}`}
            role={block.tone === 'error' ? 'alert' : undefined}
          >
            <Icon size={13} />
            <span>{block.text}</span>
          </p>,
        );
        break;
      }
      case 'interaction':
        if (!block.interaction.toolId || !toolIds.has(block.interaction.toolId))
          outside.push(
            <InteractionCard
              key={block.interaction.id}
              interaction={block.interaction}
              onRespond={(answer) => actions.onRespond(block.interaction.id, answer)}
            />,
          );
        break;
      case 'context':
        outside.push(
          <div className="sent-context" key={index}>
            {block.items.map((item) => (
              <span key={item.id}>
                <File size={11} />
                {item.label}
              </span>
            ))}
          </div>,
        );
        break;
    }
  });

  const changed = changedFiles(tools);
  const servers = localUrls(
    tools.flatMap((tool) => (tool.kind === 'command' ? [tool.detail] : [])),
  );
  return (
    <>
      {log.length > 0 && (
        <TurnLog
          tools={tools}
          live={live}
          waiting={[...approvals.values()].some((approval) => approval.status === 'pending')}
          open={expanded}
          onToggle={() => setOpen(!expanded)}
        >
          {log}
        </TurnLog>
      )}
      {outside}
      {servers.map((url) => (
        <PreviewBar key={url} url={url} actions={actions} />
      ))}
      {!live && changed.length > 0 && (
        <ChangedFiles files={changed} actions={actions} onOpenReview={actions.onOpenReview} />
      )}
    </>
  );
}

/** The log's summary row, and the log itself when it is open. */
function TurnLog({
  tools,
  live,
  waiting,
  open,
  onToggle,
  children,
}: {
  tools: ToolBlock[];
  live: boolean;
  waiting: boolean;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const current = live ? [...tools].reverse().find((tool) => tool.status === 'running') : undefined;
  const counts = countActions(tools);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className={`turn-log ${open ? 'open' : ''} ${live ? 'live' : ''}`}>
      <button type="button" className="turn-log-summary" aria-expanded={open} onClick={onToggle}>
        <Chevron size={12} strokeWidth={1.8} className="turn-log-chevron" />
        {live && waiting ? (
          <>
            <span className="status-dot needs-approval-dot" aria-hidden="true" />
            <strong>Waiting for approval</strong>
            {current && <span className="turn-log-target">{target(current)}</span>}
            <span className="turn-log-counts">{counts.short}</span>
          </>
        ) : live ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <strong>{current ? verb(current, true) : 'Working'}</strong>
            {current && <span className="turn-log-target">{target(current)}</span>}
            <span className="turn-log-counts">{counts.short}</span>
          </>
        ) : (
          // The reply's heading says how long the turn took; the log says what it did.
          <span className="turn-log-done">{counts.long || 'Worked'}</span>
        )}
      </button>
      {open && <div className="turn-log-body">{children}</div>}
    </div>
  );
}

function countActions(tools: ToolBlock[]) {
  const files = new Set(
    tools.flatMap((tool) => (tool.kind === 'edit' ? (tool.files ?? []).map((f) => f.path) : [])),
  ).size;
  const commands = tools.filter((tool) => tool.kind === 'command').length;
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const short = [files && plural(files, 'file'), commands && plural(commands, 'command')]
    .filter(Boolean)
    .join(' · ');
  const long = [
    files && `edited ${plural(files, 'file')}`,
    commands && `ran ${plural(commands, 'command')}`,
    !files && !commands && tools.length && plural(tools.length, 'step'),
  ]
    .filter(Boolean)
    .join(', ');
  return { short, long: long && long[0]!.toUpperCase() + long.slice(1) };
}

/** "Edited" / "Editing", "Ran" / "Running": what a step did or is doing. */
function verb(tool: ToolBlock, running = tool.status === 'running'): string {
  switch (tool.kind) {
    case 'edit':
      return running ? 'Editing' : 'Edited';
    case 'command':
      return running ? 'Running' : 'Ran';
    default:
      return tool.title;
  }
}

function target(tool: ToolBlock): string {
  if (tool.kind === 'edit') return (tool.files ?? []).map((file) => file.path).join(', ');
  if (tool.kind === 'command') return tool.title;
  return tool.detail.split('\n').find((line) => line.trim()) ?? '';
}

/** One step in the log. Edits and commands open to their diff or output. */
function LogRow({
  block,
  approval,
  waiting,
  actions,
}: {
  block: ToolBlock;
  approval?: Interaction;
  waiting?: boolean;
  actions: BlockActions;
}) {
  const [open, setOpen] = useState(false);
  const Icon = ROW_ICONS[block.kind as keyof typeof ROW_ICONS] ?? Wrench;
  const files = block.kind === 'edit' ? (block.files ?? []) : [];
  const summary =
    block.kind === 'edit' || block.kind === 'command'
      ? ''
      : (block.detail.split('\n').find((line) => line.trim()) ?? '');
  const several = files.length > 1;
  const hasDetail =
    block.kind === 'edit'
      ? several || files.some((file) => file.diff)
      : block.kind === 'command'
        ? !!block.detail.trim()
        : block.detail.trim().length > summary.length || block.detail.includes('\n');
  return (
    <div className={`log-step ${open ? 'open' : ''}`}>
      <div className="log-row">
        <button
          type="button"
          className="log-row-toggle"
          aria-expanded={hasDetail ? open : undefined}
          disabled={!hasDetail}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="log-icon">
            {block.status === 'running' && !waiting ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Icon size={12} strokeWidth={1.7} />
            )}
          </span>
          <span className="log-verb">{verb(block)}</span>
          {block.kind === 'command' && <code className="log-detail truncate">{block.title}</code>}
          {summary && <span className="log-detail truncate">{summary}</span>}
        </button>
        {several ? (
          <span className="log-detail">{files.length} files</span>
        ) : (
          files.map((file) => <LogFile key={file.path} file={file} actions={actions} />)
        )}
        <span className="log-spacer" />
        {waiting ? (
          <span className="tool-state awaiting">waiting for you</span>
        ) : approval ? (
          <Outcome interaction={approval} />
        ) : (
          <ToolState status={block.status} />
        )}
      </div>
      {open &&
        (block.kind === 'edit' ? (
          <>
            {several && (
              <div className="log-files">
                {files.map((file) => (
                  <LogFile key={file.path} file={file} actions={actions} />
                ))}
              </div>
            )}
            {files.map((file) => file.diff && <DiffPreview key={file.path} diff={file.diff} />)}
          </>
        ) : (
          <pre className="log-output">{block.detail}</pre>
        ))}
    </div>
  );
}

function LogFile({ file, actions }: { file: FileChange; actions: BlockActions }) {
  return (
    <span className="log-file">
      <FileLink file={{ path: file.path }} actions={actions} />
      <span className="count success">+{file.added}</span>
      <span className="count danger">−{file.removed}</span>
    </span>
  );
}

function ToolState({ status }: { status: ToolBlock['status'] }) {
  if (status !== 'failed') return null;
  return <span className="tool-state failed">failed</span>;
}

function Outcome({ interaction }: { interaction: Interaction }) {
  const allowed = /allow|approv|accept/i.test(interaction.outcome ?? '');
  return (
    <span className={`log-outcome ${allowed ? 'allowed' : 'denied'}`}>
      {allowed ? <Check size={11} /> : <X size={11} />}
      {interaction.outcome ?? interaction.status}
    </span>
  );
}

/** An action waiting for approval, with what it would change. */
function ToolCard({
  block,
  approval,
  actions,
}: {
  block: ToolBlock;
  approval: Interaction;
  actions: BlockActions;
}) {
  const files = block.files ?? [];
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const Icon = ROW_ICONS[block.kind as keyof typeof ROW_ICONS] ?? Wrench;
  return (
    <div className={`approval-card ${block.kind}`}>
      <div className="approval-card-head">
        <Icon size={13} strokeWidth={1.6} />
        {block.kind === 'edit' ? (
          <>
            <strong>{block.title.startsWith('Write') ? 'Write' : 'Edit'}</strong>
            {files.map((file) => (
              <FileLink key={file.path} file={{ path: file.path }} actions={actions} />
            ))}
            <span className="count success">+{added}</span>
            <span className="count danger">−{removed}</span>
          </>
        ) : (
          <code className="truncate">{block.title}</code>
        )}
        <span className="log-spacer" />
        <span className="needs-approval">
          <span className="status-dot needs-approval-dot" />
          Needs approval
        </span>
      </div>
      {files.map((file) => file.diff && <DiffPreview key={file.path} diff={file.diff} limit={8} />)}
      {block.kind !== 'edit' && block.detail.trim() && (
        <pre className="approval-card-output">{block.detail}</pre>
      )}
      <ApprovalFooter
        interaction={approval}
        onRespond={(answer) => actions.onRespond(approval.id, answer)}
      />
    </div>
  );
}

/**
 * The approval itself: the agent's question and reason, then exactly its
 * choices. Allowing ones lead, the first as the primary button; denying
 * ones sit at the end, and the last of several reads as the strongest.
 */
function ApprovalFooter({
  interaction,
  onRespond,
}: {
  interaction: Interaction;
  onRespond(answer: InteractionAnswer): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const allow = interaction.choices.filter((choice) => choice.tone !== 'deny');
  const deny = interaction.choices.filter((choice) => choice.tone === 'deny');
  const button = (choice: Interaction['choices'][number], className: string) => (
    <button
      key={choice.id}
      type="button"
      className={`approval-button ${className}`}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void onRespond({ choiceId: choice.id }).finally(() => setBusy(false));
      }}
    >
      {choice.label}
    </button>
  );
  return (
    <div className="approval">
      <div className="approval-copy">
        <ShieldAlert size={15} strokeWidth={1.6} className="approval-icon" />
        <span>
          <strong>{interaction.title}</strong>
          {interaction.reason && <span>{interaction.reason}</span>}
        </span>
      </div>
      <div className="approval-actions">
        {allow.map((choice, index) => button(choice, index === 0 ? 'primary' : 'secondary'))}
        <span className="log-spacer" />
        {deny.map((choice, index) =>
          button(choice, deny.length > 1 && index === deny.length - 1 ? 'quiet danger' : 'quiet'),
        )}
      </div>
    </div>
  );
}

/** Changed lines from a file change's preview, folded after `limit`. */
function DiffPreview({ diff, limit }: { diff: string; limit?: number }) {
  const lines = diff.split('\n');
  const [all, setAll] = useState(false);
  const shown = limit && !all ? lines.slice(0, limit) : lines;
  return (
    <div className="diff-preview">
      {shown.map((line, index) =>
        line.startsWith('@') ? (
          <div className="diff-line gap" key={index}>
            ⋯
          </div>
        ) : (
          <div
            key={index}
            className={`diff-line ${line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : ''}`}
          >
            <span className="diff-mark">{line[0] === ' ' ? '' : line[0]}</span>
            <span className="diff-text">{line.slice(1)}</span>
          </div>
        ),
      )}
      {limit && lines.length > limit && (
        <button type="button" className="diff-more" onClick={() => setAll((value) => !value)}>
          {all ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

/** Every file the turn changed, once, with its total counts. */
function changedFiles(tools: ToolBlock[]): FileChange[] {
  const byPath = new Map<string, FileChange>();
  for (const tool of tools)
    if (tool.kind === 'edit' && tool.status !== 'failed')
      for (const file of tool.files ?? []) {
        const seen = byPath.get(file.path);
        byPath.set(
          file.path,
          seen
            ? { ...seen, added: seen.added + file.added, removed: seen.removed + file.removed }
            : file,
        );
      }
  return [...byPath.values()];
}

function ChangedFiles({
  files,
  actions,
  onOpenReview,
}: {
  files: FileChange[];
  actions: BlockActions;
  onOpenReview(): void;
}) {
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <div className="edit-card">
      <div className="edit-card-header">
        <Pencil size={13} strokeWidth={1.6} />
        <strong>
          {files.length} {files.length === 1 ? 'file' : 'files'} changed
        </strong>
        <span className="count success">+{added}</span>
        <span className="count danger">−{removed}</span>
        <span className="card-spacer" />
        <button type="button" className="card-link" onClick={onOpenReview}>
          Review diff →
        </button>
      </div>
      {files.map((file) => (
        <div key={file.path} className="edit-card-file">
          <FileLink file={{ path: file.path }} actions={actions} className="plain" />
          <span className="count">
            +{file.added} −{file.removed}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A local server a command started: preview it in JAM or the default browser. */
function PreviewBar({ url, actions }: { url: string; actions: BlockActions }) {
  if (!actions.onOpenUrl) return null;
  return (
    <div className="preview-bar">
      <Globe size={14} strokeWidth={1.6} className="preview-bar-icon" />
      <code className="truncate">{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</code>
      <button
        type="button"
        className="approval-button primary"
        onClick={() => actions.onOpenUrl?.(url)}
      >
        Open web preview
      </button>
      {actions.onOpenExternal && (
        <button
          type="button"
          className="approval-button secondary"
          onClick={() => actions.onOpenExternal?.(url)}
        >
          Open in browser
          <ArrowUpRight size={12} />
        </button>
      )}
    </div>
  );
}

function Markdown({ text, actions }: { text: string; actions: BlockActions }) {
  return (
    <Suspense fallback={<p className="message-text">{text}</p>}>
      <AgentMarkdown
        text={text}
        onOpenUrl={actions.onOpenUrl}
        onOpenFile={actions.onOpenFile}
        onFileMenu={actions.onFileMenu}
      />
    </Suspense>
  );
}

/**
 * Agent prose. While a turn writes it, new text is revealed smoothly; with
 * streaming off, the block appears once it is complete.
 */
function StreamedText({
  text,
  live,
  stream,
  actions,
}: {
  text: string;
  live: boolean;
  stream: boolean;
  actions: BlockActions;
}) {
  const shown = useRevealed(text, live && stream);
  if (live && !stream)
    return (
      <p className="writing" role="status">
        <span className="writing-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Writing…
      </p>
    );
  return (
    <div className={live && stream ? 'streaming' : undefined}>
      <Markdown text={shown} actions={actions} />
    </div>
  );
}

/**
 * Reveals `target` a little ahead of real time, catching up faster the
 * further behind it is, so bursts from the provider read as steady writing.
 */
export function useRevealed(target: string, active: boolean): string {
  const [count, setCount] = useState(active ? 0 : target.length);
  const frame = useRef<number | null>(null);
  const shown = useRef(count);
  useEffect(() => {
    if (!active) {
      shown.current = target.length;
      setCount(target.length);
      return;
    }
    const step = () => {
      const behind = target.length - shown.current;
      if (behind <= 0) {
        frame.current = null;
        return;
      }
      shown.current += Math.max(2, Math.ceil(behind / 10));
      setCount(Math.min(shown.current, target.length));
      frame.current = requestAnimationFrame(step);
    };
    if (shown.current > target.length) shown.current = target.length;
    frame.current ??= requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [target, active]);
  return target.slice(0, Math.min(count, target.length));
}
