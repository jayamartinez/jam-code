import { SURFACE_ROLES, type SurfaceRole } from '@jam/protocol';
import { Card, Row, Section } from '../settings/controls';
import { ColorInput } from './controls';

const LABELS: Record<SurfaceRole, { label: string; sub?: string }> = {
  canvas: { label: 'Canvas', sub: 'Panes, the editor and chat.' },
  sidebar: { label: 'Sidebar' },
  raised: { label: 'Raised', sub: 'Composer, menus and cards.' },
};

/**
 * The theme's surface colors on the Appearance page (Paper, "25 · Appearance:
 * theme colors on the main page"). A change saves by itself into the reader's
 * own theme; nothing here has a Save button. While Match colors to image is
 * on, a surface shows the image's color until the reader sets it, and can be
 * handed back.
 */
export function ThemeColors({
  surfaces,
  saved,
  full,
  onChange,
  onFollowImage,
  onAllColors,
}: {
  surfaces: Record<SurfaceRole, { color: string; fromImage: boolean }>;
  /** Where changes go, in words. */
  saved: string;
  /** A copy would be needed and there is no room for another theme. */
  full: boolean;
  onChange(role: SurfaceRole, value: string): void;
  /** Hands a surface the reader set back to the image. Absent when it is not matching. */
  onFollowImage?(role: SurfaceRole): void;
  onAllColors(): void;
}) {
  return (
    <Section label="Theme colors">
      <Card>
        {SURFACE_ROLES.map((role) => {
          const { label, sub } = LABELS[role];
          const { color, fromImage } = surfaces[role];
          return (
            <Row
              key={role}
              title={
                <>
                  {label}
                  {fromImage && <span className="sv-chip ap-from-image">From image</span>}
                </>
              }
              sub={sub}
              disabled={full}
            >
              {onFollowImage && !fromImage && (
                <button
                  type="button"
                  className="sv-button quiet"
                  onClick={() => onFollowImage(role)}
                >
                  Use image color
                </button>
              )}
              <ColorInput
                label={label}
                value={color}
                disabled={full}
                onChange={(value) => onChange(role, value)}
              />
            </Row>
          );
        })}
        <Row title={<span className="ap-colors-saved">{saved}</span>}>
          <button type="button" className="sv-button" onClick={onAllColors}>
            All colors…
          </button>
        </Row>
      </Card>
    </Section>
  );
}
