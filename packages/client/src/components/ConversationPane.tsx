import {
  ArrowUp,
  ChevronDown,
  File,
  FolderOpen,
  GitBranch,
  Plus,
  Shield,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  ContextItem,
  JamTransport,
  Conversation,
  Message,
  Presentation,
  Project,
  ProviderDescriptor,
  ProviderId,
  Resource,
  Session,
} from '@jam/protocol';
import { IconButton, Shortcut } from './Controls';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { ProviderIcon, sessionProviderName } from './icons';
import { ContextChip } from './ContextChip';
import { ProjectBadge } from './ProjectBadge';
import type { InteractionAnswer } from './InteractionCard';
import { AgentBlocks } from './TranscriptBlocks';
import { ContextMeter } from './ContextMeter';
import { unavailableReason } from '../state/chat-draft';
import { composerChoices } from './composer-model';

interface ConversationProps extends Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
> {
  resource: Resource;
  project?: Project;
  session?: Session;
  conversation?: Conversation;
  draft: string;
  context: ContextItem[];
  snapshotTransport?: Pick<JamTransport, 'request'>;
  busy: boolean;
  shortcut: string;
  providers: ProviderDescriptor[];
  /** The session's options with any change the reader made since the last Send. */
  options: Record<string, string>;
  /** Reveal agent replies as they stream (General settings). */
  streamReplies: boolean;
  onOptions(options: Record<string, string>): void;
  onDraft(text: string): void;
  onSend(): void;
  onStop(): void;
  onCompact(): Promise<void>;
  onOpenReview(): void;
  onAddContext(): void;
  onPreviewContext(item: ContextItem): void;
  onRemoveContext(id: string): void;
  onRespond(interactionId: string, answer: InteractionAnswer): Promise<void>;
  onOpenUrl?(url: string): void;
  onOpenFile?(path: string): void;
}

export function ConversationPane(props: ConversationProps) {
  const { resource, project, session, conversation } = props;
  const transcript = useRef<HTMLDivElement>(null);
  const column = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Follow the thread's height, not its messages: a reply also grows while
  // it is revealed and when a finished turn shows its text.
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      if (follow.current && transcript.current)
        transcript.current.scrollTop = transcript.current.scrollHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const demo = session?.providerId === 'mock';
  const name = sessionProviderName(session);
  const messages = conversation?.messages ?? [];
  return (
    <PaneChrome
      className="conversation-pane"
      label={resource.title}
      focused={props.focused}
      onSplitRight={props.onSplitRight}
      onSplitDown={props.onSplitDown}
      onExpand={props.onExpand}
      expandLabel={props.expandLabel}
      menu={props.menu}
      heading={
        <>
          <ProjectBadge project={project} />
          <span className="project-label muted">{project?.name}</span>
          <span className="separator subtle">/</span>
          <span className="resource-title truncate">{resource.title}</span>
          <span className="branch mono">
            <GitBranch size={10} /> {project?.branch}
          </span>
        </>
      }
      status={
        <span className="provider-status">
          <span
            className={`status-dot ${session?.needsInput ? 'needs-input' : (session?.status ?? '')}`}
          />
          {name}{' '}
          <span className="subtle">
            {session?.needsInput ? 'needs input' : (session?.status ?? 'idle')}
          </span>
          {demo && <span className="demo-label">Demo</span>}
        </span>
      }
    >
      <div
        className="transcript"
        ref={transcript}
        onScroll={() => {
          const element = transcript.current;
          if (element)
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
        }}
      >
        <div className="thread-column" ref={column}>
          {conversation ? (
            messages.length ? (
              messages.map((message, index) => (
                <MessageView
                  key={message.id}
                  message={message}
                  session={session}
                  live={
                    session?.status === 'running' &&
                    message.role === 'assistant' &&
                    index === messages.length - 1
                  }
                  streamReplies={props.streamReplies}
                  actions={props}
                />
              ))
            ) : (
              <div className="empty-conversation">
                <h2>Ready when you are.</h2>
                <p>
                  {demo
                    ? 'This is a demo conversation. Describe a task to try streaming.'
                    : `Messages go to ${name} in this project's folder. Nothing is sent until you press Send.`}
                </p>
              </div>
            )
          ) : (
            <div className="muted" role="status">
              Loading conversation…
            </div>
          )}
        </div>
      </div>
      <Composer {...props} providerId={session?.providerId} />
    </PaneChrome>
  );
}

type ComposerProps = Pick<
  ConversationProps,
  | 'draft'
  | 'context'
  | 'snapshotTransport'
  | 'busy'
  | 'shortcut'
  | 'providers'
  | 'options'
  | 'onOptions'
  | 'onDraft'
  | 'onSend'
  | 'onStop'
  | 'onAddContext'
  | 'onPreviewContext'
  | 'onRemoveContext'
