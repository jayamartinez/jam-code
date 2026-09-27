import {
  ArrowUp,
  Bot,
  Brain,
  ChevronDown,
  CircleAlert,
  File,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Info,
  Pencil,
  Plus,
  Search,
  Shield,
  Square,
  Terminal,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useRef } from 'react';
import type {
  ContextItem,
  JamTransport,
  Conversation,
  Message,
  MessageBlock,
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
import { InteractionCard, type InteractionAnswer } from './InteractionCard';
import { unavailableReason } from '../state/chat-draft';
import { composerChoices, contextShare } from './composer-model';

const AgentMarkdown = lazy(() => import('./AgentMarkdown'));

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
  onOptions(options: Record<string, string>): void;
  onDraft(text: string): void;
  onSend(): void;
  onStop(): void;
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
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [conversation?.messages]);
  const demo = session?.providerId === 'mock';
  const name = sessionProviderName(session);
  const share = contextShare(session?.usage);
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
          {share && (
            <span className="subtle context-share" title={share.title}>
              {share.label}
            </span>
          )}
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
        <div className="thread-column">
          {conversation ? (
            conversation.messages.length ? (
              conversation.messages.map((message) => (
                <MessageView key={message.id} message={message} session={session} {...props} />
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
};

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
            {switchable.length > 1 ? (
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
            ) : (
              <span className="model-label">
                <ProviderIcon
                  providerId={providerId}
                  presentation={props.session?.presentation ?? props.presentation}
                />
                {demo
                  ? 'Demo model'
                  : choices.models.length
                    ? null
                    : (props.session?.model ?? name)}
              </span>
            )}
            {!demo && choices.models.length > 0 && (
              <OptionSelect
                label="Model"
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
            )}
            {!demo && choices.efforts.length > 0 && (
              <OptionSelect
                label="Effort"
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
              <span className="composer-policy">
                <Shield size={12} />
                No tools execute
              </span>
            ) : (
              // A new chat shows these in its footer, as in the design.
              !props.isNew &&
              choices.options.map((option) => (
                <OptionSelect
                  key={option.id}
                  label={option.label}
                  value={option.value}
                  values={option.values}
                  disabled={props.busy}
                  className="composer-policy"
                  icon={<Shield size={12} />}
                  onChange={(value) => set(option.id, value)}
                />
              ))
            )}
          </div>
          <span className="composer-spacer" />
          {running ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={props.onStop}
              aria-label={`Stop ${name}`}
              title={`Stop this turn. The ${name} session stays resumable.`}
            >
              <Square size={10} fill="currentColor" />
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
                {choices.options.map((option) => (
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
  className = 'composer-option',
  icon,
}: {
  label: string;
  value: string;
  values: { value: string; label: string; description?: string }[];
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}) {
  const current = values.find((item) => item.value === value);
  return (
    <label className={`${className} composer-select`} title={current?.description ?? label}>
      {icon}
      <span className="composer-select-value">{current?.label ?? label}</span>
      <ChevronDown size={10} />
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
  ...props
}: {
  message: Message;
  session?: Session;
} & Pick<ConversationProps, 'onOpenReview' | 'onRespond' | 'onOpenUrl' | 'onOpenFile'>) {
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
        <span>{demo ? 'Demonstration' : session?.model}</span>
        <span className="agent-rule" />
      </header>
      <div className="agent-content">
        {message.blocks.map((block, index) => (
          <Block key={block.type === 'tool' ? block.id : index} block={block} {...props} />
        ))}
      </div>
    </article>
  );
}

const SUMMARY_ICONS = {
  read: FileText,
  search: Search,
  tool: Wrench,
  web: Globe,
  agent: Bot,
} as const;

function Block({
  block,
  onOpenReview,
  onRespond,
  onOpenUrl,
  onOpenFile,
}: { block: MessageBlock } & Pick<
  ConversationProps,
  'onOpenReview' | 'onRespond' | 'onOpenUrl' | 'onOpenFile'
>) {
  switch (block.type) {
    case 'text':
      return (
        <Suspense fallback={<p className="message-text">{block.text}</p>}>
          <AgentMarkdown text={block.text} onOpenUrl={onOpenUrl} onOpenFile={onOpenFile} />
        </Suspense>
      );
    case 'reasoning':
      return block.text.trim() ? (
        <details className="reasoning-block">
          <summary>
            <Brain size={12} />
            <span>Thinking</span>
          </summary>
          <p>{block.text}</p>
        </details>
      ) : null;
    case 'notice': {
      const Icon =
        block.tone === 'error' ? CircleAlert : block.tone === 'warning' ? TriangleAlert : Info;
      return (
        <p
          className={`notice-block ${block.tone}`}
          role={block.tone === 'error' ? 'alert' : undefined}
        >
          <Icon size={12} />
          <span>{block.text}</span>
        </p>
      );
    }
    case 'interaction':
      return (
        <InteractionCard
          interaction={block.interaction}
          onRespond={(answer) => onRespond(block.interaction.id, answer)}
        />
      );
    case 'context':
      return (
        <div className="sent-context">
          {block.items.map((item) => (
            <span key={item.id}>
              <File size={11} />
              {item.label}
            </span>
          ))}
        </div>
      );
  }
  if (block.kind === 'edit') {
    const added = block.files?.reduce((sum, file) => sum + file.added, 0) ?? 0;
    const removed = block.files?.reduce((sum, file) => sum + file.removed, 0) ?? 0;
    return (
      <div className={`edit-block ${block.status}`}>
        <div className="tool-block-header">
          <Pencil size={12} />
          <strong className="truncate">{block.title}</strong>
          <span className="success">+{added}</span>
          <span className="danger">−{removed}</span>
          {block.status !== 'completed' && (
            <span className={`tool-state ${block.status === 'failed' ? 'danger' : ''}`}>
              <span className={`status-dot ${block.status === 'running' ? 'running' : ''}`} />
              {block.detail || block.status}
            </span>
          )}
          <button type="button" onClick={onOpenReview}>
            Review changes →
          </button>
        </div>
        {block.files &&
          block.files.length > 1 &&
          block.files.map((file) => (
            <button key={file.path} type="button" className="changed-file" onClick={onOpenReview}>
              <code className="truncate">{file.path}</code>
              <span className="file-count mono">
                +{file.added} −{file.removed}
              </span>
            </button>
          ))}
      </div>
    );
  }
  if (block.kind === 'command')
    return (
      <div className="command-block">
        <div className="tool-block-header">
          <Terminal size={12} />
          <strong className="mono truncate">{block.title}</strong>
          <span className={`tool-state ${block.status === 'failed' ? 'danger' : ''}`}>
            <span className={`status-dot ${block.status === 'running' ? 'running' : ''}`} />
            {block.status}
          </span>
        </div>
        {block.detail && <pre>{block.detail}</pre>}
      </div>
    );
  const Icon = SUMMARY_ICONS[block.kind];
  return (
    <details className={`tool-summary ${block.status}`}>
      <summary>
        <Icon size={12} />
        <span className="truncate">{block.title}</span>
        {block.status !== 'completed' && (
          <span className={`tool-state ${block.status === 'failed' ? 'danger' : ''}`}>
            <span className={`status-dot ${block.status === 'running' ? 'running' : ''}`} />
            {block.status}
          </span>
        )}
      </summary>
      {block.detail ? <pre>{block.detail}</pre> : <pre className="subtle">No output.</pre>}
    </details>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
