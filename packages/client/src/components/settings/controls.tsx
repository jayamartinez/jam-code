import type { ReactNode } from 'react';

/**
 * The Settings v2 vocabulary, shared by every page: a page header, labelled
 * sections holding raised cards of rows, and the few controls rows use. Pages
 * compose these and add one distinctive element of their own; they should not
 * restyle the pieces.
 */

export function PageHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="sv-page-header">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {aside && <div className="sv-page-aside">{aside}</div>}
    </header>
  );
}

export function Section({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sv-section">
      <div className="sv-section-label">
        <h3>{label}</h3>
        {hint && <span>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`sv-card ${className ?? ''}`}>{children}</div>;
}

/** Title and optional sub on the left, the control on the right. */
export function Row({
  title,
  sub,
  children,
  disabled,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`sv-row ${disabled ? 'disabled' : ''}`}>
      <div className="sv-row-text">
        <strong>{title}</strong>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="sv-row-control">{children}</div>}
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  disabled,
}: {
  label: string;
  on: boolean;
  onChange?(on: boolean): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || !onChange}
      className={`sv-toggle ${on ? 'on' : ''}`}
      onClick={() => onChange?.(!on)}
    />
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange?(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="sv-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'active' : ''}
          disabled={disabled || !onChange}
          onClick={() => onChange?.(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange?(value: T): void;
  disabled?: boolean;
}) {
  return (
    <select
      className="sv-select"
      aria-label={label}
      value={value}
      disabled={disabled || !onChange}
      onChange={(event) => onChange?.(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Marks behaviour JAM does not have yet. Controls beside it are disabled, never simulated. */
export function Planned({ children = 'Planned' }: { children?: ReactNode }) {
  return <span className="sv-chip planned">{children}</span>;
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'success' | 'warning' }) {
  return <span className={`sv-chip ${tone ?? ''}`}>{children}</span>;
}

export function Keys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="sv-keys">
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`}>{key}</kbd>
      ))}
    </span>
  );
}
