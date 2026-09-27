import type { CSSProperties } from 'react';
import type { AppearanceSettings, ThemeRef } from '@jam/protocol';
import type { LibraryFamily, LibraryVariant } from '../../appearance/library';
import type { ThemeDefinition } from '../../appearance/themes';

/**
 * A miniature JAM window drawn only from semantic tokens: sidebar, a chat
 * turn, a code block, terminal output and the composer. On the page it shows
 * the live appearance; inside the theme editor it is wrapped in a draft
 * theme's tokens, so the same markup previews either.
 */
export function MiniWindow({ style }: { style?: CSSProperties }) {
  return (
    <div className="ap-mini" style={style} aria-hidden="true">
      <div className="ap-mini-sidebar">
        <span className="ap-mini-brand">jam</span>
        <span className="ap-mini-project active">
          <i />
          jam-code
        </span>
        <span className="ap-mini-thread">Pane restore keeps PTY</span>
        <span className="ap-mini-thread">Browser annotation</span>
        <span className="ap-mini-project">
          <i />
          atlas-web
        </span>
      </div>
      <div className="ap-mini-pane">
        <span className="ap-mini-bubble">Release the PTY when the last view closes?</span>
        <p className="ap-mini-prose">
          No. Closing a pane only changes presentation; the session keeps its handle.
        </p>
        <pre className="ap-mini-code">
          <span className="syntax-keyword">export function</span>{' '}
          <span className="syntax-function">release</span>
          <span className="syntax-punctuation">(</span>
          <span className="syntax-variable">s</span>
          <span className="syntax-punctuation">: </span>
          <span className="syntax-type">Session</span>
          <span className="syntax-punctuation">) {'{'}</span>
          {'\n  '}
          <span className="syntax-variable">s</span>
          <span className="syntax-punctuation">.</span>
          <span className="syntax-property">refs</span> <span className="syntax-operator">-=</span>{' '}
          <span className="syntax-number">1</span>
          <span className="syntax-punctuation">;</span>{' '}
          <span className="syntax-comment">{'// keep the PTY'}</span>
          {'\n  '}
          <span className="syntax-keyword">return</span>{' '}
          <span className="syntax-string">&apos;detached&apos;</span>
          <span className="syntax-punctuation">;</span>
          {'\n'}
          <span className="syntax-punctuation">{'}'}</span>
        </pre>
        <pre className="ap-mini-terminal">
          <span className="ansi-cyan">~/jam-code</span> pnpm test{'\n'}
          <span className="ansi-green">✓</span> 8 passed{' '}
          <span className="ansi-bright-black">41ms</span>
        </pre>
        <span className="ap-mini-composer">
          <span>Ask anything</span>
          <i />
        </span>
      </div>
    </div>
  );
}

/**
 * The top of the page: the live window over the current background, with the
 * brightness switch (to the family's other variant) and a stepper through the
 * library, one theme at a time.
 */
export function Stage({
  appearance,
  theme,
  family,
  order,
  onTheme,
}: {
  appearance: AppearanceSettings;
  theme: ThemeDefinition;
  family: LibraryFamily | undefined;
  order: LibraryVariant[];
  onTheme(ref: ThemeRef): void;
}) {
  const index = order.findIndex((variant) => variant.ref === appearance.theme);
  const step = (delta: number) => {
    const next = order[(index + delta + order.length) % order.length];
    if (next) onTheme(next.ref);
  };
  return (
    <section className="ap-stage" aria-label="Preview">
      <div className="ap-stage-bar">
        <div className="sv-segmented" role="radiogroup" aria-label="Brightness">
          {(['light', 'dark'] as const).map((scheme) => {
            const variant = family?.variants.find((item) => item.theme.scheme === scheme);
            return (
              <button
                key={scheme}
                type="button"
                role="radio"
                aria-checked={theme.scheme === scheme}
                className={theme.scheme === scheme ? 'active' : ''}
                disabled={!variant}
                title={variant ? variant.theme.name : `${theme.family} has no ${scheme} version`}
                onClick={() => variant && onTheme(variant.ref)}
              >
                {scheme === 'light' ? 'Light' : 'Dark'}
              </button>
            );
          })}
        </div>
        <div className="ap-stepper">
          <button type="button" aria-label="Previous theme" onClick={() => step(-1)}>
            ‹
          </button>
          <span>
            <strong>{theme.name}</strong>
            <small>{theme.scheme}</small>
          </span>
          <button type="button" aria-label="Next theme" onClick={() => step(1)}>
            ›
          </button>
        </div>
      </div>
      <MiniWindow />
    </section>
  );
}
