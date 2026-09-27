import {
  ArrowUp,
  ChevronDown,
  File,
  FileText,
  GitBranch,
  Pencil,
  Plus,
  Search,
  Shield,
  Square,
  Terminal,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import type {
  ContextItem,
  Conversation,
  Message,
  MessageBlock,
  Presentation,
  Project,
  Resource,
  Session,
} from '@jam/protocol';
import { IconButton, Shortcut } from './Controls';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { ProviderIcon, providerName } from './icons';
import { ProjectBadge } from './ProjectBadge';

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
  busy: boolean;
  shortcut: string;
  onDraft(text: string): void;
  onSend(): void;
  onStop(): void;
  onOpenDemo(): void;
  onAddContext(): void;
  onPreviewContext(item: ContextItem): void;
  onRemoveContext(id: string): void;
}

export function ConversationPane(props: ConversationProps) {
  const { resource, project, session, conversation } = props;
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [conversation?.messages]);
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
          <span className={`status-dot ${session?.status ?? ''}`} />
          {providerName(session?.presentation)}{' '}
          <span className="subtle">{session?.status ?? 'idle'}</span>
          <span className="demo-label">Mock</span>
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
                <MessageView
                  key={message.id}
                  message={message}
                  session={session}
                  onOpenDemo={props.onOpenDemo}
                />
              ))
            ) : (
              <div className="empty-conversation">
                <h2>Ready when you are.</h2>
                <p>This is a mock conversation. Describe a task to try streaming.</p>
              </div>
            )
          ) : (
            <div className="muted" role="status">
              Loading conversation…
            </div>
          )}
        </div>
      </div>
      <Composer {...props} />
    </PaneChrome>
  );
}

export function Composer(
  props: Pick<
    ConversationProps,
    | 'draft'
    | 'context'
    | 'busy'
    | 'shortcut'
    | 'onDraft'
    | 'onSend'
    | 'onStop'
    | 'onAddContext'
    | 'onPreviewContext'
    | 'onRemoveContext'
  > & {
    session?: Session;
    isNew?: boolean;
    /** A new chat has no session yet, but already knows which agent it is for. */
    presentation?: Presentation;
  },
) {
  const running = props.session?.status === 'running';
  return (
    <div className="composer-area">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSend();
        }}
      >
        {!!props.context.length && (
          <div className="context-chips">
            {props.context.map((item) => (
              <span
                className={`context-chip ${item.kind.startsWith('browser') ? 'accent' : ''}`}
                key={item.id}
              >
                <button type="button" onClick={() => props.onPreviewContext(item)}>
                  <File size={11} />
                  <span className="truncate">{item.label}</span>
                </button>
                <button
                  className="remove-context"
                  type="button"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => props.onRemoveContext(item.id)}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          aria-label="Message"
          placeholder={
            running
              ? 'Draft a follow-up while Mock works…'
              : props.isNew
                ? 'Describe a task, paste an error, or add context…'
                : 'Reply, or try /fail to test a failed turn…'
          }
          value={props.draft}
          onChange={(event) => props.onDraft(event.target.value)}
          rows={props.isNew ? 2 : 1}
          disabled={props.busy}
          maxLength={20000}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!running && !props.busy) props.onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <IconButton label="Add demo context" onClick={props.onAddContext}>
            <Plus size={15} />
          </IconButton>
          <span className="model-label">
            <ProviderIcon presentation={props.session?.presentation ?? props.presentation} />
            Demo model
          </span>
          <button
            className="composer-option"
            disabled
            title="Model selection requires a live provider"
          >
            <ChevronDown size={10} />
          </button>
          <button
            className="composer-option"
            disabled
            title="Reasoning effort is not available for Mock"
          >
            High effort
            <ChevronDown size={10} />
          </button>
          <span className="composer-policy">
            <Shield size={12} />
            No tools execute
          </span>
          <span className="composer-spacer" />
          {running ? (
            <button
              type="button"
              className="send-button stop-button"
              onClick={props.onStop}
              aria-label="Stop mock turn"
              title="Stop mock turn"
            >
              <Square size={10} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={props.busy || (!props.draft.trim() && !props.context.length)}
              aria-label="Send message"
              title={`${props.shortcut}+Enter to send`}
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
        {props.isNew && (
          <div className="new-run-target">
            <span>
              <Shield size={11} /> Mock · no repository changes
            </span>
            <Shortcut>{props.shortcut} ↵ send</Shortcut>
          </div>
        )}
      </form>
    </div>
  );
}

function MessageView({
  message,
  session,
  onOpenDemo,
}: {
  message: Message;
  session?: Session;
  onOpenDemo(): void;
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
  return (
    <article className="agent-message">
      <header className="agent-heading">
        <ProviderIcon presentation={session?.presentation} />
        <strong>Mock</strong>
        <span>Demonstration</span>
        <span className="agent-rule" />
      </header>
      <div className="agent-content">
        {message.blocks.map((block, index) => (
          <Block
            key={block.type === 'tool' ? block.id : index}
            block={block}
            onOpenDemo={onOpenDemo}
          />
        ))}
      </div>
    </article>
  );
}

function Block({ block, onOpenDemo }: { block: MessageBlock; onOpenDemo(): void }) {
  if (block.type === 'text') return <p className="message-text">{block.text}</p>;
  if (block.type === 'context')
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
  if (block.kind === 'read' || block.kind === 'search')
    return (
      <details className="tool-summary">
        <summary>
          {block.kind === 'read' ? <FileText size={12} /> : <Search size={12} />}
          <span>{block.title}</span>
          <code className="truncate">{block.detail}</code>
        </summary>
        <pre>{block.detail}</pre>
      </details>
    );
  if (block.kind === 'edit')
    return (
      <div className="edit-block">
        <div className="tool-block-header">
          <Pencil size={12} />
          <strong>{block.title}</strong>
          <span className="success">
            +{block.files?.reduce((sum, file) => sum + file.added, 0) ?? 0}
          </span>
          <span className="danger">
            −{block.files?.reduce((sum, file) => sum + file.removed, 0) ?? 0}
          </span>
          <button onClick={onOpenDemo}>Review working tree →</button>
        </div>
        {block.files?.map((file, index) => (
          <button
            key={file.path}
            className={`changed-file ${index === 1 ? 'highlight' : ''}`}
            onClick={onOpenDemo}
          >
            <code className="truncate">{file.path}</code>
            {index === 0 ? (
              <span className="new-file">new</span>
            ) : index === 1 ? (
              <span className="open-diff">open diff</span>
            ) : null}
            <span className="file-count mono">
              +{file.added} −{file.removed}
            </span>
          </button>
        ))}
      </div>
    );
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
      <pre>{block.detail}</pre>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
