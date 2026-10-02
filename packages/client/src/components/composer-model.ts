import type { ProviderDescriptor, SessionUsage } from '@jam/protocol';

export interface Choice {
  value: string;
  label: string;
  description?: string;
}

export interface ComposerChoices {
  models: Choice[];
  model: string;
  /** Empty when the chosen model reports no effort levels. */
  efforts: Choice[];
  /** `''` means the provider's default. */
  effort: string;
  /** Standard first, then faster speeds; empty when the model offers none. */
  speeds: Choice[];
  /** `''` means standard. */
  speed: string;
  /** Provider-specific settings, such as a permission mode or sandbox. */
  options: { id: string; label: string; value: string; values: Choice[] }[];
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

/**
 * The model a session last reported, if it named a real one: not the
 * "Default model" placeholder, and not a provider placeholder such as
 * Claude Code's `<synthetic>`, which older sessions may have saved.
 */
export function reportedModel(model?: string): string | undefined {
  return model && model !== 'Default model' && !model.startsWith('<') ? model : undefined;
}

/**
 * A model's name as people say it ("Opus 5.5", "GPT-5.5"), never its ID.
 * The provider's own label wins; a reported ID it does not list (Claude Code
 * lists aliases such as `opus` but reports `claude-opus-5-5`) is formatted
 * from the ID's shape, and anything unrecognized is shown as given.
 */
export function modelLabel(id: string, descriptor?: ProviderDescriptor): string {
  const listed = descriptor?.models?.find((model) => model.id === id && !model.isDefault);
  if (listed) return listed.label;
  const window = /\[1m\]$/i.test(id) ? ' (1M context)' : '';
  const bare = id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  const claude =
    /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i.exec(bare) ??
    // Older IDs put the version first: claude-3-5-sonnet.
    /^claude-(\d+)(?:-(\d+))?-([a-z]+)$/i.exec(bare);
  if (claude) {
    const [family, major, minor] = /^\d/.test(claude[1]!)
      ? [claude[3]!, claude[1]!, claude[2]]
      : [claude[1]!, claude[2]!, claude[3]];
    return `${capitalize(family)} ${major}${minor ? `.${minor}` : ''}${window}`;
  }
  if (/^gpt-/i.test(bare))
    return `GPT-${bare.slice(4).split('-').map(capitalize).join('-')}${window}`;
  return id;
}
/** Readable names for effort values providers report; others are shown as given. */
const EFFORT_NAMES: Record<string, string> = { xhigh: 'Extra high' };
export const effortLabel = (value: string) => EFFORT_NAMES[value] ?? capitalize(value);

/**
 * What the composer offers, derived only from what the provider reported.
 * Nothing here knows which provider it is: a provider with no model list
 * offers no model choice, and effort levels are the chosen model's own.
 */
export function composerChoices(
  descriptor: ProviderDescriptor | undefined,
  options: Record<string, string>,
  /** The model the provider last reported using, for the "default" choice. */
  current?: string,
): ComposerChoices {
  const models = descriptor?.models ?? [];
  // With no model chosen the provider decides, and its own configuration can
  // differ from the model it lists as default, so "default" is its own choice.
  const chosen = models.find((model) => model.id === options.model);
  const listedDefault = models.find((model) => model.isDefault);
  const effective = chosen ?? listedDefault ?? models[0];
  const efforts = effective?.efforts ?? [];
  const speeds = effective?.speeds ?? [];
  // Defaults name what they resolve to: the model the provider last reported,
  // else the one it lists as default; the effort the chosen model defaults to.
  const defaultModel = current ? modelLabel(current, descriptor) : listedDefault?.label;
  const defaultEffort =
    effective?.defaultEffort && efforts.includes(effective.defaultEffort)
      ? effortLabel(effective.defaultEffort)
      : undefined;
  return {
    models: models.length
      ? [
          {
            value: '',
            label: defaultModel ? `Default (${defaultModel})` : 'Default model',
            description: `Whatever ${descriptor?.name ?? 'the provider'}’s own settings select`,
          },
          ...models.map((model) => ({
            value: model.id,
            label: model.label,
            ...(model.description ? { description: model.description } : {}),
          })),
        ]
      : [],
    model: chosen?.id ?? '',
    efforts: efforts.length
      ? [
          { value: '', label: defaultEffort ? `Default (${defaultEffort})` : 'Default effort' },
          ...efforts.map((effort) => ({ value: effort, label: `${effortLabel(effort)} effort` })),
        ]
      : [],
    effort: options.effort && efforts.includes(options.effort) ? options.effort : '',
    speeds: speeds.length ? [{ value: '', label: 'Standard' }, ...speeds] : [],
    speed: speeds.some((speed) => speed.value === options.speed) ? (options.speed ?? '') : '',
    options: (descriptor?.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      value: options[option.id] ?? option.default,
      values: option.values,
    })),
  };
}

/**
 * Options that no longer apply: a model the provider stopped listing, or an
 * effort level or speed the chosen model does not offer, is dropped rather
 * than sent.
 */
