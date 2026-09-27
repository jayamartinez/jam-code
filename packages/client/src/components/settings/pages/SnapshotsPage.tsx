import { Play, Volume2 } from 'lucide-react';
import { Card, Keys, PageHeader, Planned, Row, Section, Select, Toggle } from '../controls';
import { SNAPSHOT_SOUNDS } from '../tools-model';

const CAPTURE_MODES = [
  { id: 'window', label: 'Active window' },
  { id: 'region', label: 'Region' },
  { id: 'screen', label: 'Full screen' },
] as const;

const DESTINATIONS = [
  { id: 'save', label: 'Save only' },
  { id: 'clipboard', label: 'Copy to clipboard' },
  {
    id: 'stage',
    label: 'Stage in the last-focused chat',
    sub: 'Added to its composer as context, for you to send.',
  },
] as const;

/**
 * Snapshots are designed but not built: capture needs native shortcut and
 * screen-capture work. The page shows the intended settings, all disabled,
 * and invents no files or sizes.
 */
export default function SnapshotsPage() {
  return (
    <div className="sv-page">
      <PageHeader
        title="Snapshots"
        description="Capture whatever you're looking at without leaving it, and hand it to an agent as context."
        aside={
          <>
            <Planned />
            <span className="tools-inline-label">Enabled</span>
            <Toggle label="Snapshots enabled" on={false} />
          </>
        }
      />

      <Section label="Capture">
        <Card>
          <Row title="Shortcut" sub="Works while JAM is in the background, without taking focus.">
            <Keys keys={['⇧ Shift', '⇧ Shift']} />
            <span className="tools-inline-label">double-tap</span>
            <button type="button" className="sv-button" disabled>
              Change
            </button>
          </Row>
          <div className="sv-row tools-capture">
            <div className="sv-row-text">
              <strong>What to capture</strong>
              <p>Hold ⌥ with the shortcut to pick a region once.</p>
            </div>
            <div className="tools-capture-tiles" role="radiogroup" aria-label="What to capture">
              {CAPTURE_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={mode.id === 'window'}
                  className={`tools-capture-tile ${mode.id} ${mode.id === 'window' ? 'active' : ''}`}
                  disabled
                >
                  <span className="tools-capture-picture" />
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      <Section label="After capture">
        <Card className="tools-destinations">
          <div role="radiogroup" aria-label="After capture">
            {DESTINATIONS.map((destination) => (
              <label
                key={destination.id}
                className={`tools-radio ${destination.id === 'stage' ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="snapshot-destination"
                  checked={destination.id === 'stage'}
                  disabled
                  readOnly
                />
                <span>
                  <strong>{destination.label}</strong>
                  {'sub' in destination && <small>{destination.sub}</small>}
                </span>
              </label>
            ))}
          </div>
          <Row title="Also bring JAM to the front">
            <Toggle label="Also bring JAM to the front" on={false} />
          </Row>
        </Card>
      </Section>

      <Section label="Feedback">
        <Card>
          <Row title="Flash the captured window" sub="A quick blink over what was captured.">
            <Toggle label="Flash the captured window" on />
          </Row>
          <Row
            title="Show a toast"
            sub="Says where the snapshot went, with Undo and Change destination."
          >
            <Toggle label="Show a toast" on />
          </Row>
          <Row title="Play a sound" sub="Shutter, Tick, Pop, Soft chime, or a system sound.">
            <span className="tools-sound">
              <Volume2 size={13} aria-hidden="true" />
              <Select label="Snapshot sound" value="shutter" options={SNAPSHOT_SOUNDS} />
            </span>
            <button
              type="button"
              className="sv-button tools-icon-button"
              aria-label="Play sound"
              disabled
            >
              <Play size={11} />
            </button>
            <Toggle label="Play a sound" on />
          </Row>
        </Card>
      </Section>

      <Section label="Storage">
        <Card>
          <Row title="Keep snapshots" sub="A snapshot attached to a chat stays with that chat.">
            <Select
              label="Keep snapshots"
              value="7d"
              options={[{ value: '7d', label: '7 days, unless attached to a chat' }]}
            />
            <button type="button" className="sv-button" disabled>
              Clear now
            </button>
          </Row>
        </Card>
      </Section>
    </div>
  );
}
