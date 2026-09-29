import { Play } from 'lucide-react';
import { SOUNDS, playSound, type SoundId } from '../../sounds';
import { useNotificationPrefs } from '../../../state/notification-prefs';
import type { BadgeTone } from '../../../state/chat-activity';
import { Card, PageHeader, Row, Section, Select, Toggle } from '../controls';
import type { SettingsPageProps } from '../types';

const BADGES: { tone: BadgeTone; count: number; label: string }[] = [
  { tone: 'input', count: 2, label: 'Needs you' },
  { tone: 'error', count: 1, label: 'Error' },
  { tone: 'finished', count: 3, label: 'Finished' },
];

/** Paper, Settings "Settings v2 · Notifications". */
export default function NotificationsPage({ platform }: SettingsPageProps) {
  const [prefs, update] = useNotificationPrefs();
  const desktop = platform !== 'web';
  return (
    <div className="sv-page">
      <PageHeader
        title="Notifications"
        description="How JAM tells you a chat finished, needs you, or hit an error."
      />

      <Section label="Sound">
        <Card>
          <Row title="Play a sound" sub="When an agent finishes or needs your input.">
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
        </Card>
      </Section>

      <Section label="Badge">
        <Card>
          <Row
            title="Show a badge"
            sub={
              desktop
                ? `How many chats want you, on the ${platform === 'macos' ? 'Dock' : 'taskbar'} and tray icon. Its colour is the most urgent one.`
                : 'Only the desktop app can badge its icon.'
            }
            disabled={!desktop}
          >
            <div className="notify-badges" aria-hidden="true">
              {BADGES.map((badge) => (
                <span key={badge.tone} className="notify-badge-sample">
                  <span className="notify-badge-icon">
                    jam<i className={`notify-badge ${badge.tone}`}>{badge.count}</i>
                  </span>
                  <span>{badge.label}</span>
                </span>
              ))}
            </div>
            <Toggle
              label="Show a badge"
              on={prefs.badge}
              disabled={!desktop}
              onChange={(badge) => update({ badge })}
            />
          </Row>
        </Card>
      </Section>

      <Section label="System notifications">
        <Card>
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
    </div>
  );
}
