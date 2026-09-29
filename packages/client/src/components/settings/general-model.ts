import type { ProviderDescriptor } from '@jam/protocol';

/** The provider a new chat uses: the runtime's default, if it is enabled. */
export function defaultProvider(providers: readonly ProviderDescriptor[]) {
  return providers.find((provider) => provider.isDefault && provider.enabled);
}

/** Agents General's shared defaults apply to: every real provider. */
export function liveProviders(providers: readonly ProviderDescriptor[]) {
  return providers.filter((provider) => provider.id !== 'mock');
}

/** The model a provider's new chats start on: its saved default, else its own. */
function startingModel(provider: ProviderDescriptor) {
  const models = provider.models ?? [];
  return (
    models.find((model) => model.id === provider.defaults?.model) ??
    models.find((model) => model.isDefault) ??
    models[0]
  );
}

const EFFORT_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Every effort level any agent's starting model offers, in the usual order. */
export function sharedEfforts(providers: readonly ProviderDescriptor[]) {
  const levels = new Set(liveProviders(providers).flatMap((p) => startingModel(p)?.efforts ?? []));
  return [...levels].sort(
    (a, b) =>
      (EFFORT_ORDER.indexOf(a) + 1 || 99) - (EFFORT_ORDER.indexOf(b) + 1 || 99) ||
      a.localeCompare(b),
  );
}

/**
 * The value General shows for a shared default: the one every agent that has
 * it agrees on, `''` for each agent's own default, or `null` when they differ.
 */
export function sharedDefault(
  providers: readonly ProviderDescriptor[],
  key: 'access' | 'effort',
): string | null {
  const values = new Set(liveProviders(providers).map((p) => p.defaults?.[key] ?? ''));
  return values.size === 1 ? [...values][0]! : values.size === 0 ? '' : null;
}

/**
 * The saved defaults each agent needs so a shared setting applies to all of
 * them. `value` `''` returns every agent to its own default. An effort level
 * an agent's starting model does not offer leaves that agent on its default.
 */
export function withSharedDefault(
  providers: readonly ProviderDescriptor[],
  key: 'access' | 'effort',
  value: string,
): { providerId: ProviderDescriptor['id']; defaults: Record<string, string> }[] {
  return liveProviders(providers).flatMap((provider) => {
    const defaults = { ...provider.defaults };
    const supported =
      key === 'effort'
        ? (startingModel(provider)?.efforts ?? []).includes(value)
        : (provider.options ?? []).some(
            (option) => option.id === key && option.values.some((item) => item.value === value),
          );
    // "Ask" is the access every agent starts with, so it is stored as absent.
    if (value && supported && !(key === 'access' && value === 'ask')) defaults[key] = value;
    else delete defaults[key];
    const before = provider.defaults ?? {};
    const unchanged =
      Object.keys(defaults).length === Object.keys(before).length &&
      Object.entries(defaults).every(([k, v]) => before[k] === v);
    return unchanged ? [] : [{ providerId: provider.id, defaults }];
  });
}
