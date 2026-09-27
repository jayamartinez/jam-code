import type { Project } from '@jam/protocol';
import { ProviderIcon } from '../../icons';
import { IDLE_THREAD_OPTIONS } from '../../../state/preferences';
import { ProjectBadge } from '../../ProjectBadge';
import {
  Card,
  Chip,
  PageHeader,
  Planned,
  Row,
  Section,
  Segmented,
  Select,
  Toggle,
} from '../controls';
import type { SettingsPageProps } from '../types';
import { NOTIFICATION_EVENTS, defaultProvider } from '../general-model';

/**
 * General: how new chats and threads start. The idle-thread suggestion, the
 * default provider and streamed replies are real today; every other control
 * shows its intended shape, disabled, beside a Planned mark.
 */
export default function GeneralPage({
  providers,
  projects,
  idleThreadDays,
  onIdleThreadDays,
  streamReplies,
  onStreamReplies,
  onNavigate,
}: SettingsPageProps) {
  const provider = defaultProvider(providers);
  return (
    <div className="sv-page">
      <PageHeader
        title="General"
        description="How new chats and threads start, where they work, and when JAM tells you about them."
      />

      <Section label="New chats">
        <Card>
          <Row
            title="Default agent"
            sub="Used when you start a chat without picking one. Each provider's own defaults live in Providers."
          >
            {provider ? (
              <span className="gt-pill">
                <ProviderIcon providerId={provider.id} />
                {provider.name}
              </span>
            ) : (
              <span className="sv-mono">None enabled</span>
            )}
          </Row>
          <Row
            title="Stream replies"
            sub="Show agent replies as they are written. Off shows each part once it is complete."
          >
            <Toggle label="Stream replies" on={streamReplies} onChange={onStreamReplies} />
          </Row>
          <Row
            title={
              <>
                Effort <Planned />
              </>
            }
          >
            <Segmented
              label="Effort"
              value="medium"
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
                { value: 'max', label: 'Max' },
              ]}
            />
          </Row>
          <Row
            title={
              <>
                Default permissions <Planned />
              </>
            }
            sub={
              <>
                Applies to new chats. Fine-tune it for each agent in{' '}
                <button type="button" className="sv-link" onClick={() => onNavigate('Providers')}>
                  Providers ›
                </button>
              </>
            }
          >
            <Segmented
              label="Default permissions"
              value="ask"
              options={[
                { value: 'ask', label: 'Ask for approval' },
                { value: 'edits', label: 'Auto-accept edits' },
                { value: 'full', label: 'Full access' },
              ]}
            />
          </Row>
        </Card>
      </Section>

      <Section
        label={
          <>
            Where new threads work <Planned />
          </>
        }
        hint="Projects will be able to override this"
      >
        <Card>
          <div className="sv-row general-worktree">
            <div className="sv-row-text">
              <strong>New threads start in</strong>
              <p>
                A worktree gives each thread its own branch and folder, so threads working in
                parallel never edit the same files.
              </p>
              <Segmented
                label="New threads start in"
                value="worktree"
                options={[
                  { value: 'checkout', label: 'Current checkout' },
                  { value: 'worktree', label: 'New worktree' },
                  { value: 'ask', label: 'Ask each time' },
                ]}
              />
            </div>
            <BranchDiagram />
          </div>
          <Row
            title="Worktree location"
            sub={<span className="sv-mono">../&lt;project&gt;-worktrees/&lt;thread&gt;</span>}
          >
            <button type="button" className="sv-button" disabled>
              Change…
            </button>
          </Row>
          <Row
            title="Branch prefix"
            sub="Followed by a short name from the thread's first message."
          >
            <input
              className="gt-input mono"
              aria-label="Branch prefix"
              value="jam/"
              disabled
              readOnly
            />
          </Row>
        </Card>
      </Section>

      <Section label="Startup">
        <Card>
          <Row
            title={
              <>
                On launch <Planned />
              </>
            }
            sub="Sessions that were running come back as interrupted, never as live."
          >
            <Segmented
              label="On launch"
              value="last"
              options={[
                { value: 'last', label: 'Reopen last workspace' },
                { value: 'chat', label: 'New chat' },
                { value: 'empty', label: 'Empty' },
              ]}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Threads" hint="JAM only suggests. A thread closes when you choose.">
        <Card className="general-threads">
          <div className="general-threads-rows">
            <Row
              title="Suggest closing idle threads"
              sub="Ask about an open thread nobody has used for this long."
            >
              <Select
                label="Suggest closing idle threads"
                value={idleThreadDays === null ? 'never' : String(idleThreadDays)}
                options={IDLE_THREAD_OPTIONS.map((option) => ({
                  value: option.value === null ? 'never' : String(option.value),
                  label: option.label,
                }))}
                onChange={(value) => onIdleThreadDays(value === 'never' ? null : Number(value))}
              />
            </Row>
            <Row
              title="Sending reopens a closed thread"
              sub="Closed threads stay searchable; nothing is deleted."
            >
              <Chip>Always</Chip>
            </Row>
          </div>
          <IdlePreview projects={projects} days={idleThreadDays} />
        </Card>
      </Section>

      <Section
        label={
          <>
            Thread notifications <Planned />
          </>
        }
      >
        <Card>
          <div className="general-matrix" role="table" aria-label="Thread notifications">
            <div className="general-matrix-row head" role="row">
              <span role="columnheader">When a thread…</span>
              <span role="columnheader">Notification</span>
              <span role="columnheader">Dock badge</span>
              <span role="columnheader">Sound</span>
            </div>
            {NOTIFICATION_EVENTS.map((event) => (
              <div className="general-matrix-row" role="row" key={event.id}>
                <span role="cell" className="general-matrix-event">
                  <i className={`general-dot ${event.tone}`} aria-hidden="true" />
                  {event.label}
                </span>
                {(['notification', 'badge', 'sound'] as const).map((channel) => (
                  <span role="cell" key={channel}>
                    <input
                      type="checkbox"
                      className="gt-check"
                      aria-label={`${event.label}: ${channel}`}
                      checked={event.defaults[channel]}
                      disabled
                      readOnly
                    />
                  </span>
                ))}
              </div>
            ))}
          </div>
          <Row
            title="Only when JAM isn't focused"
            sub="While you're looking at JAM, the sidebar shows it instead."
          >
            <Toggle label="Only when JAM isn't focused" on />
          </Row>
          <Row title="Sound">
            <Select
              label="Notification sound"
              value="chime"
              options={[{ value: 'chime', label: 'Soft chime' }]}
            />
          </Row>
        </Card>
      </Section>
    </div>
  );
}

