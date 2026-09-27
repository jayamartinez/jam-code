import type { ReactNode } from 'react';
import type { Presentation, Project, Resource } from '@jam/protocol';
import { ProviderIcon } from './icons';

interface NewChatProps {
  project?: Project;
  resources: Resource[];
  composer: ReactNode;
  presentationOf(resource: Resource): Presentation | undefined;
  onOpen(id: string): void;
  onStarter(text: string): void;
}

export function NewChat({
  project,
  resources,
  composer,
  presentationOf,
  onOpen,
  onStarter,
}: NewChatProps) {
  // The pane frame (header and controls) is supplied by the caller so a new
  // chat can occupy any pane, like every other resource.
  return (
    <>
      <div className="new-chat-body">
        <div className="new-chat-content">
          <div className="new-chat-heading">
            <h1>What should we work on in {project?.name}?</h1>
            <p className="mono">{project?.branch} · demo project · Mock provider</p>
          </div>
          {composer}
          <div className="new-chat-suggestions">
            <div>
              <div className="suggestion-label">Continue in {project?.name}</div>
              {resources.slice(0, 3).map((resource) => (
                <button
                  key={resource.id}
                  className="suggestion-row"
                  onClick={() => onOpen(resource.id)}
                >
                  <ProviderIcon presentation={presentationOf(resource)} />
                  <span className="truncate">{resource.title}</span>
                </button>
              ))}
            </div>
            <div>
              <div className="suggestion-label">Start from</div>
              {['Explain the resource lifecycle', 'Try a streaming demo', '/fail'].map((text) => (
                <button key={text} className="suggestion-row" onClick={() => onStarter(text)}>
                  {text === '/fail' ? 'Test a failed turn' : text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
