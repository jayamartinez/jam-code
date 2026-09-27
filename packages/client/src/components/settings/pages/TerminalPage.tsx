import {
  Chip,
  Card,
  PageHeader,
  Planned,
  Row,
  Section,
  Segmented,
  Select,
  Toggle,
} from '../controls';
import { TERMINAL_FACTS } from '../tools-model';
import type { SettingsPageProps } from '../types';

/**
 * Terminal. The values shown are what a Terminal tab does today (a login
 * shell in the project folder, block cursor, bounded scrollback); choosing
 * them is planned, so the controls are read-only.
 */
export default function TerminalPage({ onNavigate }: SettingsPageProps) {
  return (
    <div className="sv-page">
      <PageHeader
        title="Terminal"
        description="Shells JAM runs for you, one per Terminal tab. The preview uses your current theme and terminal font."
      />

      <TerminalPreview />

      <Section label="Shell">
        <Card>
          <Row
            title="Shell"
            sub="Your login shell from $SHELL, started as a login shell so your profile and PATH load."
          >
            <Chip>Login shell</Chip>
          </Row>
          <Row
            title={
              <>
                Start in <Planned />
              </>
            }
            sub="Today a tab opens in the project's first folder, or your home folder if it has none."
          >
            <Segmented
              label="Start in"
              value="project"
              options={[
                { value: 'project', label: 'Project folder' },
                { value: 'home', label: 'Home' },
                { value: 'last', label: 'Last directory' },
              ]}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Display">
        <Card>
          <Row
            title="Font"
            sub={
              <>
                Follows Appearance ·{' '}
                <button type="button" className="sv-link" onClick={() => onNavigate('Appearance')}>
                  Change in Appearance
                </button>
              </>
            }
          >
            <span className="gt-pill tools-font-sample">Aa 0Ol1</span>
          </Row>
          <Row
            title={
              <>
                Cursor <Planned />
              </>
            }
          >
            <Segmented
              label="Cursor"
              value="block"
              options={[
                { value: 'block', label: 'Block' },
                { value: 'bar', label: 'Bar' },
                { value: 'underline', label: 'Underline' },
              ]}
            />
            <span className="tools-inline-label">Blink</span>
            <Toggle label="Blink" on={false} />
          </Row>
          <Row
            title={
              <>
                Scrollback <Planned />
              </>
            }
            sub="Bounded so long builds stay light. Older lines are dropped, not saved."
          >
            <Select
              label="Scrollback"
              value="current"
              options={[{ value: 'current', label: TERMINAL_FACTS.scrollbackLabel }]}
            />
          </Row>
        </Card>
      </Section>

      <Section
        label={
          <>
            Input <Planned />
          </>
        }
      >
        <Card>
          <Row
            title="Option as Meta"
            sub="For Emacs-style word jumps. Off today, so ⌥ types accented characters."
          >
            <Toggle label="Option as Meta" on={TERMINAL_FACTS.optionAsMeta} />
          </Row>
          <Row title="Copy on select">
            <Toggle label="Copy on select" on={false} />
          </Row>
          <Row
            title="Confirm multi-line paste"
            sub="Show the lines first so a pasted script doesn't run by surprise."
          >
            <Toggle label="Confirm multi-line paste" on={false} />
          </Row>
        </Card>
      </Section>
    </div>
  );
}

/** A still picture of a Terminal tab in the current theme; no process runs. */
function TerminalPreview() {
  return (
    <div className="tools-terminal" aria-hidden="true">
      <div className="tools-terminal-bar">
        <span className="tools-terminal-title">
          <i />
          Terminal preview
        </span>
        <span className="sv-mono">{TERMINAL_FACTS.scrollbackLabel}</span>
      </div>
      <div className="tools-terminal-screen">
        <p>
          <span className="t-blue">~/project</span> <span className="t-magenta">main</span>{' '}
          <span className="t-dim">›</span> pnpm test
        </p>
        <p>
          <span className="t-dim">RUN</span> packages/client
        </p>
        <p>
          <span className="t-green">✓</span> appearance/resolve.test.ts{' '}
          <span className="t-dim">(42 tests)</span>
        </p>
        <p>
          <span className="t-green">✓</span> markdown/render.test.ts{' '}
          <span className="t-dim">(19 tests)</span>
        </p>
        <p>
          <span className="t-yellow">↓</span> terminal/pty.test.ts{' '}
          <span className="t-dim">(skipped)</span>
        </p>
        <p>
          Tests <span className="t-green">61 passed</span>{' '}
          <span className="t-dim">· 1 skipped</span>
        </p>
        <p>
          <span className="t-blue">~/project</span> <span className="t-magenta">main</span>{' '}
          <span className="t-dim">›</span> <span className="tools-cursor" />
        </p>
      </div>
    </div>
  );
}