/** A main checkout and two thread branches, drawn with the theme's own roles. */
function BranchDiagram() {
  return (
    <div className="general-branches" aria-hidden="true">
      <svg width="126" height="72" viewBox="0 0 126 72" fill="none">
        <path d="M6 12h112" className="trunk" />
        <path d="M26 12c0 22 6 28 26 28h66" className="branch one" />
        <path d="M46 12c0 34 10 48 32 48h40" className="branch two" />
        <circle cx="6" cy="12" r="2.5" className="node" />
        <circle cx="26" cy="12" r="2.5" className="node" />
        <circle cx="46" cy="12" r="2.5" className="node" />
        <circle cx="118" cy="40" r="2.5" className="tip one" />
        <circle cx="118" cy="60" r="2.5" className="tip two" />
      </svg>
      <div className="general-branch-labels">
        <span>main · checkout</span>
        <span className="one">jam/pane-restore</span>
        <span className="two">jam/browser-notes</span>
      </div>
    </div>
  );
}

/**
 * A picture of the suggestion in the sidebar, drawn with the first project's
 * real badge. The thread titles are illustrative and say so by being generic.
 */
function IdlePreview({ projects, days }: { projects: Project[]; days: number | null }) {
  const [first, second] = projects;
  return (
    <div className="general-idle-preview" aria-hidden="true">
      <div className="general-preview-project">
        <ProjectBadge project={first} />
        <span>{first?.name ?? 'Project'}</span>
      </div>
      <div className="general-preview-thread active">
        <span>A thread in use</span>
        <small>now</small>
      </div>
      <div className="general-preview-thread">
        <span>An idle thread</span>
        {days !== null && <em>Close?</em>}
      </div>
      {days !== null && <small className="general-preview-age">Idle {days + 2} days</small>}
      {second && (
        <div className="general-preview-project">
          <ProjectBadge project={second} />
          <span>{second.name}</span>
        </div>
      )}
    </div>
  );
}
