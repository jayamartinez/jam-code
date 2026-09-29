import { Play } from 'lucide-react';
import { SOUNDS, playSound, type SoundId } from '../sounds';
import { useNotificationPrefs } from '../../state/notification-prefs';
import type { BadgeTone } from '../../state/chat-activity';
import type { DesktopServices } from '../../desktop';
import { Card, Row, Section, Select, Toggle } from './controls';

const BADGES: { tone: BadgeTone; label: string }[] = [
  { tone: 'input', label: 'Needs you' },
  { tone: 'error', label: 'Error' },
  { tone: 'finished', label: 'Finished' },
];

/**
 * General → Notifications: how JAM tells you a chat finished, needs you, or
 * hit an error — a sound, a dot on the app icon, and system notifications.
 */
export function NotificationSettings({ platform }: { platform: DesktopServices['platform'] }) {
  const [prefs, update] = useNotificationPrefs();
  const desktop = platform !== 'web';
  return (
    <Section label="Notifications" hint="When a chat finishes, needs you, or hits an error.">
      <Card>
        <Row
          title="Play a sound"
          sub="When an agent finishes or needs your input while you’re in another app."
        >
          <Toggle label="Play a sound" on={prefs.sound} onChange={(sound) => update({ sound })} />
        </Row>
        <Row title="Sound" disabled={!prefs.sound}>
          <button
            type="button"
            className="sv-button notify-play"
            aria-label="Play this sound"
            title="Play"
            disabled={!prefs.sound}
            onClick={() => playSound(prefs.soundId)}
          >
            <Play size={11} aria-hidden="true" />
          </button>
          <Select
            label="Sound"
            value={prefs.soundId}
            disabled={!prefs.sound}
            options={SOUNDS.map((sound) => ({ value: sound.id, label: sound.label }))}
            onChange={(value) => {
              update({ soundId: value as SoundId });
              playSound(value as SoundId);
            }}
          />
        </Row>
        <Row
          title="Show a badge"
          sub={
            desktop ? (
              <>
                A dot on the {platform === 'macos' ? 'Dock' : 'taskbar'} and tray icon while a chat
                wants you, coloured by the most urgent reason.
                <span className="notify-legend">
                  {BADGES.map((badge) => (
                    <span key={badge.tone}>
                      <i className={`notify-dot ${badge.tone}`} aria-hidden="true" />
                      {badge.label}
                    </span>
                  ))}
                </span>
              </>
            ) : (
              'Only the desktop app can badge its icon.'
            )
          }
          disabled={!desktop}
        >
          <Toggle
            label="Show a badge"
            on={prefs.badge}
            disabled={!desktop}
            onChange={(badge) => update({ badge })}
          />
        </Row>
        <Row
          title="Show notifications"
          sub={
            desktop
              ? `From ${platform === 'macos' ? 'macOS' : 'Windows'}, only while JAM isn't the window you're using.`
              : 'Only the desktop app can show system notifications.'
          }
          disabled={!desktop}
        >
          <Toggle
            label="Show notifications"
            on={prefs.system}
            disabled={!desktop}
            onChange={(system) => update({ system })}
          />
        </Row>
      </Card>
    </Section>
  );
}
