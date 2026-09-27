import { useEffect, useRef, useState } from 'react';
import type { ProviderDescriptor, SessionUsage } from '@jam/protocol';

/**
 * The composer's context ring and its popover (Paper, "8 · Context window
 * popover"): how full the provider says the context window is, automatic
 * compaction where the provider lets JAM switch it, and Compact now.
 */
export function ContextMeter({
  usage,
  provider,
  options,
  running,
  onOptions,
  onCompact,
}: {
  usage?: SessionUsage;
  provider?: ProviderDescriptor;
  options: Record<string, string>;
  running: boolean;
  onOptions(options: Record<string, string>): void;
  onCompact(): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  // A requested compaction is "asked" until the session starts running it,
  // then "running" until the session is idle again.
  const [phase, setPhase] = useState<'idle' | 'asked' | 'running'>('idle');
  const [touched, setTouched] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === 'asked' && running) setPhase('running');
    if (phase === 'running' && !running) setPhase('idle');
  }, [phase, running]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const used = usage?.contextTokens;
  const size = usage?.contextWindow;
  const known = !!used && !!size;
  const share = known ? Math.min(1, used / size) : 0;
  const percent = Math.round(share * 100);
  const high = share > 0.8;
  const compacting = phase !== 'idle';
  const name = provider?.name ?? 'The provider';
  const canCompact = provider?.capabilities.compact?.status === 'supported';
  const autoOption = provider?.options?.find((option) => option.id === 'autoCompact');
  const autoOn = (options.autoCompact ?? autoOption?.default) !== 'off';
  const radius = 6;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="context-meter" ref={root}>
      <button
        type="button"
        className={`context-ring ${high ? 'high' : ''} ${open ? 'open' : ''}`}
        aria-label={known ? `Context ${percent}% full` : 'Context usage'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r={radius} className="ring-track" />
          {known && (
            <circle
              cx="8"
              cy="8"
              r={radius}
              className="ring-fill"
              strokeDasharray={`${circumference * share} ${circumference}`}
              transform="rotate(-90 8 8)"
            />
          )}
        </svg>
        <span>{known ? `${percent}%` : '—'}</span>
      </button>
      {open && (
        <div
          className={`context-popover ${high ? 'high' : ''} ${compacting ? 'compacting' : ''}`}
          role="dialog"
          aria-label="Context window"
        >
          <div className="context-usage">
            {known ? (
              <>
                <div className="context-figures">
                  <strong title={`${used.toLocaleString()} tokens`}>{tokens(used)}</strong>
                  <span>of {tokens(size)} tokens</span>
                  <em>{tokens(Math.max(0, size - used))} free</em>
                </div>
                <div className="context-bar">
                  <span style={{ width: `${Math.max(1, percent)}%` }} />
                </div>
              </>
            ) : (
              <p className="context-unknown">No context size yet</p>
            )}
            <p className="context-source">
              {compacting
                ? `Updates when ${name} finishes`
                : known
                  ? `Reported by ${name} after the last turn`
                  : `${name} has not reported context use for this chat.`}
            </p>
          </div>
          <div className="context-actions">
            <div className={`context-action ${compacting ? 'quiet' : ''}`}>
              <span>
                Auto-compact
                {autoOption && (
                  <small>
                    {touched
                      ? 'Applies from your next message'
                      : autoOn
                        ? 'Summarize older turns when nearly full'
                        : 'Off · only when you compact'}
                  </small>
                )}
              </span>
              {autoOption ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoOn}
                  aria-label="Auto-compact"
                  className={`context-switch ${autoOn ? 'on' : ''}`}
                  onClick={() => {
                    setTouched(true);
                    onOptions({ ...options, autoCompact: autoOn ? 'off' : 'on' });
                  }}
                />
              ) : (
                <small>Managed by {name}</small>
              )}
            </div>
            <button
              type="button"
              className="context-action"
              disabled={!canCompact || running || compacting}
              onClick={() => {
                setPhase('asked');
                onCompact().catch(() => setPhase('idle'));
              }}
            >
              <span>
                {compacting ? 'Compacting…' : 'Compact now'}
                <small>
                  {compacting
                    ? 'Your next message waits for this'
                    : !canCompact
                      ? `${name} cannot compact from JAM`
                      : running
                        ? 'Available when this turn finishes'
                        : 'Keeps a summary, frees the rest'}
                </small>
              </span>
              {compacting ? (
                <svg
                  className="context-spinner"
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5 2.5v3.5H1.5M11 2.5v3.5h3.5M5 13.5V10H1.5M11 13.5V10h3.5" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 41k, 258k, 1M: the popover's figures; the exact count is in the title. */
function tokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(1))}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}
