import { useState } from 'react';
import { ArrowUpRight, HelpCircle } from 'lucide-react';
import { moveMenuFocus, useAnchoredMenu } from './anchored-menu';

export type FeedbackKind = 'bug' | 'feature' | 'docs';

/**
 * Help beside Settings (Paper, Core flows "20 · Feedback"): JAM Code's GitHub
 * pages for a bug report, an idea or the documentation, and the diagnostics
 * a report needs. Only the desktop host can open them.
 */
export function HelpMenu({
  onFeedback,
  onCopyDiagnostics,
}: {
  onFeedback(kind: FeedbackKind): void;
  onCopyDiagnostics(): Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const { open, place, root, trigger, menu, layer, toggle, close, tabOut } = useAnchoredMenu({
    onOpened: (element) => element.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
  });
  const pages: { kind: FeedbackKind; label: string }[] = [
    { kind: 'bug', label: 'Report a bug' },
    { kind: 'feature', label: 'Suggest a feature' },
    { kind: 'docs', label: 'Documentation' },
  ];
  return (
    <div className="help-menu-root" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="help-button"
        aria-label="Help and feedback"
        title="Help and feedback"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <HelpCircle size={14} />
      </button>
      {open &&
        layer(
          <div
            ref={menu}
            className="help-menu"
            role="menu"
            aria-label="Help and feedback"
            style={place}
            onKeyDown={(event) => {
              const items = [
                ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
              ];
              if (moveMenuFocus(event, items)) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
              } else if (event.key === 'Tab') tabOut();
            }}
          >
            {pages.map((page) => (
              <button
                key={page.kind}
                type="button"
                role="menuitem"
                onClick={() => {
                  close(false);
                  onFeedback(page.kind);
                }}
              >
                <span>{page.label}</span>
                <ArrowUpRight size={12} aria-hidden="true" />
              </button>
            ))}
            <div className="help-menu-divider" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                void onCopyDiagnostics().then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                })
              }
            >
              <span>{copied ? 'Copied' : 'Copy diagnostics'}</span>
            </button>
          </div>,
        )}
    </div>
  );
}
