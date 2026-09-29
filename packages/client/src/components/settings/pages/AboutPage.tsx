import { Copy } from 'lucide-react';
import { PROTOCOL_VERSION } from '@jam/protocol';
import { useEffect, useState } from 'react';
import { Card, Chip, Planned, Row, Section } from '../controls';
import { buildFacts, webViewName } from '../system-info';
import type { SettingsPageProps } from '../types';

/** Only facts a real source reports; a build that does not embed its version omits it. */
export default function AboutPage({ platform }: SettingsPageProps) {
  const facts = buildFacts();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const builtWith: [string, string][] = [
    ['Desktop host', platform === 'web' ? 'Browser preview' : 'Tauri 2'],
    ['Storage', platform === 'web' ? 'In memory, for this tab' : 'SQLite with FTS5'],
    ['WebView', webViewName(platform)],
    ['Protocol', `v${PROTOCOL_VERSION}`],
  ];

  return (
    <div className="sv-page">
      <header className="sv-about-hero">
        <div className="sv-about-title">
          <h2>jam</h2>
          {facts.version && <span className="sv-mono">{facts.version}</span>}
          {facts.version?.includes('-') && <Chip>{prerelease(facts.version)}</Chip>}
          {facts.development && <Chip>Development build</Chip>}
          {platform === 'web' && <Chip>Browser preview</Chip>}
        </div>
        <p>JAM Code · a local-first workspace for coding agents.</p>
      </header>

      <Section label="Version">
        <Card>
          <Row title="Version">
            {facts.version ? (
              <>
                <span className="sv-mono sv-value">{facts.version}</span>
                <button
                  type="button"
                  className="sv-button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(facts.version ?? '')
                      .then(() => setCopied(true))
                      .catch(() => {});
                  }}
                >
                  <Copy size={12} aria-hidden="true" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </>
            ) : (
              <span className="sv-mono sv-value">Not reported by this build</span>
            )}
          </Row>
          <Row
            title={
              <>
                Updates
                <Planned />
              </>
            }
            sub="JAM doesn’t check for updates yet."
            disabled
          >
            <button type="button" className="sv-button" disabled>
              Check for updates
            </button>
          </Row>
        </Card>
      </Section>

      <Section label="Built with">
        <Card>
          {builtWith.map(([label, value]) => (
            <Row key={label} title={label}>
              <span className="sv-mono sv-value">{value}</span>
            </Row>
          ))}
        </Card>
      </Section>

      <p className="sv-about-legal">
        Free and open source under the MIT License. The license and third-party notices are
        installed with the app (LICENSE and THIRD_PARTY_NOTICES.md).
      </p>
    </div>
  );
}

/** "Alpha" for 0.1.0-alpha, "Beta 2" for 1.0.0-beta.2. */
function prerelease(version: string) {
  const tag = version.slice(version.indexOf('-') + 1).replace(/\./g, ' ');
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}
