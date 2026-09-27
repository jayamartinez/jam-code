import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, Chip, Keys, PageHeader, Planned, Row, Section } from '../controls';
import { BINDING_GROUPS, filterBindings, keyLabels, usesCommand } from '../keybindings-data';
import type { SettingsPageProps } from '../types';

/**
 * The shortcuts JAM handles today, searchable. Rebinding does not exist yet,
 * so the recording and conflict states from the frame are not shown and the
 * controls that would change bindings are disabled.
 */
export default function KeybindingsPage({ platform }: SettingsPageProps) {
  const [query, setQuery] = useState('');
  const mac = usesCommand(platform);
  const groups = useMemo(() => filterBindings(BINDING_GROUPS, query, mac), [query, mac]);

  return (
    <div className="sv-page">
      <PageHeader
        title="Keybindings"
        description="The shortcuts JAM handles today. Changing them is planned."
        aside={
          <button type="button" className="sv-button quiet" disabled>
            Reset all
          </button>
        }
      />
      <div className="sv-keys-toolbar">
        <label className="sv-search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            placeholder="Search commands or keys"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search keybindings"
          />
        </label>
        <button type="button" className="sv-button" disabled>
          Changed only
        </button>
        <Planned />
      </div>

      {groups.map((group) => (
        <Section
          key={group.title}
          label={
            <>
              {group.title}
              <span className="sv-count">{group.bindings.length}</span>
            </>
          }
        >
          <Card>
            {group.bindings.map((binding) => (
              <Row key={binding.id} title={binding.command} sub={binding.sub}>
                <Chip>{binding.context}</Chip>
                <span className="sv-keys-slot">
                  <Keys keys={keyLabels(binding, mac)} />
                </span>
              </Row>
            ))}
          </Card>
        </Section>
      ))}

      {!query && (
        <Section label="Snapshots" hint={<Planned />}>
          <Card>
            <Row
              title="Capture the focused window"
              sub="Global, while JAM is in the background."
              disabled
            >
              <span className="sv-keys-slot">
                <Keys keys={mac ? ['⇧', '⇧'] : ['Shift', 'Shift']} />
              </span>
            </Row>
          </Card>
        </Section>
      )}

      {groups.length === 0 && <p className="sv-empty">No shortcut matches “{query.trim()}”.</p>}
    </div>
  );
}
