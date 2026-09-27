import type { ProviderDescriptor } from '@jam/protocol';

/** The provider a new chat uses: the runtime's default, if it is enabled. */
export function defaultProvider(providers: readonly ProviderDescriptor[]) {
  return providers.find((provider) => provider.isDefault && provider.enabled);
}

export type NotificationChannel = 'notification' | 'badge' | 'sound';

/** The intended defaults for thread notifications, shown while they are planned. */
export const NOTIFICATION_EVENTS: {
  id: 'input' | 'finished' | 'error';
  label: string;
  tone: 'warning' | 'success' | 'danger';
  defaults: Record<NotificationChannel, boolean>;
}[] = [
  {
    id: 'input',
    label: 'Needs your input or approval',
    tone: 'warning',
    defaults: { notification: true, badge: true, sound: true },
  },
  {
    id: 'finished',
    label: 'Finished a turn',
    tone: 'success',
    defaults: { notification: false, badge: true, sound: false },
  },
  {
    id: 'error',
    label: 'Hit an error',
    tone: 'danger',
    defaults: { notification: true, badge: true, sound: false },
  },
];
