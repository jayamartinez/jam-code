import { useState } from 'react';
import type { ProviderDescriptor } from '@jam/protocol';
import { ProviderIcon } from './icons';
import { agentStep, isAgentReady } from './agent-setup-model';

/**
 * A new chat when no agent is ready (Paper, Core flows "19 · No agent
 * ready"): each agent says its one next step, with the official install
 * command for this platform or the command that signs in. JAM never installs
 * or signs in for anyone; it only shows what to run.
 */
export function AgentSetup({
  providers,
  platform,
  checking,
  onCheckAgain,
  onOpenTerminal,
  onSettings,
}: {
  providers: ProviderDescriptor[];
  platform: 'macos' | 'windows' | 'web';
  checking: boolean;
  onCheckAgain(): void;
  /** Opens a JAM terminal in the project, to run a command there. */
  onOpenTerminal?(): void;
  onSettings(): void;
}) {
  const agents = providers.filter((provider) => provider.id !== 'mock');
  return (
    <section className="agent-setup" aria-labelledby="agent-setup-title">
      <h2 id="agent-setup-title">Set up an agent to start chatting</h2>
      <p>
        JAM Code runs Claude Code or Codex from this computer, signed in with their own accounts.
      </p>
      <div className="agent-setup-cards">
        {agents.map((provider) => (
          <AgentCard
            key={provider.id}
            provider={provider}
            platform={platform}
            {...(onOpenTerminal ? { onOpenTerminal } : {})}
            onSettings={onSettings}
          />
        ))}
      </div>
      <div className="agent-setup-actions">
        <button type="button" className="button primary" disabled={checking} onClick={onCheckAgain}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        <button type="button" className="button quiet" onClick={onSettings}>
          Agent settings
        </button>
      </div>
    </section>
  );
}

function AgentCard({
  provider,
  platform,
  onOpenTerminal,
  onSettings,
}: {
  provider: ProviderDescriptor;
  platform: 'macos' | 'windows' | 'web';
  onOpenTerminal?(): void;
  onSettings(): void;
}) {
  const step = agentStep(provider, platform);
  const [copied, setCopied] = useState(false);
  const ready = isAgentReady(provider);
  return (
    <div className="agent-setup-card">
      <div className="agent-setup-card-head">
        <ProviderIcon
          presentation={provider.id === 'codex' ? 'codex' : 'claude'}
          providerId={provider.id}
        />
        <strong>{provider.name}</strong>
        <span className={`agent-setup-state ${ready ? 'ready' : ''}`}>{step.state}</span>
      </div>
      {step.command && (
        <div className="agent-setup-command">
          <code>{step.command}</code>
          <button
            type="button"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(step.command!)
                .then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {})
            }
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          {step.kind === 'sign-in' && onOpenTerminal && (
            <button type="button" onClick={onOpenTerminal}>
              Open terminal
            </button>
          )}
        </div>
      )}
      {step.kind === 'off' ? (
        <p>
          Turned off in JAM.{' '}
          <button type="button" className="agent-setup-link" onClick={onSettings}>
            Turn it on in Settings ›
          </button>
        </p>
      ) : (
        step.note && <p>{step.note}</p>
      )}
    </div>
  );
}
