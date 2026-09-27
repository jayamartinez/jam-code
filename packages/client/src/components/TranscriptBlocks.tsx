import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot,
  Brain,
  Check,
  CircleAlert,
  File,
  FileText,
  Globe,
  Info,
  Pencil,
  Search,
  Terminal,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react';
import type { Interaction, MessageBlock } from '@jam/protocol';
import { InteractionCard, type InteractionAnswer } from './InteractionCard';

const AgentMarkdown = lazy(() => import('./AgentMarkdown'));

type ToolBlock = Extract<MessageBlock, { type: 'tool' }>;

export interface BlockActions {
  onOpenReview(): void;
  onRespond(interactionId: string, answer: InteractionAnswer): Promise<void>;
  onOpenUrl?(url: string): void;
  onOpenFile?(path: string): void;
}

const ROW_ICONS = {
  read: FileText,
  search: Search,
  tool: Wrench,
  web: Globe,
  agent: Bot,
} as const;

/**
 * The blocks of one agent message in Paper's conversation layout: prose,
 * compact activity rows grouped together, edit and command cards, and
 * approvals shown inside the card of the action they are about.
 */
export function AgentBlocks({
  blocks,
  live,
  stream,
  actions,
}: {
  blocks: MessageBlock[];
  /** The message is still being written by a running turn. */
  live: boolean;
  /** Reveal text as it streams; otherwise show each block once complete. */
  stream: boolean;
  actions: BlockActions;
}) {
  // Approvals belong to the block they are about, when that block is here.
  const attached = new Map<string, Interaction>();
  const toolIds = new Set(blocks.flatMap((block) => (block.type === 'tool' ? [block.id] : [])));
  for (const block of blocks)
    if (
      block.type === 'interaction' &&
      block.interaction.toolId &&
      toolIds.has(block.interaction.toolId)
    )
      attached.set(block.interaction.toolId, block.interaction);
  const lastText = blocks.map((block) => block.type).lastIndexOf('text');

  const out: ReactNode[] = [];
  let rows: ToolBlock[] = [];
  const flushRows = (key: number) => {
    if (!rows.length) return;
    out.push(
      <div className="activity-rows" key={`rows-${key}`}>
        {rows.map((row) => (
          <ActivityRow key={row.id} block={row} />
        ))}
      </div>,
    );
    rows = [];
  };
  blocks.forEach((block, index) => {
    if (
      block.type === 'tool' &&
      block.kind !== 'edit' &&
      block.kind !== 'command' &&
      !attached.has(block.id)
    ) {
      rows.push(block);
      return;
    }
    flushRows(index);
    switch (block.type) {
      case 'text':
        out.push(
          <StreamedText
            key={index}
            text={block.text}
            live={live && index === lastText && index === blocks.length - 1}
            stream={stream}
            actions={actions}
          />,
        );
        break;
      case 'reasoning':
        if (block.text.trim())
          out.push(
            <details className="reasoning-block" key={index}>
              <summary>
                <Brain size={13} />
                <span>Thinking</span>
              </summary>
              <p>{block.text}</p>
            </details>,
          );
        break;
      case 'notice': {
        const Icon =
          block.tone === 'error' ? CircleAlert : block.tone === 'warning' ? TriangleAlert : Info;
        out.push(
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
          out.push(
            <InteractionCard
              key={block.interaction.id}
              interaction={block.interaction}
              onRespond={(answer) => actions.onRespond(block.interaction.id, answer)}
            />,
          );
        break;
      case 'context':
        out.push(
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
      case 'tool': {
        const approval = attached.get(block.id);
        const footer = approval && (
          <ApprovalFooter
            interaction={approval}
            onRespond={(answer) => actions.onRespond(approval.id, answer)}
          />
        );
        out.push(
          block.kind === 'edit' ? (
            <EditCard
              key={block.id}
              block={block}
              footer={footer}
              awaiting={isPending(approval)}
              onOpenReview={actions.onOpenReview}
            />
          ) : block.kind === 'command' ? (
            <CommandCard
              key={block.id}
              block={block}
              footer={footer}
              awaiting={isPending(approval)}
            />
          ) : (
            <div className={`tool-card ${isPending(approval) ? 'awaiting' : ''}`} key={block.id}>
              <ActivityRow block={block} />
              {footer}
            </div>
          ),
        );
        break;
      }
    }
  });
  flushRows(blocks.length);
  return <>{out}</>;
}

const isPending = (interaction?: Interaction) => interaction?.status === 'pending';

/** One line of activity: what the agent read, searched or used. */
function ActivityRow({ block }: { block: ToolBlock }) {
  const Icon = ROW_ICONS[block.kind as keyof typeof ROW_ICONS] ?? Wrench;
  const [open, setOpen] = useState(false);
  const summary = block.detail.split('\n').find((line) => line.trim()) ?? '';
  const expandable = block.detail.trim().length > summary.length || block.detail.includes('\n');
  return (
    <div className={`activity ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="activity-row"
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((value) => !value)}
      >
        <span className="activity-icon">
          <Icon size={13} strokeWidth={1.6} />
        </span>
        <span className="activity-title">{block.title}</span>
        {summary && <span className="activity-detail">{summary}</span>}
        <ToolState status={block.status} />
      </button>
      {open && <pre className="activity-output">{block.detail}</pre>}
    </div>
  );
}

function ToolState({ status }: { status: ToolBlock['status'] }) {
  if (status === 'completed') return null;
  return (
    <span className={`tool-state ${status}`}>
      <span className={`status-dot ${status === 'running' ? 'running' : 'failed'}`} />
      {status === 'running' ? 'running' : 'failed'}
    </span>
  );
}

function EditCard({
  block,
  footer,
  awaiting,
  onOpenReview,
}: {
  block: ToolBlock;
  footer?: ReactNode;
  awaiting: boolean;
  onOpenReview(): void;
}) {
  const files = block.files ?? [];
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  return (
    <div className={`edit-card ${awaiting ? 'awaiting' : ''}`}>
      <div className="edit-card-header">
        <Pencil size={13} strokeWidth={1.6} />
        <strong className="truncate">{block.title}</strong>
        <span className="count success">+{added}</span>
        <span className="count danger">−{removed}</span>
        <span className="card-spacer" />
        {awaiting ? (
          <span className="tool-state awaiting">needs approval</span>
        ) : block.status !== 'completed' ? (
          <ToolState status={block.status} />
        ) : (
          <button type="button" className="card-link" onClick={onOpenReview}>
            Review diff →
          </button>
        )}
      </div>
      {files.map((file) => (
        <button type="button" key={file.path} className="edit-card-file" onClick={onOpenReview}>
          <code className="truncate">{file.path}</code>
          <span className="count">
            +{file.added} −{file.removed}
          </span>
        </button>
      ))}
      {block.status === 'failed' && block.detail && <p className="card-note">{block.detail}</p>}
      {footer}
    </div>
  );
}

function CommandCard({
  block,
  footer,
  awaiting,
}: {
  block: ToolBlock;
  footer?: ReactNode;
  awaiting: boolean;
}) {
  return (
    <div className={`command-card ${awaiting ? 'awaiting' : ''}`}>
      <div className="command-card-header">
        <Terminal size={12} strokeWidth={1.8} />
        <code className="truncate">{block.title}</code>
        {awaiting ? (
          <span className="tool-state awaiting">needs approval</span>
        ) : (
          <ToolState status={block.status} />
        )}
      </div>
      {/* A declined command's only output is the decision the footer already shows. */}
      {block.detail && !(footer && block.detail.trim() === 'Declined') && (
        <pre className="command-card-output">{block.detail}</pre>
      )}
      {footer}
    </div>
  );
}

/**
 * An approval inside the card of the action it is about. Pending, it offers
 * exactly the provider's choices; answered, it keeps one quiet line.
 */
function ApprovalFooter({
  interaction,
  onRespond,
}: {
  interaction: Interaction;
  onRespond(answer: InteractionAnswer): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  if (interaction.status !== 'pending') {
    const allowed = /allow|approv/i.test(interaction.outcome ?? '');
    return (
      <div className="approval-outcome">
        {allowed ? <Check size={12} /> : <X size={12} />}
        <span>{interaction.outcome ?? interaction.status}</span>
      </div>
    );
  }
  return (
    <div className="approval">
      <div className="approval-copy">
        <strong>{interaction.title}</strong>
        {interaction.reason && <span>{interaction.reason}</span>}
      </div>
      <div className="approval-actions">
        {interaction.choices.map((choice, index) => (
          <button
            key={choice.id}
            type="button"
            className={`approval-button ${choice.tone} ${index === 0 ? 'primary' : ''}`}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onRespond({ choiceId: choice.id }).finally(() => setBusy(false));
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
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
        Writing…
      </p>
    );
  return (
    <Suspense fallback={<p className="message-text">{shown}</p>}>
      <AgentMarkdown text={shown} onOpenUrl={actions.onOpenUrl} onOpenFile={actions.onOpenFile} />
    </Suspense>
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
