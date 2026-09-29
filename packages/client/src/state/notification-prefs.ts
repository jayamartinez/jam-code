import { useCallback, useSyncExternalStore } from 'react';
import { isSoundId, type SoundId } from '../components/sounds';

/**
 * How JAM tells you about a chat (Settings → Notifications). A client
 * preference in this profile, like Stream replies; shared by every reader so
 * a toggle takes effect at once.
 */
export interface NotificationPrefs {
  sound: boolean;
  soundId: SoundId;
  badge: boolean;
  /** System notifications while JAM isn't the window in use. */
  system: boolean;
}

const KEY = 'jam.notifications';
const DEFAULTS: NotificationPrefs = { sound: true, soundId: 'chime', badge: true, system: false };
const listeners = new Set<() => void>();
let current: NotificationPrefs | null = null;

function read(): NotificationPrefs {
  if (current) return current;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const value = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
    current = {
      sound: typeof value.sound === 'boolean' ? value.sound : DEFAULTS.sound,
      soundId: isSoundId(value.soundId) ? value.soundId : DEFAULTS.soundId,
      badge: typeof value.badge === 'boolean' ? value.badge : DEFAULTS.badge,
      system: typeof value.system === 'boolean' ? value.system : DEFAULTS.system,
    };
  } catch {
    current = DEFAULTS;
  }
  return current;
}

export function useNotificationPrefs(): [
  NotificationPrefs,
  (changes: Partial<NotificationPrefs>) => void,
] {
  const prefs = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read,
    () => DEFAULTS,
  );
  const update = useCallback((changes: Partial<NotificationPrefs>) => {
    current = { ...read(), ...changes };
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Losing the preference only restores the defaults.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [prefs, update];
}
