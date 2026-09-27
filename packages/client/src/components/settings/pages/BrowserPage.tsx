import { ChevronLeft, ScanLine, Shield } from 'lucide-react';
import { Card, Chip, PageHeader, Planned, Row, Section, Segmented, Toggle } from '../controls';

/**
 * Browser. Annotation and the separate profile are real; where links open,
 * what a new tab shows and the profile's tools are planned.
 */
export default function BrowserPage() {
  return (
    <div className="sv-page">
      <PageHeader
        title="Browser"
        description="A real web view inside JAM for previews and annotation. Pages run in their own profile, apart from JAM's window."
      />

      <AnnotatePreview />

      <Section label="Annotate">
        <Card>
          <Row
            title="Picking an element adds"
            sub="What the agent receives about the thing you pointed at. Drag to capture a region instead."
          >
            <Chip>Selector &amp; text</Chip>
            <Chip>Styles</Chip>
            <Chip>Console errors</Chip>
          </Row>
          <Row title="Stage to" sub="Added to a composer as context; you decide when to send.">
            <span className="gt-pill">This tab's chat, else the last used</span>
          </Row>
        </Card>
      </Section>

      <Section
        label={
          <>
            Links &amp; new tabs <Planned />
          </>
        }
      >
        <Card>
          <Row title="Web links open in" sub="Links in Markdown open in a JAM Browser tab today.">
            <Segmented
              label="Web links open in"
              value="jam"
              options={[
                { value: 'jam', label: 'JAM Browser' },
                { value: 'system', label: 'System browser' },
              ]}
            />
          </Row>
          <Row
            title="Open localhost links beside the chat"
            sub="Split the pane instead of adding a tab."
          >
            <Toggle label="Open localhost links beside the chat" on={false} />
          </Row>
          <Row title="New tab opens">
            <Segmented
              label="New tab opens"
              value="blank"
              options={[
                { value: 'blank', label: 'Blank' },
                { value: 'dev', label: 'Project dev server' },
              ]}
            />
          </Row>
        </Card>
      </Section>

      <Section label="Profile & developer">
        <Card>
          <div className="sv-row">
            <span className="tools-row-icon" aria-hidden="true">
              <Shield size={14} />
            </span>
            <div className="sv-row-text">
              <strong>Separate JAM profile</strong>
              <p>Cookies, storage and cache for browsed sites stay apart from JAM's own window.</p>
            </div>
            <div className="sv-row-control">
              <Planned />
              <button type="button" className="sv-button" disabled>
                Clear site data…
              </button>
            </div>
          </div>
          <Row
            title={
              <>
                Web inspector <Planned />
              </>
            }
            sub="Inspect pages open in Browser tabs."
          >
            <Toggle label="Web inspector" on={false} />
          </Row>
        </Card>
      </Section>
    </div>
  );
}

/** Annotate mode, pictured: an element outlined in a page, staged in a composer. */
function AnnotatePreview() {
  return (
    <div className="tools-annotate" aria-hidden="true">
      <div className="tools-mini-browser">
        <div className="tools-mini-bar">
          <ChevronLeft size={11} />
          <span className="tools-mini-url">
            <i />
            localhost:5173/pricing
          </span>
          <span className="tools-mini-mode">Annotate</span>
        </div>
        <div className="tools-mini-page">
          <div className="tools-mini-nav">
            <b />
            <span />
            <span />
            <span />
          </div>
          <b className="tools-mini-title" />
          <span className="tools-mini-line" />
          <div className="tools-mini-cards">
            <div>
              <span />
              <b />
            </div>
            <div className="picked">
              <span />
              <b />
              <em />
              <small>div.plan-card.pro</small>
            </div>
            <div>
              <span />
              <b />
            </div>
          </div>
        </div>
      </div>
      <div className="tools-annotate-arrow" />
      <div className="tools-annotate-stage">
        <span className="tools-stage-label">Staged in a chat</span>
        <div className="tools-mini-composer">
          <span className="tools-context-chip">
            <ScanLine size={11} />
            Pro plan card <small>/pricing</small>
          </span>
          <span className="tools-composer-text">Make this button match the others…</span>
          <span className="tools-composer-send">Send</span>
        </div>
      </div>
    </div>
  );
}
