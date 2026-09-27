import type { ReactNode } from 'react';
import type { Project, ProviderId, Resource, Session } from '@jam/protocol';
import { ProviderIcon } from './icons';

interface NewChatProps {
  project?: Project;
  resources: Resource[];
  composer: ReactNode;
  providerId: ProviderId;
  sessionOf(resource: Resource): Session | undefined;
  onOpen(id: string): void;
  onStarter(text: string): void;
}

const DEMO_STARTERS = ['Explain the resource lifecycle', '/approval', '/question', '/fail'];
const STARTERS = [
  'Review my uncommitted diff',
  'Fix the failing tests',
  'Explain this repo’s layout',
];
const DEMO_LABELS: Record<string, string> = {
  '/approval': 'Try a simulated approval',
  '/question': 'Try a simulated question',
  '/fail': 'Test a failed turn',
};

export function NewChat({
  project,
  resources,
  composer,
  providerId,
  sessionOf,
  onOpen,
  onStarter,
}: NewChatProps) {
  const demo = providerId === 'mock';
  const folder = project?.paths?.[0];
  // The pane frame (header and controls) is supplied by the caller so a new
  // chat can occupy any pane, like every other resource.
  return (
    <>
      <div className="new-chat-body">
        <div className="new-chat-content">
          <div className="new-chat-heading">
            <h1>What should we work on in {project?.name}?</h1>
            <p className="mono">
              {[folder ?? 'no project folder', project?.branch, demo ? 'demo provider' : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          {composer}
          <div className="new-chat-suggestions">
            <div>
              <div className="suggestion-label">Continue in {project?.name}</div>
              {resources.slice(0, 3).map((resource) => {
                const session = sessionOf(resource);
                return (
                  <button
                    key={resource.id}
                    className="suggestion-row"
                    onClick={() => onOpen(resource.id)}
                  >
                    <ProviderIcon
                      presentation={session?.presentation}
                      providerId={session?.providerId}
                    />
                    <span className="truncate">{resource.title}</span>
                    {session?.needsInput && <span className="warning">needs input</span>}
                  </button>
                );
              })}
            </div>
            <div>
              <div className="suggestion-label">Start from</div>
              {(demo ? DEMO_STARTERS : STARTERS).map((text) => (
                <button key={text} className="suggestion-row" onClick={() => onStarter(text)}>
                  {DEMO_LABELS[text] ?? text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
