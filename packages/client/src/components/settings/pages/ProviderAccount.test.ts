import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import { ProviderAccount } from './ProviderAccount';

const provider = (overrides: Partial<ProviderDescriptor>): ProviderDescriptor => ({
  id: 'codex',
  name: 'Codex',
  installation: 'installed',
  authentication: 'authenticated',
  enabled: true,
  isDefault: false,
  running: false,
  capabilities: {} as ProviderDescriptor['capabilities'],
  ...overrides,
});

const html = (descriptor: ProviderDescriptor) =>
  renderToStaticMarkup(createElement(ProviderAccount, { provider: descriptor }));

describe('provider account', () => {
  it('starts with the identity hidden', () => {
    const out = html(
      provider({ account: { plan: 'ChatGPT Pro 5x', identity: 'reader@example.com' } }),
    );
    expect(out).toContain('Signed in as');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('aria-label="Account hidden. Click to show."');
    // Hidden means scrambled, not just blurred: the email is not in the page.
    expect(out).not.toContain('reader');
    expect(out).not.toContain('example.com');
    expect(out).toMatch(/<span aria-hidden="true">[a-z0-9]{18}<\/span>/);
    expect(out).not.toContain('sv-account-identity revealed');
    expect(out).toContain('ChatGPT Pro 5x');
  });

  it('says what was not reported instead of guessing', () => {
    const out = html(provider({ account: { method: 'API key' } }));
    expect(out).toContain('Not reported');
    expect(out).toContain('Plan not reported');
    expect(out).not.toContain('sv-account-identity');
  });

  it('shows nothing for a provider that is not signed in', () => {
    expect(html(provider({ authentication: 'unauthenticated' }))).toBe('');
    expect(html(provider({ authentication: 'not-required' }))).toBe('');
    expect(html(provider({ authentication: 'unknown' }))).toBe('');
  });
});
