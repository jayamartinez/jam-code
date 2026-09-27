import { Card, PageHeader, Planned, Row, Section, Select } from '../controls';
import type { SettingsPageProps } from '../types';

/**
 * Where JAM keeps its data. JAM cannot measure or manage that data from here
 * yet, so the meter shows no numbers and every action is disabled.
 */
const KINDS = [
  { id: 'database', label: 'Database', detail: 'Projects, conversations, search and settings' },
  { id: 'browser', label: 'Browser profile', detail: 'Site data from Browser tabs' },
];

export default function StoragePage({ platform }: SettingsPageProps) {
  const preview = platform === 'web';
  return (
    <div className="sv-page">
      <PageHeader
        title="Storage"
        description={
          preview
            ? 'This browser preview keeps everything in memory; closing the tab discards it.'
            : 'Projects, conversations and settings live in one local SQLite database.'
        }
      />

      <Card className="sv-usage">
        <div className="sv-usage-head">
          <strong>Storage use</strong>
          <Planned />
        </div>
        <div className="sv-usage-bar" aria-hidden="true" />
        <p className="sv-usage-note">JAM doesn’t measure its disk use yet.</p>
        <ul className="sv-usage-legend">
          {KINDS.map((kind) => (
            <li key={kind.id}>
              <span className={`sv-usage-swatch ${kind.id}`} />
              <div>
                <strong>{kind.label}</strong>
                <small>{kind.detail}</small>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Section label="Location and search">
        <Card>
          <Row
            title={
              <>
                Data folder
                <Planned />
              </>
            }
            sub="JAM’s app data folder, chosen by the system."
            disabled
          >
            <button type="button" className="sv-button" disabled>
              Reveal
            </button>
          </Row>
          <Row
            title="Search index"
            sub={
              preview
                ? 'The preview searches its in-memory messages.'
                : 'Full-text search with SQLite FTS5, updated as messages are saved.'
            }
          >
            <button type="button" className="sv-button" disabled>
              Rebuild index
            </button>
            <Planned />
          </Row>
        </Card>
      </Section>

      <Section label="Retention" hint={<Planned />}>
        <Card>
          <Row title="Keep snapshots" disabled>
            <Select
              label="Keep snapshots"
              value="attached"
              options={[{ value: 'attached', label: '7 days, unless attached' }]}
              disabled
            />
          </Row>
          <Row title="Keep logs" disabled>
            <Select
              label="Keep logs"
              value="14"
              options={[{ value: '14', label: '14 days' }]}
              disabled
            />
          </Row>
        </Card>
      </Section>

      <Section label="Export and reset" hint={<Planned />}>
        <Card>
          <Row
            title="Export data"
            sub="Projects, conversations and settings as JSON, with attachments alongside."
            disabled
          >
            <button type="button" className="sv-button" disabled>
              Export…
            </button>
          </Row>
          <Row
            title="Delete demo data"
            sub="Removes the sample projects and chats; your own work stays."
            disabled
          >
            <button type="button" className="sv-button danger" disabled>
              Delete…
            </button>
          </Row>
          <Row
            title={<span className="sv-danger-text">Reset JAM</span>}
            sub="Would stop running sessions first, then erase the database and settings."
            disabled
          >
            <button type="button" className="sv-button danger" disabled>
              Reset…
            </button>
          </Row>
        </Card>
      </Section>
    </div>
  );
}
