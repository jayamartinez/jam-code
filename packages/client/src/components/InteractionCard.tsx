import { useState } from 'react';
import { Check, CircleHelp, ListChecks, ShieldAlert, X } from 'lucide-react';
import type { Interaction } from '@jam/protocol';

export type InteractionAnswer = { choiceId: string } | { answers: Record<string, string[]> };

const ICONS = {
  command: ShieldAlert,
  'file-change': ShieldAlert,
  tool: ShieldAlert,
  question: CircleHelp,
  plan: ListChecks,
} as const;

/**
 * A provider asking the reader something that is not tied to a visible tool
 * card: a question, a plan to approve, or a permission for a hidden tool.
 * Choices are exactly those the provider offered. Once answered, withdrawn
 * or expired, the card keeps its outcome and offers nothing to press.
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
  const outcome =
    interaction.outcome ?? (interaction.status === 'expired' ? 'No longer waiting' : 'Answered');

  return (
    <section
      className={`ask-card ${pending ? 'pending' : ''}`}
      aria-label={interaction.title}
      aria-live={pending ? 'polite' : undefined}
    >
      <header className="ask-card-header">
        <Icon size={13} strokeWidth={1.6} />
        <strong>{interaction.title}</strong>
        <span className="card-spacer" />
        {pending ? (
          <span className="tool-state awaiting">needs input</span>
        ) : (
          <span className="ask-card-outcome">
            {interaction.status === 'resolved' ? <Check size={12} /> : <X size={12} />}
            {outcome}
          </span>
        )}
      </header>
      {interaction.detail && <pre className="ask-card-detail">{interaction.detail}</pre>}
      {interaction.reason && <p className="ask-card-reason">{interaction.reason}</p>}
      {pending &&
        questions.map((question) => (
          <fieldset key={question.id} className="ask-question" disabled={busy}>
            <legend>{question.question}</legend>
            <div className="ask-options">
              {question.options.map((option) => {
                const chosen = selected[question.id]?.includes(option.label) ?? false;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className={`ask-option ${chosen ? 'selected' : ''}`}
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
                    <span className={`ask-mark ${question.multiSelect ? 'square' : ''}`}>
                      {chosen && <Check size={10} strokeWidth={2.4} />}
                    </span>
                    <span className="ask-option-text">
                      <span>{option.label}</span>
                      {option.description && <small>{option.description}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
            {question.allowOther && (
              <input
                className="ask-other"
                aria-label={`Another answer to: ${question.question}`}
                placeholder="Something else…"
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
        <div className="approval-actions ask-actions">
          {questions.length ? (
            <button
              type="button"
              className="approval-button allow primary"
              disabled={busy || !complete}
              onClick={() => respond({ answers })}
            >
              Send answer
            </button>
          ) : (
            interaction.choices.map((choice, index) => (
              <button
                key={choice.id}
                type="button"
                className={`approval-button ${choice.tone} ${index === 0 ? 'primary' : ''}`}
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
