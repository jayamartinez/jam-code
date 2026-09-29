import { useEffect, useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { ProviderDescriptor } from '@jam/protocol';
import { BrandMark } from './BrandMark';
import { ProviderIcon } from './icons';
import { authenticationCell, installationCell } from './settings/providers-model';

/**
 * What a new install shows before it has a project: one action, Open folder,
 * and the agents JAM found. JAM works in folders on this computer with the
 * coding agents already installed there; it has no account and runs nothing
 * until a chat is sent.
 */
export function FirstRun({
  providers,
  canAddProject,
  onAddProject,
  onCheckProviders,
  onProviderSettings,
}: {
  providers: ProviderDescriptor[];
  /** False where the host has no folder picker, such as the browser preview. */
  canAddProject: boolean;
  onAddProject(): Promise<unknown>;
  onCheckProviders(): void;
  onProviderSettings(): void;
}) {
  const [adding, setAdding] = useState(false);
  const agents = providers.filter((provider) => provider.id !== 'mock');
  // Detection is the question this screen answers, so it runs once here.
  useEffect(onCheckProviders, [onCheckProviders]);
  const ready = agents.some(
    (provider) =>
      provider.enabled &&
      provider.installation === 'installed' &&
      provider.authentication !== 'unauthenticated',
  );
  const checked = agents.some((provider) => provider.checkedAt);

  return (
    <section className="pane empty-surface first-run" aria-labelledby="first-run-title">
      <BrandMark size={36} />
      <h2 id="first-run-title">Open a project to start</h2>
      <p>
        JAM Code works in a folder on this computer, with the coding agents you already have
        installed. Your chats stay on this computer; only what you send goes to your agent.
      </p>
      <button
        type="button"
        className="button primary"
        disabled={!canAddProject || adding}
        onClick={() => {
          setAdding(true);
          void onAddProject().finally(() => setAdding(false));
        }}
      >
        <FolderOpen size={14} />
        {adding ? 'Adding…' : 'New project…'}
      </button>
      {!canAddProject && <p className="subtle">Adding a folder needs the desktop app.</p>}
      <ul className="first-run-agents" aria-label="Agents">
        {agents.map((provider) => {
          const installed = installationCell(provider);
          const signedIn = authenticationCell(provider);
          const detail =
            provider.installation === 'installed'
              ? `${provider.version ? `${provider.version} · ` : ''}${signedIn.label}`
              : installed.label;
          const tone =
            provider.installation === 'installed' && provider.authentication !== 'unauthenticated'
              ? 'success'
              : provider.installation === 'unknown'
                ? 'muted'
                : 'warning';
          return (
            <li key={provider.id}>
              <ProviderIcon
                presentation={provider.id === 'codex' ? 'codex' : 'claude'}
                providerId={provider.id}
              />
              <span className="first-run-agent-name">{provider.name}</span>
              <span className={`first-run-agent-state tone-${tone}`}>
                {checked || provider.checkedAt ? detail : 'Checking…'}
              </span>
            </li>
          );
        })}
      </ul>
      {checked && !ready && (
        <p className="subtle first-run-hint">
          Install Claude Code or Codex and sign in with its own CLI, then check again. JAM Code
          never asks for your credentials.
        </p>
      )}
      <button type="button" className="button quiet" onClick={onProviderSettings}>
        Agent settings
      </button>
      <p className="first-run-alpha">Alpha · expect rough edges</p>
    </section>
  );
}
