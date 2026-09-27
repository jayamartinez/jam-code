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
  /** Provider-specific settings, such as a permission mode or sandbox. */
  options: { id: string; label: string; value: string; values: Choice[] }[];
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
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
  const efforts = (chosen ?? models.find((model) => model.isDefault) ?? models[0])?.efforts ?? [];
  return {
    models: models.length
      ? [
          {
            value: '',
            label: current ? `Default · ${current}` : 'Default model',
            description: 'Whatever the provider’s own configuration selects.',
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
          { value: '', label: 'Default effort' },
          ...efforts.map((effort) => ({ value: effort, label: `${effortLabel(effort)} effort` })),
        ]
      : [],
    effort: options.effort && efforts.includes(options.effort) ? options.effort : '',
    options: (descriptor?.options ?? []).map((option) => ({
      id: option.id,
      label: option.label,
      value: options[option.id] ?? option.default,
      values: option.values,
    })),
  };
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