export function withoutStaleChoices(
  descriptor: ProviderDescriptor | undefined,
  options: Record<string, string>,
): Record<string, string> {
  const next = { ...options };
  // A model the provider no longer lists falls back to its default.
  if (next.model && descriptor?.models && !descriptor.models.some((m) => m.id === next.model))
    delete next.model;
  const choices = composerChoices(descriptor, next);
  if (next.effort && !choices.efforts.some((effort) => effort.value === next.effort))
    delete next.effort;
  if (next.speed && !choices.speeds.some((speed) => speed.value === next.speed)) delete next.speed;
  return next;
}

/**
 * The effort pill's summary: "High effort", "Default (Medium)", or
 * "Medium · Fast" at a faster speed.
 */
export function effortSummary(choices: ComposerChoices): string {
  const effort = choices.efforts.find((item) => item.value === choices.effort)?.label;
  const speed = choices.speed && choices.speeds.find((item) => item.value === choices.speed)?.label;
  if (!choices.efforts.length) return speed || 'Standard';
  if (!speed) return effort ?? 'Standard';
  // "Default (Medium)" becomes "Medium" beside a speed; a bare default stays "Default".
  const level = effort?.replace(/ effort$/, '').replace(/^Default \((.+)\)$/, '$1');
  return `${level ?? 'Default'} · ${speed}`;
}

export interface ModelChoice extends Choice {
  favorite: boolean;
  /** The model offers a faster speed. */
  fast: boolean;
}

/** The model picker's groups, in the order they are shown. */
export interface ModelMenu {
  /** The provider's own choice, named for what it resolves to. */
  default?: Choice;
  favorites: ModelChoice[];
  models: ModelChoice[];
  /** Older versions, folded until opened or searched. */
  legacy: ModelChoice[];
  /** Alt+1–9, in order: favorites, then current models. */
  shortcuts: string[];
}

/**
 * The model picker's contents. Models the reader hid are left out unless the
 * chat already chose one; starred models come first in the order they were
 * starred. A query matches a model's name, ID or description, and the
 * provider's default is shown only when nothing is being searched.
 */
export function modelMenu(
  descriptor: ProviderDescriptor | undefined,
  choices: ComposerChoices,
  query = '',
): ModelMenu {
  const favorites = descriptor?.favoriteModels ?? [];
  const hidden = new Set(descriptor?.hiddenModels ?? []);
  const needle = query.trim().toLowerCase();
  const matches = (text: string | undefined) => !!text?.toLowerCase().includes(needle);
  const shown = (descriptor?.models ?? []).filter(
    (model) =>
      (!hidden.has(model.id) || model.id === choices.model) &&
      (!needle || matches(model.label) || matches(model.id) || matches(model.description)),
  );
  const choice = (model: (typeof shown)[number]): ModelChoice => ({
    value: model.id,
    label: model.label,
    ...(model.description ? { description: model.description } : {}),
    favorite: favorites.includes(model.id),
    fast: !!model.speeds?.length,
  });
  const starred = favorites.flatMap((id) => {
    const model = shown.find((item) => item.id === id);
    return model ? [choice(model)] : [];
  });
  const rest = shown.filter((model) => !favorites.includes(model.id));
  const models = rest.filter((model) => !model.legacy).map(choice);
  const menu: ModelMenu = {
    favorites: starred,
    models,
    legacy: rest.filter((model) => model.legacy).map(choice),
    shortcuts: [...starred, ...models].slice(0, 9).map((model) => model.value),
  };
  const fallback = choices.models[0];
  if (!needle && fallback) menu.default = fallback;
  return menu;
}

/** The favorites after starring or unstarring one model. */
export function toggledFavorite(favorites: string[] = [], id: string): string[] {
  return favorites.includes(id) ? favorites.filter((item) => item !== id) : [...favorites, id];
}

/** The chosen provider settings in words, for the new chat's footer. */
export function policyLabel(choices: ComposerChoices): string {
  return choices.options
    .map((option) => option.values.find((value) => value.value === option.value)?.label)
    .filter(Boolean)
    .join(' · ');
}

/** The share of the context window in use, when the provider reports both. */
export function contextShare(usage?: SessionUsage): { label: string; title: string } | null {
  if (!usage?.contextTokens || !usage.contextWindow) return null;
  const percent = Math.min(100, Math.round((usage.contextTokens / usage.contextWindow) * 100));
  return {
    label: `${percent}% context`,
    title: `${usage.contextTokens.toLocaleString()} of ${usage.contextWindow.toLocaleString()} tokens, as reported by the provider`,
  };
}

/** The last part of a folder path, for places that name a folder briefly. */
export function folderName(path?: string): string {
  return (
    path
      ?.replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''
  );
}

/** The parts of a key press the message box reads. */
export interface ComposerKey {
  key: string;
  shiftKey: boolean;
  /** True while an input method (IME) is composing; its Enter confirms a candidate. */
  isComposing: boolean;
  /** 229 is what some webviews report for a key an IME is handling. */
  keyCode: number;
}

/** Enter sends; Shift+Enter keeps the textarea's own new line. Never mid-composition. */
export function sendsMessage(event: ComposerKey): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
