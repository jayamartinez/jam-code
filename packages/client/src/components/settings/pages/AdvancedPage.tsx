import { Copy } from 'lucide-react';
import { PROTOCOL_VERSION } from '@jam/protocol';
import { useEffect, useState } from 'react';
import { Card, Chip, PageHeader, Planned, Row, Section, Segmented, Toggle } from '../controls';
import { buildFacts, diagnosticsText, runtimeDescription } from '../system-info';
import type { SettingsPageProps } from '../types';

const EXPERIMENTS = [
  {
    id: 'detached',
    title: 'Detached runtime process',
    sub: 'Keeps sessions alive after the window closes.',
  },
  {
    id: 'virtualization',
    title: 'Transcript virtualization',
    sub: 'Renders only visible messages, so very long chats stay fast.',
  },
  {
    id: 'gpu-terminal',
    title: 'GPU-accelerated terminal',
    sub: 'Draws terminals with WebGL.',
  },
];

export default function AdvancedPage({ platform }: SettingsPageProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyDiagnostics = () => {
    void navigator.clipboard
      ?.writeText(diagnosticsText(platform, buildFacts()))
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="sv-page">
      <PageHeader
        title="Advanced"
        description="For troubleshooting and trying unfinished features."
      />

      <Section label="Runtime">
        <Card>
          <Row
            title={
              <>
                Status
                <span className="sv-runtime-status">
                  <span className="sv-status-dot" />
                  {runtimeDescription(platform)} · protocol v{PROTOCOL_VERSION}
                </span>
              </>
            }
            sub="Restarting would interrupt running sessions and mark them as interrupted."
          >
            <button type="button" className="sv-button" disabled>
              Restart runtime…
            </button>
            <Planned />
          </Row>
          <Row
            title={
              <>
                Health
                <Planned />
              </>
            }
            sub="Event queue, subscriptions and running sessions."
            disabled
          />
        </Card>
      </Section>

      <Section label="Diagnostics">
        <Card>
          <Row
            title={
              <>
                Log level
                <Planned />
              </>
            }
            disabled
          >
            <Segmented
              label="Log level"
              value="info"
              options={[
                { value: 'error', label: 'Error' },
                { value: 'info', label: 'Info' },
                { value: 'debug', label: 'Debug' },
              ]}
              disabled
            />
          </Row>
          <Row
            title={
              <>
                Logs
                <Planned />
              </>
            }
            disabled
          >
            <button type="button" className="sv-button" disabled>
              Open folder
            </button>
          </Row>
          <Row
            title="Copy diagnostics"
            sub="Versions and platform only: no paths, tokens or message content."
          >
            <button type="button" className="sv-button" onClick={copyDiagnostics}>
              <Copy size={12} aria-hidden="true" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </Row>
        </Card>
      </Section>

      <Section label="Experimental" hint={<Planned />}>
        <Card>
          {EXPERIMENTS.map((experiment) => (
            <Row
              key={experiment.id}
              title={
                <>
                  {experiment.title}
                  <Chip tone="warning">Experimental</Chip>
                </>
              }
              sub={experiment.sub}
              disabled
            >
              <Toggle label={experiment.title} on={false} disabled />
            </Row>
          ))}
        </Card>
      </Section>

      <Section label="Developer" hint={<Planned />}>
        <Card>
          <Row
            title="Event inspector"
            sub="A pane that lists runtime events as they arrive."
            disabled
          >
            <Toggle label="Event inspector" on={false} disabled />
          </Row>
          <Row
            title="Show IDs in tooltips"
            sub="Resource, view and session IDs, for bug reports."
            disabled
          >
            <Toggle label="Show IDs in tooltips" on={false} disabled />
          </Row>
        </Card>
      </Section>
    </div>
  );
}
