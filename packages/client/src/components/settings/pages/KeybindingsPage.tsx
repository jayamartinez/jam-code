import { AlertTriangle, RotateCcw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { chordFor, useKeybindings } from '../../../state/keybindings';
import { Card, Chip, Keys, PageHeader, Planned, Row, Section } from '../controls';
import {
  ALL_BINDINGS,
  BINDING_GROUPS,
  chordFromEvent,
  chordProblem,
  chordTokens,
  defaultChord,
  filterBindings,
  keyLabels,
  tokenLabels,
  usesCommand,
  type Binding,
} from '../keybindings-data';
import type { SettingsPageProps } from '../types';

/**
 * Paper, Settings "Settings v2 · Keybindings". JAM's own commands can be
 * rebound: click the keys, press new ones. A chord another command has asks
 * before taking it; one a component keeps (Save file, terminal find) or one
 * text editing needs is refused. Changes apply immediately.
 */
export default function KeybindingsPage({ platform }: SettingsPageProps) {
  const mac = usesCommand(platform);
  const { overrides, assign, reset, resetAll } = useKeybindings(mac);
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<{ id: string; chord: string; other: Binding } | null>(
    null,
  );

  const labelsOf = (binding: Binding) => {
    if (!binding.editable) return keyLabels(binding, mac);
    const chord = chordFor(binding, overrides, mac);
    return chord ? tokenLabels(chordTokens(chord), mac) : [];
  };
  const isChanged = (binding: Binding) => Boolean(binding.editable && binding.id in overrides);
  const changedCount = ALL_BINDINGS.filter(isChanged).length;
  const groups = filterBindings(BINDING_GROUPS, query, mac, labelsOf)
    .map((group) => ({
      ...group,
      bindings: changedOnly ? group.bindings.filter(isChanged) : group.bindings,
    }))
    .filter((group) => group.bindings.length > 0);

  // While recording, every key goes to the recorder, not to JAM's shortcuts.
  useEffect(() => {
    if (!recording) return;
    const binding = ALL_BINDINGS.find((item) => item.id === recording);
    if (!binding) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const chord = chordFromEvent(event, mac);
      if (!chord) return;
      if (chord === 'escape') {
        setRecording(null);
        return;
      }
      const why = chordProblem(chord);
      if (why) {
        setProblem({ id: binding.id, text: why });
        return;
      }
      setRecording(null);
      if (chord === chordFor(binding, overrides, mac)) return;
      const kept = ALL_BINDINGS.find((item) => !item.editable && defaultChord(item, mac) === chord);
      if (kept) {
        setProblem({ id: binding.id, text: `${kept.command} (${kept.context}) keeps that one.` });
        return;
      }
      const other = ALL_BINDINGS.find(
        (item) =>
          item.editable && item.id !== binding.id && chordFor(item, overrides, mac) === chord,
      );
      if (other) setPending({ id: binding.id, chord, other });
      else assign(binding.id, chord);
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('.sv-key-button')) setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, [recording, mac, overrides, assign]);

  const record = (id: string) => {
    setProblem(null);
    setPending(null);
    setRecording((current) => (current === id ? null : id));
  };

  return (
    <div className="sv-page">
      <PageHeader
        title="Keybindings"
        description="Click a shortcut to record a new one. Changes apply immediately."
        aside={
          <button
            type="button"
            className="sv-button quiet"
            disabled={!changedCount}
            onClick={() => {
              resetAll();
              setChangedOnly(false);
            }}
          >
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
        <button
          type="button"
          className={`sv-button sv-changed-only ${changedOnly ? 'on' : ''}`}
          aria-pressed={changedOnly}
          disabled={!changedCount && !changedOnly}
          onClick={() => setChangedOnly((on) => !on)}
        >
          <i aria-hidden="true" />
          Changed only
          <span className="sv-count">{changedCount}</span>
        </button>
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
          <Card className="sv-keys-card">
            {group.bindings.map((binding) => {
              const labels = labelsOf(binding);
              const changed = isChanged(binding);
              const isRecording = recording === binding.id;
              const defaults = keyLabels(binding, mac);
              const sub = isRecording
                ? `${labels.length ? `Was ${labels.join(mac ? '' : '+')} · ` : ''}Esc cancels`
                : changed
                  ? `Default ${defaults.length ? defaults.join(mac ? '' : '+') : 'none'}`
                  : binding.sub;
              return (
                <div key={binding.id} className="sv-key-item">
                  <div className={`sv-row sv-key-row ${isRecording ? 'recording' : ''}`}>
                    <span
                      className={`sv-key-mark ${pending?.id === binding.id ? 'conflict' : changed || isRecording ? 'changed' : ''}`}
                      aria-hidden="true"
                    />
                    <div className="sv-row-text">
                      <strong>{binding.command}</strong>
                      {sub && <p>{sub}</p>}
                    </div>
                    <div className="sv-row-control">
                      <Chip>{binding.context}</Chip>
                      {binding.editable && changed && !isRecording && (
                        <button
                          type="button"
                          className="sv-key-reset"
                          aria-label={`Reset ${binding.command} to its default`}
                          title="Reset to default"
                          onClick={() => reset(binding.id)}
                        >
                          <RotateCcw size={11} />
                        </button>
                      )}
                      {binding.editable ? (
                        <button
                          type="button"
                          className={`sv-keys-slot sv-key-button ${isRecording ? 'recording' : ''}`}
                          aria-label={`Change the shortcut for ${binding.command}`}
                          aria-pressed={isRecording}
                          onClick={() => record(binding.id)}
                        >
                          {isRecording ? (
                            <span className="sv-key-listening">
                              <i aria-hidden="true" />
                              Press keys…
                            </span>
                          ) : labels.length ? (
                            <Keys keys={labels} />
                          ) : (
                            <span className="sv-key-unset">Not set</span>
                          )}
                        </button>
                      ) : (
                        <span className="sv-keys-slot" title="Built into this part of JAM">
                          <Keys keys={labels} />
                        </span>
                      )}
                    </div>
                  </div>
                  {pending?.id === binding.id && (
                    <div className="sv-key-conflict" role="alert">
                      <AlertTriangle size={13} aria-hidden="true" />
                      <span>
                        Also used by <strong>{pending.other.command}</strong> — replace it?
                      </span>
                      <button
                        type="button"
                        className="sv-button quiet"
                        onClick={() => setPending(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="sv-button warning"
                        onClick={() => {
                          assign(pending.id, pending.chord);
                          setPending(null);
                        }}
                      >
                        Replace
                      </button>
                    </div>
                  )}
                  {problem?.id === binding.id && (
                    <p className="sv-key-problem" role="alert">
                      {problem.text}
                    </p>
                  )}
                </div>
              );
            })}
          </Card>
        </Section>
      ))}

      {!query && !changedOnly && (
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

      {groups.length === 0 && (
        <p className="sv-empty">
          {changedOnly ? 'No shortcuts changed.' : `No shortcut matches “${query.trim()}”.`}
        </p>
      )}
    </div>
  );
}
