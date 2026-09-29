import { describe, expect, it } from 'vitest';
import type { ProviderDescriptor } from '@jam/protocol';
import {
  composerChoices,
  contextShare,
  effortSummary,
  folderName,
  modelLabel,
  modelMenu,
  policyLabel,
  reportedModel,
  sendsMessage,
  toggledFavorite,
  withoutStaleChoices,
} from './composer-model';
import { draftProvider, unavailableReason } from '../state/chat-draft';

const descriptor = (overrides: Partial<ProviderDescriptor> = {}): ProviderDescriptor => ({
  id: 'codex',
  name: 'Codex',
  installation: 'installed',
  authentication: 'authenticated',
  enabled: true,
  isDefault: false,
  running: false,
  capabilities: {} as ProviderDescriptor['capabilities'],
  models: [
    { id: 'a', label: 'Model A', isDefault: true, efforts: ['low', 'high'] },
    { id: 'b', label: 'Model B', efforts: [] },
  ],
  options: [
    {
      id: 'sandbox',
      label: 'Sandbox',
      default: 'workspace-write',
      values: [
        { value: 'read-only', label: 'Read only' },
        { value: 'workspace-write', label: 'Workspace write' },
      ],
    },
  ],
  ...overrides,
});

describe('composer choices', () => {
  it('come only from what the provider reported', () => {
    const choices = composerChoices(descriptor(), {});
    // Unchosen means the provider's own default, not the one it lists.
    expect(choices.model).toBe('');
    expect(choices.models.map((m) => m.value)).toEqual(['', 'a', 'b']);
    expect(composerChoices(descriptor(), {}, 'gpt-x').models[0]?.label).toBe('Default (GPT-X)');
    expect(choices.efforts.map((e) => e.value)).toEqual(['', 'low', 'high']);
    expect(choices.options[0]?.value).toBe('workspace-write');
    expect(policyLabel(choices)).toBe('Workspace write');
  });

  it('name models as people say them, never by ID', () => {
    const claude = descriptor({
      id: 'claude',
      models: [
        { id: 'default', label: 'Default (recommended)', isDefault: true, efforts: [] },
        { id: 'opus', label: 'Opus 5.5', efforts: [] },
      ],
    });
    expect(modelLabel('opus', claude)).toBe('Opus 5.5');
    // Claude Code reports full IDs for the aliases it lists.
    expect(modelLabel('claude-opus-5-5', claude)).toBe('Opus 5.5');
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5');
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5');
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5');
    expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5 (1M context)');
    expect(modelLabel('gpt-5.5')).toBe('GPT-5.5');
    expect(modelLabel('gpt-6-astra')).toBe('GPT-6-Astra');
    expect(modelLabel('o3')).toBe('o3');
    expect(composerChoices(claude, {}, 'claude-opus-5-5').models[0]?.label).toBe(
      'Default (Opus 5.5)',
    );
  });

  it('offer speed only where the chosen model has a faster one, and drop a stale one', () => {
    const fast = descriptor({
      models: [
        {
          id: 'a',
          label: 'Model A',
          isDefault: true,
          efforts: ['high'],
          speeds: [{ value: 'priority', label: 'Fast', description: '2x speed, increased usage' }],
        },
        { id: 'b', label: 'Model B', efforts: [] },
      ],
    });
    const choices = composerChoices(fast, { speed: 'priority', effort: 'high' });
    expect(choices.speeds.map((s) => s.value)).toEqual(['', 'priority']);
    expect(effortSummary(choices)).toBe('High · Fast');
    expect(effortSummary(composerChoices(fast, { effort: 'high' }))).toBe('High effort');
    expect(effortSummary(composerChoices(fast, { speed: 'priority' }))).toBe('Default · Fast');
    // Model B offers neither, so both choices are dropped rather than sent.
    expect(withoutStaleChoices(fast, { model: 'b', speed: 'priority', effort: 'high' })).toEqual({
      model: 'b',
    });
    expect(composerChoices(fast, { model: 'b' }).speeds).toEqual([]);
  });

  it('name what a default resolves to', () => {
    const named = descriptor({
      models: [
        {
          id: 'a',
          label: 'Model A',
          isDefault: true,
          efforts: ['low', 'high'],
          defaultEffort: 'low',
        },
      ],
    });
    const choices = composerChoices(named, {});
    // Before any reply, the listed default names the default model.
    expect(choices.models[0]?.label).toBe('Default (Model A)');
    expect(choices.efforts[0]?.label).toBe('Default (Low)');
    expect(effortSummary(choices)).toBe('Default (Low)');
    expect(effortSummary(composerChoices(named, { speed: 'x' }))).toBe('Default (Low)');
  });

  it('build the model menu from favorites, hidden and legacy models, and search', () => {
    const many = descriptor({
      favoriteModels: ['old', 'gone'],
      hiddenModels: ['hidden', 'chosen'],
      models: [
        { id: 'new', label: 'Opus 5.5', isDefault: true, speeds: [{ value: 'f', label: 'Fast' }] },
        { id: 'mid', label: 'Sonnet 5.5', description: 'Everyday coding' },
        { id: 'hidden', label: 'Haiku 4.5' },
        { id: 'chosen', label: 'Opus 4.6', legacy: true },
        { id: 'old', label: 'Opus 5', legacy: true },
        { id: 'older', label: 'Opus 4.8', legacy: true },
      ],
    });
    const menu = modelMenu(many, composerChoices(many, { model: 'chosen' }));
    expect(menu.default?.label).toBe('Default (Opus 5.5)');
    // A starred legacy model is a favorite; a starred model no longer listed is skipped.
    expect(menu.favorites.map((m) => m.value)).toEqual(['old']);
    expect(menu.models.map((m) => m.value)).toEqual(['new', 'mid']);
    expect(menu.models[0]?.fast).toBe(true);
    // Every legacy model is listed; a hidden one only because the chat chose it.
    expect(menu.legacy.map((m) => m.value)).toEqual(['chosen', 'older']);
    expect(menu.shortcuts).toEqual(['old', 'new', 'mid']);
    const searched = modelMenu(many, composerChoices(many, {}), 'EVERYDAY');
    expect(searched.default).toBeUndefined();
    expect(searched.models.map((m) => m.value)).toEqual(['mid']);
    expect(modelMenu(many, composerChoices(many, {}), 'opus 4').legacy.map((m) => m.value)).toEqual(
      ['older'],
    );
  });

  it('star and unstar a model, and drop a model the provider stopped listing', () => {
    expect(toggledFavorite(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggledFavorite(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggledFavorite(undefined, 'a')).toEqual(['a']);
    expect(withoutStaleChoices(descriptor(), { model: 'default', access: 'full' })).toEqual({
      access: 'full',
    });
  });

  it('name a folder by its last part on any platform', () => {
    expect(folderName('C:\\Users\\jay\\café repo')).toBe('café repo');
    expect(folderName('/home/jay/forge-cli/')).toBe('forge-cli');
    expect(folderName(undefined)).toBe('');
  });

  it('ignore placeholder models a session reported', () => {
    expect(reportedModel('claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(reportedModel('<synthetic>')).toBeUndefined();
    expect(reportedModel('Default model')).toBeUndefined();
    expect(reportedModel('')).toBeUndefined();
  });

  it('offer no effort for a model that reports none, and drop a stale effort', () => {
    const choices = composerChoices(descriptor(), { model: 'b', effort: 'high' });
    expect(choices.efforts).toEqual([]);
    expect(choices.effort).toBe('');
  });

  it('offer nothing when the provider listed nothing', () => {
    const choices = composerChoices(descriptor({ models: undefined, options: undefined }), {});
    expect(choices.models).toEqual([]);
    expect(choices.options).toEqual([]);
  });

  it('show context share only when both numbers are reported', () => {
    expect(contextShare({ contextTokens: 50_000, contextWindow: 200_000 })?.label).toBe(
      '25% context',
    );
    expect(contextShare({ contextTokens: 50_000 })).toBeNull();
  });
});

describe('new chat provider', () => {
  const claude = descriptor({ id: 'claude', name: 'Claude Code', isDefault: true });
  const codex = descriptor();

  it('starts with the requested enabled provider, else the default', () => {
    expect(draftProvider([claude, codex], 'codex')).toBe('codex');
    expect(draftProvider([claude, { ...codex, enabled: false }], 'codex')).toBe('claude');
    expect(draftProvider([claude, codex])).toBe('claude');
  });

  it('explains why a provider cannot start a chat', () => {
    expect(unavailableReason(codex)).toBeNull();
    expect(unavailableReason({ ...codex, installation: 'missing' })).toMatch(/not installed/);
    expect(unavailableReason({ ...codex, authentication: 'unauthenticated' })).toMatch(
      /signed out/,
    );
    expect(unavailableReason({ ...codex, enabled: false })).toMatch(/turned off/);
  });
});

describe('composer keys', () => {
  const key = (overrides: Partial<Parameters<typeof sendsMessage>[0]> = {}) => ({
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  });

  it('sends on Enter and leaves Shift+Enter to add a line', () => {
    expect(sendsMessage(key())).toBe(true);
    expect(sendsMessage(key({ shiftKey: true }))).toBe(false);
    expect(sendsMessage(key({ key: 'a', keyCode: 65 }))).toBe(false);
  });

  it('never sends while an input method is composing', () => {
    expect(sendsMessage(key({ isComposing: true }))).toBe(false);
    expect(sendsMessage(key({ keyCode: 229 }))).toBe(false);
  });
});
