import { ChoicePill, type PillChoice } from './ChoicePill';

/**
 * The access level as one pill (Paper, "9 · Approvals & access"): muted for
 * Ask for approval, warning for Auto-accept edits, danger for Full access,
 * each with its own shield. The menu explains every level in the words the
 * agent's adapter gives for it.
 */
export function AccessPill({
  value,
  values,
  onChange,
  disabled,
  compact,
}: {
  value: string;
  values: PillChoice[];
  onChange(value: string): void;
  disabled?: boolean;
  /** The quieter form in a new chat's footer. */
  compact?: boolean;
}) {
  const current = values.find((item) => item.value === value) ?? values[0];
  if (!current) return null;
  return (
    <ChoicePill
      label="Access"
      rootClassName="access"
      className={`access-pill access-${current.value}`}
      icon={<AccessIcon level={current.value} />}
      optionIcon={(level) => (
        <span className={`access-option-icon access-${level}`}>
          <AccessIcon level={level} size={14} />
        </span>
      )}
      value={current.value}
      values={values}
      onChange={onChange}
      disabled={disabled}
      compact={compact}
    />
  );
}

/** A shield; a pencil inside for accepted edits, a bolt for full access. */
export function AccessIcon({ level, size = 12 }: { level: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="access-icon">
      <path
        d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4l5-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      {level === 'edits' && (
        <path d="M9.6 5.6l1.1 1.1-3.3 3.3H6.3V8.9l3.3-3.3z" fill="currentColor" />
      )}
      {level === 'full' && (
        <path d="M8.7 4.6L6.2 8.4h2l-.9 3 2.5-3.8h-2l.9-3z" fill="currentColor" />
      )}
    </svg>
  );
}
