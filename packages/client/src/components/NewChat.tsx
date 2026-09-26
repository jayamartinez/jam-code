import type { ReactNode } from 'react';
import type { Project, Resource } from '@jam/protocol';
import { ProviderGlyph } from './Sidebar';

interface NewChatProps {
  project?: Project;
  resources: Resource[];
  composer: ReactNode;
  onOpen(id: string): void;
  onStarter(text: string): void;
}

export function NewChat({ project, resources, composer, onOpen, onStarter }: NewChatProps) {
  return (
    <section className="pane">
      <header className="pane-header">
        <div className="pane-heading">
          <span className="muted">{project?.name}</span>
          <span className="subtle">/</span>
          <strong>New chat</strong>
        </div>
        <span className="subtle" style={{ fontSize: 11 }}>
          Not started · nothing is saved until you send
        </span>
      </header>
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
                  <ProviderGlyph />
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
    </section>
  );
}
