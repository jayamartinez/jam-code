import { useEffect, useRef } from 'react';
import type { Project, ProviderId } from '@jam/protocol';
import { ProviderIcon } from '../../icons';
import {
  IDLE_THREAD_OPTIONS,
  TIME_FORMAT_OPTIONS,
  useFinishSound,
} from '../../../state/preferences';
import { playFinishChime } from '../../finish-chime';
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
import { effortLabel } from '../../composer-model';
import {
  NOTIFICATION_EVENTS,
  defaultProvider,
  liveProviders,
  sharedDefault,
  sharedEfforts,
  withSharedDefault,
} from '../general-model';

/**
 * General: how new chats and threads start. The default agent, the effort
 * and permissions every agent starts with, the idle-thread suggestion,
 * streamed replies, the time format and where new threads start are real
 * today; every other control shows its intended shape,
 * disabled, beside a Planned mark.
 */
export default function GeneralPage({
  providers,
  projects,
  idleThreadDays,
  onIdleThreadDays,
  streamReplies,
  onStreamReplies,
  timeFormat,
  onTimeFormat,
  newThreadWorkspace,
  onNewThreadWorkspace,
  onNavigate,
  providerControl,
}: SettingsPageProps) {
  const provider = defaultProvider(providers);
  const [finishSound, setFinishSound] = useFinishSound();
  const agents = liveProviders(providers);
  // Effort levels come from the agents' models, which a check reports.
  useEffect(() => void providerControl.ensure(), [providerControl]);
  const efforts = sharedEfforts(providers);
  const effort = sharedDefault(providers, 'effort');
  const access = sharedDefault(providers, 'access');
  // A save replaces an agent's whole defaults record, so each change builds
  // on the one sent before it rather than on a snapshot that may be stale.
  const pending = useRef(new Map<string, Record<string, string>>());
  useEffect(() => pending.current.clear(), [providers]);
  const applyShared = (key: 'access' | 'effort', value: string) => {
    const latest = providers.map((agent) => {
      const defaults = pending.current.get(agent.id);
      return defaults ? { ...agent, defaults } : agent;
    });
    for (const change of withSharedDefault(latest, key, value)) {
      pending.current.set(change.providerId, change.defaults);
      void providerControl.configure(change);
    }
  };
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
            sub="New chats start with this agent; you can switch before sending."
          >
            {agents.some((agent) => agent.enabled) ? (
              <Segmented
                label="Default agent"
                value={(provider?.id ?? '') as string}
                options={agents
                  .filter((agent) => agent.enabled)
                  .map((agent) => ({
                    value: agent.id,
                    label: (
                      <span className="gt-agent-choice">
                        <ProviderIcon providerId={agent.id} />
                        {agent.name}
                      </span>
                    ),
                  }))}
                onChange={(id) =>
                  void providerControl.configure({ providerId: id as ProviderId, isDefault: true })
                }
              />
            ) : (
              <button type="button" className="sv-link" onClick={() => onNavigate('Providers')}>
                Turn on an agent in Providers ›
              </button>
            )}
          </Row>
          <Row
            title="Stream replies"
            sub="Show agent replies as they are written. Off shows each part once it is complete."
          >
            <Toggle label="Stream replies" on={streamReplies} onChange={onStreamReplies} />
          </Row>
          <Row
            title="Sound when an agent finishes"
            sub="A short chime when a chat's agent is done, wherever the chat is."
          >
            <Toggle
              label="Sound when an agent finishes"
              on={finishSound}
              onChange={(next) => {
                setFinishSound(next);
                if (next) playFinishChime();
              }}
            />
          </Row>
          <Row
            title="Effort"
            sub={
              effort === null
                ? 'Your agents currently start at different levels. Pick one to align them.'
                : 'For every agent. An agent whose model lacks a level keeps its own default.'
            }
            disabled={!efforts.length}
          >
            <Segmented
              label="Effort"
              value={effort ?? ''}
              options={[
                { value: '', label: 'Agent default' },
                ...efforts.map((level) => ({ value: level, label: effortLabel(level) })),
              ]}
              onChange={(value) => applyShared('effort', value)}
            />
          </Row>
          <Row
            title="Default permissions"
            sub={
              access === null
                ? 'Your agents currently start with different access. Pick one to align them.'
                : 'What agents may do without asking, in every new chat. A chat can still change it.'
            }
          >
            <Segmented
              label="Default permissions"
              value={access === null ? '' : access || 'ask'}
              options={[
                { value: 'ask', label: 'Ask for approval' },
                { value: 'edits', label: 'Auto-accept edits' },
                { value: 'full', label: 'Full access' },
              ]}
              onChange={(value) => applyShared('access', value)}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Messages">
        <Card>
          <Row title="Time format" sub="Message times and dividers: 2:14 PM or 14:14.">
            <Segmented
              label="Time format"
              value={timeFormat}
              options={TIME_FORMAT_OPTIONS}
              onChange={onTimeFormat}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Where new threads work" hint="Projects will be able to override this">
        <Card>
          <div className="sv-row general-worktree">
            <div className="sv-row-text">
              <strong>New threads start in</strong>
              <p>
                A worktree gives each thread its own branch and folder, so threads working in
                parallel never edit the same files. It is created when you send, and JAM never
                deletes it.
              </p>
              <Segmented
                label="New threads start in"
                value={newThreadWorkspace}
                onChange={onNewThreadWorkspace}
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
            sub={<span className="sv-mono">../&lt;repository&gt;-worktrees/&lt;name&gt;</span>}
          >
            <button type="button" className="sv-button" disabled>
              Change…
            </button>
            <Planned />
          </Row>
          <Row
            title="Branch prefix"
            sub="Followed by a short name from the thread's first message."
          >
            <Planned>Editing planned</Planned>
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
