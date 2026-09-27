import { useState } from 'react';
import { CircleHelp, FilePen, ListChecks, ShieldAlert, Terminal } from 'lucide-react';
import type { Interaction, InteractionChoice } from '@jam/protocol';

export type InteractionAnswer = { choiceId: string } | { answers: Record<string, string[]> };

const ICONS = {
  command: Terminal,
  'file-change': FilePen,
  tool: ShieldAlert,
  question: CircleHelp,
  plan: ListChecks,
} as const;

const ENDED: Record<Exclude<Interaction['status'], 'pending'>, string> = {
  resolved: 'Answered',
  cancelled: 'Cancelled',
  expired: 'No longer waiting',
};

/**
 * A provider asking the reader: a permission for one tool call, or questions.
 * The choices are exactly those the provider offered for this request; JAM
 * adds no scope of its own. Once answered, withdrawn or expired the card
 * keeps its outcome as a record and offers nothing to press.
 */
export function InteractionCard({
  interaction,
  onRespond,
}: {
  interaction: Interaction;
  onRespond?(answer: InteractionAnswer): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const Icon = ICONS[interaction.kind] ?? ShieldAlert;
  const pending = interaction.status === 'pending' && !!onRespond;

  const respond = (answer: InteractionAnswer) => {
    if (!onRespond || busy) return;
    setBusy(true);
    void onRespond(answer).finally(() => setBusy(false));
  };

  const questions = interaction.questions ?? [];
  const answers = Object.fromEntries(
    questions.map((question) => {
      const typed = other[question.id]?.trim();
      const chosen = selected[question.id] ?? [];
      return [question.id, typed ? [...chosen, typed] : chosen];
    }),
  );
  const complete = questions.every((question) => {
    const count = answers[question.id]?.length ?? 0;
    return count > 0 && (question.multiSelect || count === 1);
  });

  return (
    <section
      className={`interaction-card ${interaction.status}`}
      aria-label={interaction.title}
      aria-live={interaction.status === 'pending' ? 'polite' : undefined}
    >
      <header className="interaction-header">
        <Icon size={13} />
        <strong>{interaction.title}</strong>
        <span className={`interaction-state ${interaction.status}`}>
          {interaction.status === 'pending'
            ? 'Needs your input'
            : (interaction.outcome ?? ENDED[interaction.status])}
        </span>
      </header>
      {interaction.detail && <pre className="interaction-detail">{interaction.detail}</pre>}
      {interaction.reason && <p className="interaction-reason">{interaction.reason}</p>}
      {questions.map((question) => (
        <fieldset key={question.id} className="interaction-question" disabled={!pending || busy}>
          <legend>
            {question.header && <span className="interaction-chip">{question.header}</span>}
            {question.question}
          </legend>
          <div className="interaction-options">
            {question.options.map((option) => {
              const chosen = selected[question.id]?.includes(option.label) ?? false;
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`interaction-option ${chosen ? 'selected' : ''}`}
                  aria-pressed={chosen}
                  onClick={() =>
                    setSelected((current) => {
                      const list = current[question.id] ?? [];
                      const next = question.multiSelect
                        ? chosen
                          ? list.filter((label) => label !== option.label)
                          : [...list, option.label]
                        : chosen
                          ? []
                          : [option.label];
                      return { ...current, [question.id]: next };
                    })
                  }
                >
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </button>
              );
            })}
          </div>
          {question.allowOther && (
            <input
              className="interaction-other"
              aria-label={`Another answer to: ${question.question}`}
              placeholder="Or type your own answer…"
              maxLength={4000}
              value={other[question.id] ?? ''}
              onChange={(event) =>
                setOther((current) => ({ ...current, [question.id]: event.target.value }))
              }
            />
          )}
        </fieldset>
      ))}
      {pending && (
        <div className="interaction-actions">
          {questions.length ? (
            <button
              type="button"
              className="interaction-button allow"
              disabled={busy || !complete}
              onClick={() => respond({ answers })}
            >
              Send answer
            </button>
          ) : (
            interaction.choices.map((choice: InteractionChoice) => (
              <button
                key={choice.id}
                type="button"
                className={`interaction-button ${choice.tone}`}
                disabled={busy}
                onClick={() => respond({ choiceId: choice.id })}
              >
                {choice.label}
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}
