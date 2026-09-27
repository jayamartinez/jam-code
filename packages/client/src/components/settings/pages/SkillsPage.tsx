import { useState } from 'react';
import { FolderOpen, Plus, Search, X } from 'lucide-react';
import { ProviderIcon } from '../../icons';
import { Card, PageHeader, Planned, Row, Section, Segmented } from '../controls';
import { GLOBAL_INSTRUCTIONS, toggleAgent, type SkillAgent, type SkillScope } from '../tools-model';

const AGENTS: { id: SkillAgent; name: string }[] = [
  { id: 'claude', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
];

/**
 * Skills. JAM does not read skill folders or write outside projects yet, so
 * the list is an honest empty state and the Add skill flow can be walked
 * through but not confirmed.
 */
export default function SkillsPage() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="sv-page">
      <PageHeader
        title="Skills"
        description="Reusable instruction folders your agents can load. Each provider decides when to use one."
        aside={
          <>
            <Planned />
            <button type="button" className="sv-button" disabled>
              <FolderOpen size={12} aria-hidden="true" />
              Add folder…
            </button>
            <button
              type="button"
              className="sv-button primary"
              aria-expanded={adding}
              onClick={() => setAdding(true)}
            >
              <Plus size={12} aria-hidden="true" />
              Add skill…
            </button>
          </>
        }
      />

      {adding && <AddSkillPanel onClose={() => setAdding(false)} />}

      <Section
        label={
          <>
            Global instructions <Planned />
          </>
        }
        hint="The file each agent reads in every project."
      >
        <Card>
          {GLOBAL_INSTRUCTIONS.map((file) => (
            <div className="sv-row" key={file.agent}>
              <ProviderIcon providerId={file.agent} density="pane" />
              <div className="sv-row-text">
                <strong>{file.name}</strong>
                <p className="sv-mono">{file.path}</p>
              </div>
              <div className="sv-row-control">
                <button type="button" className="sv-button" disabled>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </Card>
      </Section>

      <Section label="Skills">
        <div className="tools-skill-toolbar">
          <label className="tools-search">
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search skills by name or description"
              aria-label="Search skills"
              disabled
            />
          </label>
          <Segmented
            label="Show skills for"
            value="all"
            options={[
              { value: 'all', label: 'All' },
              ...AGENTS.map((agent) => ({
                value: agent.id,
                label: (
                  <>
                    <ProviderIcon providerId={agent.id} />
                    {agent.name}
                  </>
                ),
              })),
            ]}
          />
        </div>
        <div className="gt-note tools-skills-empty">
          <span>
            <strong>No skills are listed yet</strong>
            Skill folders from this project and your home folder will appear here, each showing
            which agents can load it.
          </span>
        </div>
      </Section>
    </div>
  );
}

/**
 * The Add skill flow, inline rather than a native dialog. Choices are local
 * state; confirming waits on JAM being able to write skill folders.
 */
function AddSkillPanel({ onClose }: { onClose(): void }) {
  const [source, setSource] = useState<'folder' | 'blank'>('blank');
  const [name, setName] = useState('');
  const [agents, setAgents] = useState<SkillAgent[]>(['claude', 'codex']);
  const [scope, setScope] = useState<SkillScope>('project');
  return (
    <section className="tools-add-skill" aria-label="Add skill">
      <header>
        <h3>Add skill</h3>
        <button type="button" className="sv-button quiet" aria-label="Close" onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      <Row title="Skill">
        <Segmented<'blank' | 'folder'>
          label="Skill source"
          value={source}
          options={[
            { value: 'blank', label: 'New blank skill' },
            { value: 'folder', label: 'From a folder' },
          ]}
          onChange={setSource}
        />
      </Row>
      {source === 'blank' ? (
        <Row title="Name" sub="Lowercase words joined by dashes, like release-notes.">
          <input
            className="gt-input mono tools-skill-name"
            aria-label="Skill name"
            placeholder="release-notes"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Row>
      ) : (
        <Row title="Folder" sub="A folder containing a SKILL.md file.">
          <button type="button" className="sv-button" disabled>
            <FolderOpen size={12} aria-hidden="true" />
            Choose folder…
          </button>
        </Row>
      )}
      <Row title="Agents" sub="Which agents can load it. Pick one or several.">
        <div className="tools-agent-chips" role="group" aria-label="Agents">
          {AGENTS.map((agent) => (
            <button
              key={agent.id}
              type="button"
              aria-pressed={agents.includes(agent.id)}
              className={`tools-agent-chip ${agents.includes(agent.id) ? 'on' : ''}`}
              onClick={() => setAgents((current) => toggleAgent(current, agent.id))}
            >
              <ProviderIcon providerId={agent.id} />
              {agent.name}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Available in">
        <Segmented<SkillScope>
          label="Available in"
          value={scope}
          options={[
            { value: 'project', label: 'This project' },
            { value: 'everywhere', label: 'Everywhere' },
          ]}
          onChange={setScope}
        />
      </Row>
      <footer>
        <Planned>JAM can't write skill folders yet</Planned>
        <span className="tools-spacer" />
        <button type="button" className="sv-button quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="sv-button primary" disabled>
          Add skill
        </button>
      </footer>
    </section>
  );
}
