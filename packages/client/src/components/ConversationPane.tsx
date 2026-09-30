import {
  ArrowBigUp,
  ArrowUp,
  CornerDownLeft,
  File,
  FolderOpen,
  GitBranch,
  Plus,
  Shield,
  Square,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
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
  Worktree,
} from '@jam/protocol';
import { IconButton, Shortcut } from './Controls';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { ProviderIcon, WorktreeIcon, sessionProviderName } from './icons';
import { ContextChip } from './ContextChip';
import { ProjectBadge } from './ProjectBadge';
import type { InteractionAnswer } from './InteractionCard';
import { AgentBlocks, type BlockActions } from './TranscriptBlocks';
import { AccessPill } from './AccessPill';
import type { FileReference } from '../markdown/file-refs';
import { ContextMeter } from './ContextMeter';
import { unavailableReason } from '../state/chat-draft';
import { ChoicePill } from './ChoicePill';
import { ModelPicker } from './ModelPicker';
import { CopyButton } from './CopyButton';
import type { TimeFormat } from '../state/preferences';
import {
  copyText,
  dividerLabel,
  formatClock,
  formatDuration,
  startsAfterGap,
  turnDuration,
} from './message-model';
import {
  composerChoices,
  effortSummary,
  folderName,
  modelLabel,
  modelMenu,
  reportedModel,
  sendsMessage,
  withoutStaleChoices,
  type ComposerChoices,
} from './composer-model';

interface ConversationProps extends Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'onClose' | 'menu'
> {
  resource: Resource;
  project?: Project;
  /** The worktree the chat works in, when it started in a new one. */
  worktree?: Worktree;
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
  /** How message times and dividers read (General settings). */
  timeFormat: TimeFormat;
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
  onOpenFile?(path: string, line?: number): void;
  onFileMenu?(file: FileReference, event: React.MouseEvent): void;
  onOpenExternal?(url: string): void;
  /** Stars or unstars a model in the picker (saved with the provider's settings). */
  onFavoriteModel?(providerId: ProviderId, model: string): void;
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
  const statusText = session?.needsInput ? 'needs input' : (session?.status ?? 'idle');
  return (
    <PaneChrome
      className="conversation-pane"
      label={resource.title}
      focused={props.focused}
      onSplitRight={props.onSplitRight}
      onSplitDown={props.onSplitDown}
      onExpand={props.onExpand}
      expandLabel={props.expandLabel}
      onClose={props.onClose}
      menu={props.menu}
      heading={
        <>
          <ProjectBadge project={project} />
          <span className="project-label muted">{project?.name}</span>
          <span className="separator subtle">/</span>
          <span className="resource-title truncate">{resource.title}</span>
          {props.worktree ? (
            <span className="branch mono" title={props.worktree.path}>
              <WorktreeIcon size={10} /> {props.worktree.branch}
            </span>
          ) : (
            <span className="branch mono">
              <GitBranch size={10} /> {project?.branch}
            </span>
          )}
        </>
      }
      status={
        <span className="provider-status">
          <span
            className={`status-dot ${session?.needsInput ? 'needs-input' : (session?.status ?? '')}`}
            title={`${name}: ${statusText}`}
          />
          <span className="provider-name">{name}</span> <span className="subtle">{statusText}</span>
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
                <Fragment key={message.id}>
                  {index > 0 && startsAfterGap(messages[index - 1]!, message) && (
                    <TimeDivider value={message.createdAt} format={props.timeFormat} />
                  )}
                  <MessageView
                    message={message}
                    session={session}
                    live={
                      session?.status === 'running' &&
                      message.role === 'assistant' &&
                      index === messages.length - 1
                    }
                    streamReplies={props.streamReplies}
                    timeFormat={props.timeFormat}
                    actions={props}
                  />
                </Fragment>
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
  | 'onFavoriteModel'
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
  /** New chats only: where the chat will work, in place of the folder name. */
  target?: React.ReactNode;
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
  const reported = reportedModel(props.session?.model);
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
  const chooseModel = (value: string) => {
    const next: Record<string, string> = { ...props.options, model: value };
    if (!value) delete next.model;
    props.onOptions(withoutStaleChoices(descriptor, next));
  };
  const mac = props.shortcut === '⌘';
  const altKey = mac ? '⌥' : 'Alt';
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
        onKeyDown={(event) => {
          // Alt+1–9 picks a numbered model from anywhere in the composer.
          const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
          if (!digit || !event.altKey || event.ctrlKey || event.metaKey || demo || props.busy)
            return;
          const model = modelMenu(descriptor, choices).shortcuts[Number(digit) - 1];
          if (model === undefined) return;
          event.preventDefault();
          if (model !== choices.model) chooseModel(model);
        }}
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
            const { key, shiftKey, keyCode, nativeEvent } = event;
            if (sendsMessage({ key, shiftKey, keyCode, isComposing: nativeEvent.isComposing })) {
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
              <ModelPicker
                descriptor={descriptor}
                choices={choices}
                icon={switchable.length > 1 ? undefined : glyph}
                altKey={altKey}
                disabled={props.busy}
                onChange={chooseModel}
                {...(props.onFavoriteModel && providerId
                  ? { onFavorite: (model: string) => props.onFavoriteModel?.(providerId, model) }
                  : {})}
              />
            ) : (
              switchable.length <= 1 && (
                <span className="composer-pill static strong">
                  {glyph}
                  {reported ? modelLabel(reported, descriptor) : name}
                </span>
              )
            )}
            {!demo && (choices.efforts.length > 0 || choices.speeds.length > 0) && (
              <EffortPill
                choices={choices}
                options={props.options}
                busy={props.busy}
                onOptions={props.onOptions}
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
                <AccessPill
                  key={option.id}
                  value={option.value}
                  values={option.values}
                  disabled={props.busy}
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
              title={blocked ?? `${mac ? 'Return' : 'Enter'} to send`}
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
                {props.target ?? (
                  <>
                    <FolderOpen size={11} />
                    <span className="truncate" title={props.project?.paths?.[0]}>
                      {folderName(props.project?.paths?.[0]) || props.project?.name}
                    </span>
                  </>
                )}
                {pills.map((option) => (
                  <AccessPill
                    key={option.id}
                    compact
                    value={option.value}
                    values={option.values}
                    disabled={props.busy}
                    onChange={(value) => set(option.id, value)}
                  />
                ))}
              </span>
            )}
            <SendHint mac={mac} />
          </div>
        )}
      </form>
    </div>
  );
}

