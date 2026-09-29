import { useState, type MouseEvent } from 'react';
import type { ProviderDescriptor } from '@jam/protocol';
import { useScrambled } from '../scramble';

/**
 * The signed-in account and plan, as the provider's own CLI reported them
 * (Paper, "Settings v2 · Providers"). Anything not reported says so. The
 * identity is personal, so it is scrambled and blurred until the reader clicks
 * it; a second click hides it again, and it starts hidden every time the page
 * opens.
 */
export function ProviderAccount({ provider }: { provider: ProviderDescriptor }) {
  if (provider.authentication !== 'authenticated') return null;
  const { identity, plan } = provider.account ?? {};
  return (
    <div className="sv-detail-group">
      <h3>Account</h3>
      <div className="sv-detail-card">
        <div className="sv-account-row">
          <span className="sv-account-label">Signed in as</span>
          {identity ? (
            <AccountIdentity identity={identity} />
          ) : (
            <span className="sv-account-unknown">Not reported</span>
          )}
          {plan ? (
            <span className="sv-account-plan">{plan}</span>
          ) : (
            <span className="sv-account-unknown end">Plan not reported</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Scrambled and blurred until clicked; clicking again hides it. While hidden
 * the identity itself is never rendered. Never remembered as revealed.
 */
export function AccountIdentity({ identity }: { identity: string }) {
  const [revealed, setRevealed] = useState(false);
  const display = useScrambled(identity, revealed);
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    // A selection made while it was shown must not outlive hiding it.
    if (revealed) clearSelectionWithin(event.currentTarget);
    setRevealed(!revealed);
  };
  return (
    <button
      type="button"
      className={`sv-account-identity ${revealed ? 'revealed' : ''}`}
      aria-pressed={revealed}
      aria-label={revealed ? undefined : 'Account hidden. Click to show.'}
      title={revealed ? 'Click to hide' : 'Click to show'}
      // Repeated clicks toggle; they never select a word.
      onMouseDown={(event) => {
        if (event.detail > 1) event.preventDefault();
      }}
      onClick={toggle}
    >
      <span aria-hidden={!revealed}>{display}</span>
    </button>
  );
}

function clearSelectionWithin(element: Element) {
  const selection = window.getSelection();
  if (selection?.containsNode(element, true)) selection.removeAllRanges();
}
