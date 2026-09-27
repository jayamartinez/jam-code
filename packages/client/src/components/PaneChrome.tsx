import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useOccludesNativeViews } from '../state/native-occlusion';

/**
 * Shared pane frame: header, control cluster and body.
 *
 * Every resource surface uses this, so the split/focus/close language is
 * identical whether the pane holds a conversation, a terminal, a file, a file
 * browser or a review. The chrome takes callbacks and never learns the kind.
 */

const CONTROL = { width: 13, height: 13, viewBox: '0 0 16 16', focusable: 'false' } as const;

const SplitRightGlyph = () => (
  <svg {...CONTROL}>
    <rect
      x="2"
      y="2.5"
      width="12"
      height="11"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path d="M8 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const SplitDownGlyph = () => (
  <svg {...CONTROL}>
    <rect
      x="2"
      y="2.5"
      width="12"
      height="11"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path d="M2 8h12" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const ExpandGlyph = () => (
  <svg {...CONTROL}>
    <path
      d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const MoreGlyph = () => (
  <svg {...CONTROL}>
    <circle cx="3.5" cy="8" r="1.1" fill="currentColor" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    <circle cx="12.5" cy="8" r="1.1" fill="currentColor" />
  </svg>
);

export interface PaneMenuItem {
  label: string;
  onSelect?(): void;
  /** Why the command is unavailable here. Present means disabled. */
  unavailable?: string;
  danger?: boolean;
}

export interface PaneChromeProps {
  heading: ReactNode;
  /** Right-aligned status, such as a provider pill. */
  status?: ReactNode;
  focused?: boolean;
  compact?: boolean;
  className?: string;
  /** Accessible name for the pane region. */
  label: string;
  onSplitRight?(): void;
  onSplitDown?(): void;
  onExpand?(): void;
  expandLabel?: string;
  menu?: PaneMenuItem[];
  children: ReactNode;
}

export function PaneChrome({
  heading,
  status,
  focused,
  compact,
  className = '',
  label,
  onSplitRight,
  onSplitDown,
  onExpand,
  expandLabel = 'Focus this pane',
  menu,
  children,
}: PaneChromeProps) {
  return (
    <section
      className={`pane ${focused ? 'focused' : ''} ${className}`}
      aria-label={label}
      tabIndex={-1}
    >
      <header className={`pane-header ${compact ? 'compact' : ''}`}>
        <div className="pane-heading">{heading}</div>
        <div className="pane-actions">
          {status}
          {onSplitRight && (
            <PaneButton label="Split right" onClick={onSplitRight}>
              <SplitRightGlyph />
            </PaneButton>
          )}
          {onSplitDown && (
            <PaneButton label="Split down" onClick={onSplitDown}>
              <SplitDownGlyph />
            </PaneButton>
          )}
          {onExpand && (
            <PaneButton label={expandLabel} onClick={onExpand}>
              <ExpandGlyph />
            </PaneButton>
          )}
          {menu?.length ? <PaneMenu items={menu} /> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function PaneButton({
  label,
  onClick,
  children,
  ...rest
}: {
  label: string;
  onClick(): void;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className="pane-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      {...rest}
    >
      {children}
    </button>
  );
}

function PaneMenu({ items }: { items: PaneMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();
  useOccludesNativeViews(open);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('contextmenu', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', close);
    };
  }, [open]);

  return (
    <div className="pane-menu-wrapper" ref={wrapper}>
      <PaneButton
        label="Pane options"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
      >
        <MoreGlyph />
      </PaneButton>
      {open && (
        <div
          className="pane-menu"
          id={id}
          role="menu"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              disabled={!item.onSelect}
              title={item.unavailable}
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