/** Effort, with a Speed section when the model offers a faster one. */
function EffortPill({
  choices,
  options,
  busy,
  onOptions,
}: {
  choices: ComposerChoices;
  options: Record<string, string>;
  busy: boolean;
  onOptions(options: Record<string, string>): void;
}) {
  const setter = (key: string) => (value: string) => {
    const next = { ...options };
    if (value) next[key] = value;
    else delete next[key];
    onOptions(next);
  };
  const bolt = <Zap size={11} className="speed-mark" fill="currentColor" strokeWidth={0} />;
  const speed = {
    label: 'Speed',
    value: choices.speed,
    values: choices.speeds.map((item) => (item.value ? { ...item, mark: bolt } : item)),
    onChange: setter('speed'),
  };
  // A model with speeds but no effort levels offers speed alone.
  const main = choices.efforts.length
    ? {
        label: 'Effort',
        value: choices.effort,
        values: choices.efforts,
        onChange: setter('effort'),
      }
    : speed;
  return (
    <ChoicePill
      label={main.label}
      rootClassName="effort"
      className={`composer-pill ${choices.speed ? 'fast' : ''}`}
      icon={choices.speed ? bolt : undefined}
      summary={effortSummary(choices)}
      value={main.value}
      values={main.values}
      onChange={main.onChange}
      sections={main === speed || !choices.speeds.length ? undefined : [speed]}
      disabled={busy}
    />
  );
}

function MessageView({
  message,
  session,
  live,
  streamReplies,
  timeFormat,
  actions,
}: {
  message: Message;
  session?: Session;
  live: boolean;
  streamReplies: boolean;
  timeFormat: TimeFormat;
  actions: BlockActions;
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
        {/* Shown on hover or focus; the row keeps its space so the thread never moves. */}
        <div className="message-actions">
          <time dateTime={message.createdAt}>{formatClock(message.createdAt, timeFormat)}</time>
          <CopyButton text={copyText(message)} label="Copy message" />
        </div>
      </article>
    );
  const demo = session?.providerId === 'mock';
  const worked = live ? undefined : turnDuration(message);
  return (
    <article className="agent-message">
      <header className="agent-heading">
        <ProviderIcon presentation={session?.presentation} providerId={session?.providerId} />
        <strong>{sessionProviderName(session)}</strong>
        <span>
          {live ? (
            <Working since={message.createdAt} waiting={!!session?.needsInput} />
          ) : (
            [
              demo ? 'Demonstration' : modelLabel(reportedModel(session?.model) ?? ''),
              worked && `Worked for ${worked}`,
            ]
              .filter(Boolean)
              .join(' · ')
          )}
        </span>
        <span className="agent-rule" />
      </header>
      <div className="agent-content">
        <AgentBlocks message={message} live={live} stream={streamReplies} actions={actions} />
      </div>
      {!live && (
        <div className="message-actions">
          <CopyButton text={copyText(message)} label="Copy reply" />
        </div>
      )}
    </article>
  );
}

/** "Working for 1m 12s", ticking only while a turn runs. */
function Working({ since, waiting }: { since: string; waiting: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {waiting ? 'Waiting for you · ' : 'Working for '}
      {formatDuration(now - Date.parse(since))}
    </>
  );
}

/** A hairline with the time a chat picked up again after a pause or on a new day. */
function TimeDivider({ value, format }: { value: string; format: TimeFormat }) {
  const label = dividerLabel(value, format);
  return label ? (
    <div className="time-divider" role="separator" aria-label={label}>
      <time dateTime={value}>{label}</time>
    </div>
  ) : null;
}

/** The new-chat footer's keys: drawn Return and Shift on a Mac, words elsewhere. */
function SendHint({ mac }: { mac: boolean }) {
  return mac ? (
    <Shortcut>
      <span className="key-glyphs">
        <CornerDownLeft size={10} aria-label="Return" />
        send ·
        <ArrowBigUp size={10} aria-label="Shift" />
        <CornerDownLeft size={10} aria-label="Return" />
        new line
      </span>
    </Shortcut>
  ) : (
    <Shortcut>Enter send · Shift+Enter new line</Shortcut>
  );
}