> & {
  session?: Session;
  project?: Project;
  isNew?: boolean;
  /** The adapter this chat runs on; a new chat has no session yet. */
  providerId?: ProviderId;
  /** A new chat also knows how it is presented before it has a session. */
  presentation?: Presentation;
  /** New chats only: choose the agent before the first Send. */
  onProvider?(providerId: ProviderId): void;
  onCompact?(): Promise<void>;
};

/** Options shown as composer pills; the rest live where they belong. */
const PILL_OPTIONS = new Set(['access']);

export function Composer(props: ComposerProps) {
  const running = props.session?.status === 'running';
  const providerId = props.providerId ?? props.session?.providerId;
  const descriptor = props.providers.find((provider) => provider.id === providerId);
  const demo = providerId === 'mock';
  const name = descriptor?.name ?? sessionProviderName(props.session);
  const reported =
    props.session?.model && props.session.model !== 'Default model'
      ? props.session.model
      : undefined;
  const choices = composerChoices(descriptor, props.options, reported);
  const pills = choices.options.filter((option) => PILL_OPTIONS.has(option.id));
  const blocked = demo
    ? null
    : !props.project?.paths?.length
      ? 'Add a folder to this project in its details. Agents run in the project’s folder.'
      : props.isNew
        ? unavailableReason(descriptor)
        : null;
  const set = (key: string, value: string) => props.onOptions({ ...props.options, [key]: value });
  const switchable = props.isNew
    ? props.providers.filter((provider) => provider.enabled || provider.id === providerId)
    : [];
  const glyph = (
    <ProviderIcon
      providerId={providerId}
      presentation={props.session?.presentation ?? props.presentation}
    />
  );
  return (
    <div className="composer-area">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blocked) props.onSend();
        }}
      >
        {!!props.context.length && (
          <div className="context-chips">
            {props.context.map((item) => (
              <ContextChip
                key={item.id}
                item={item}
                transport={props.snapshotTransport}
                onPreview={props.onPreviewContext}
                onRemove={props.onRemoveContext}
              />
            ))}
          </div>
        )}
        <textarea
          aria-label="Message"
          placeholder={
            running
              ? `Draft a follow-up while ${name} works…`
              : props.isNew
                ? 'Describe a task, paste an error, or add context…'
                : demo
                  ? 'Reply, or try /fail, /approval or /question…'
                  : `Reply to ${name}…`
          }
          value={props.draft}
          onChange={(event) => props.onDraft(event.target.value)}
          rows={props.isNew ? 2 : 1}
          disabled={props.busy}
          maxLength={20000}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!running && !props.busy && !blocked) props.onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-choices">
            {demo && (
              <IconButton label="Add demo context" onClick={props.onAddContext}>
                <Plus size={15} />
              </IconButton>
            )}
            {switchable.length > 1 && (
              <div className="provider-switch" role="radiogroup" aria-label="Agent">
                {switchable.map((provider) => {
                  const reason = unavailableReason(provider);
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      role="radio"
                      aria-checked={provider.id === providerId}
                      className={`provider-choice ${provider.id === providerId ? 'selected' : ''} ${reason ? 'unavailable' : ''}`}
                      title={reason ?? provider.name}
                      onClick={() => props.onProvider?.(provider.id)}
                    >
                      <ProviderIcon providerId={provider.id} />
                      {provider.name}
                    </button>
                  );
                })}
              </div>
            )}
            {demo ? (
              <span className="composer-pill static">
                {glyph}
                Demo model
              </span>
            ) : choices.models.length ? (
              <OptionSelect
                label="Model"
                className="composer-pill strong"
                icon={switchable.length > 1 ? undefined : glyph}
                value={choices.model}
                values={choices.models}
                disabled={props.busy}
                onChange={(value) => {
                  const next: Record<string, string> = { ...props.options, model: value };
                  if (!value) delete next.model;
                  // An effort the new model does not offer is dropped.
                  if (
                    next.effort &&
                    !composerChoices(descriptor, next).efforts.some((e) => e.value === next.effort)
                  )
                    delete next.effort;
                  props.onOptions(next);
                }}
              />
            ) : (
              switchable.length <= 1 && (
                <span className="composer-pill static strong">
                  {glyph}
                  {props.session?.model ?? name}
                </span>
              )
            )}
            {!demo && choices.efforts.length > 0 && (
              <OptionSelect
                label="Effort"
                className="composer-pill"
                value={choices.effort}
                values={choices.efforts}
                disabled={props.busy}
                onChange={(value) => {
                  const next = { ...props.options };
                  if (value) next.effort = value;
                  else delete next.effort;
                  props.onOptions(next);
                }}
              />
            )}
            {demo ? (
              <span className="composer-pill static policy">
                <Shield size={12} />
                No tools execute
              </span>
            ) : (
              // A new chat shows access in its footer, as in the design.
              !props.isNew &&
              pills.map((option) => (
                <OptionSelect
                  key={option.id}
                  label={option.label}
                  value={option.value}
                  values={option.values}
                  disabled={props.busy}
                  className="composer-pill policy"
                  icon={<Shield size={12} />}
                  onChange={(value) => set(option.id, value)}
                />
              ))
            )}
          </div>
          <span className="composer-spacer" />
          {!props.isNew && !demo && props.onCompact && (
            <ContextMeter
              usage={props.session?.usage}
              provider={descriptor}
              options={props.options}
              running={running}
              onOptions={props.onOptions}
              onCompact={props.onCompact}
            />
          )}
          {running ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={props.onStop}
              aria-label={`Stop ${name}`}
              title={`Stop this turn. The ${name} session stays resumable.`}
            >
              <Square size={9} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={props.busy || !!blocked || (!props.draft.trim() && !props.context.length)}
              aria-label="Send message"
              title={blocked ?? `${props.shortcut}+Enter to send`}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {props.isNew && (
          <div className="new-run-target">
            {demo ? (
              <span>
                <Shield size={11} /> Demo provider · no repository changes
              </span>
            ) : blocked ? (
              <span className="warning">
                <TriangleAlert size={11} /> {blocked}
              </span>
            ) : (
              <span className="new-run-choices">
                <FolderOpen size={11} />
                <span className="mono truncate">{props.project?.paths?.[0]}</span>
                {pills.map((option) => (
                  <OptionSelect
                    key={option.id}
                    label={option.label}
                    value={option.value}
                    values={option.values}
                    disabled={props.busy}
                    className="composer-footer-option"
                    icon={<Shield size={11} />}
                    onChange={(value) => set(option.id, value)}
                  />
                ))}
              </span>
            )}
            <Shortcut>{props.shortcut} ↵ send</Shortcut>
          </div>
        )}
      </form>
    </div>
  );
}

