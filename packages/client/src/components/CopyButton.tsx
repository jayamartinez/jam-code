import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** How long "Copied" stays before the button returns. */
const CONFIRM_MS = 1500;

/** A message's Copy button: an icon that confirms with a check and "Copied". */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`message-copy ${copied ? 'copied' : ''}`}
      aria-label={copied ? 'Copied' : label}
      title={copied ? undefined : label}
      disabled={!text}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
          })
          .catch(() => {});
      }}
    >
      {copied ? (
        <>
          <Check size={13} strokeWidth={2} className="message-copy-check" />
          <span aria-live="polite">Copied</span>
        </>
      ) : (
        <Copy size={13} strokeWidth={1.6} />
      )}
    </button>
  );
}
