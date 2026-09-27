import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

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
  values: { value: string; label: string; description?: string }[];
  onChange(value: string): void;
  disabled?: boolean;
  /** The quieter form in a new chat's footer. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Fixed to the pill, so a toolbar that clips its overflow cannot hide it.
  const [place, setPlace] = useState<React.CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
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
  const current = values.find((item) => item.value === value) ?? values[0];
  if (!current) return null;
  return (
    <div className={`access ${compact ? 'compact' : ''}`} ref={root}>
      <button
        type="button"
        className={`access-pill access-${current.value}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Access: ${current.label}`}
        title={current.description}
        disabled={disabled}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setPlace(
            compact
              ? { left: box.left, top: box.bottom + 6 }
              : { left: box.left, bottom: window.innerHeight - box.top + 8 },
          );
          setOpen((shown) => !shown);
        }}
      >
        <AccessIcon level={current.value} />
        <span>{current.label}</span>
        <ChevronDown size={10} className="composer-chevron" />
      </button>
      {open && (
        <div className="access-menu" role="menu" aria-label="Access" style={place}>
          {values.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              aria-checked={item.value === current.value}
              className={`access-option ${item.value === current.value ? 'selected' : ''}`}
              onClick={() => {
                setOpen(false);
                if (item.value !== current.value) onChange(item.value);
              }}
            >
              <span className={`access-option-icon access-${item.value}`}>
                <AccessIcon level={item.value} size={14} />
              </span>
              <span className="access-option-copy">
                <strong>{item.label}</strong>
                {item.description && <small>{item.description}</small>}
              </span>
              <span className="access-option-check">
                {item.value === current.value && <Check size={12} strokeWidth={2} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
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