function OptionSelect({
  label,
  value,
  values,
  onChange,
  disabled,
  className,
  icon,
}: {
  label: string;
  value: string;
  values: { value: string; label: string; description?: string }[];
  onChange(value: string): void;
  disabled?: boolean;
  className: string;
  icon?: React.ReactNode;
}) {
  const current = values.find((item) => item.value === value);
  return (
    <label className={`${className} composer-select`} title={current?.description ?? label}>
      {icon}
      <span className="composer-select-value">{current?.label ?? label}</span>
      <ChevronDown size={10} className="composer-chevron" />
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {values.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MessageView({
  message,
  session,
  live,
  streamReplies,
  actions,
}: {
  message: Message;
  session?: Session;
  live: boolean;
  streamReplies: boolean;
  actions: Pick<ConversationProps, 'onOpenReview' | 'onRespond' | 'onOpenUrl' | 'onOpenFile'>;
}) {
  if (message.role === 'user')
    return (
      <article className="user-message">
        <div className="user-bubble">
          {message.blocks.map((block, index) =>
            block.type === 'text' ? (
              <p key={index}>{block.text}</p>
            ) : block.type === 'context' ? (
              <div className="sent-context" key={index}>
                {block.items.map((item) => (
                  <span key={item.id}>
                    <File size={11} />
                    {item.label}
                  </span>
                ))}
              </div>
            ) : null,
          )}
        </div>
        <time>{formatTime(message.createdAt)}</time>
      </article>
    );
  const demo = session?.providerId === 'mock';
  return (
    <article className="agent-message">
      <header className="agent-heading">
        <ProviderIcon presentation={session?.presentation} providerId={session?.providerId} />
        <strong>{sessionProviderName(session)}</strong>
        <span>
          {live ? <Working since={message.createdAt} /> : demo ? 'Demonstration' : session?.model}
        </span>
        <span className="agent-rule" />
      </header>
      <div className="agent-content">
        <AgentBlocks blocks={message.blocks} live={live} stream={streamReplies} actions={actions} />
      </div>
    </article>
  );
}

/** "Working for 1m 12s", ticking only while a turn runs. */
function Working({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return (
    <>
      Working for{' '}
      {hours
        ? `${hours}h ${minutes % 60}m`
        : minutes
          ? `${minutes}m ${seconds % 60}s`
          : `${seconds}s`}
    </>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
