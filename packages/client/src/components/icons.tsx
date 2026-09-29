import { useId, type ReactNode } from 'react';
import { FileDiff, FileText, Folder, Globe, MessageSquare, Settings, Terminal } from 'lucide-react';
import type { Presentation, ProviderId, ResourceKind } from '@jam/protocol';

/**
 * Normalized icon slots.
 *
 * Every mark renders inside a fixed square whose size is set by the caller's
 * context, not by the artwork. A provider's own geometry therefore cannot grow
 * a row, shift a text baseline or change the optical weight of a list: the slot
 * is `flex: 0 0 auto` with a fixed block size, and the glyph is centered inside
 * it at a per-mark scale. Branding stays recognizable and understated.
 */

/** Slot sizes. `dense` is the list/row size Paper uses throughout the shell. */
export const ICON_SLOT = { dense: 16, tab: 16, pane: 18 } as const;
export type IconDensity = keyof typeof ICON_SLOT;

interface SlotProps {
  density?: IconDensity;
  /** Accessible name. Omit for marks that only repeat adjacent text. */
  label?: string;
  className?: string;
  children: ReactNode;
}

export function IconSlot({ density = 'dense', label, className = '', children }: SlotProps) {
  return (
    <span
      className={`icon-slot ${className}`}
      style={{ '--icon-slot': `${ICON_SLOT[density]}px` } as React.CSSProperties}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {children}
    </span>
  );
}

type MarkId = 'claude' | 'codex' | 'mock';

const CLAUDE_CODE_PATH =
  'M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z';

// The mark from Codex's colour icon, without the white tile it ships on.
const CODEX_PATH =
  'M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z';

/**
 * Provider marks. The mock mark is original, on a 16-unit grid; the Claude Code
 * and Codex marks are the providers' own, on their 24-unit grid. `scale` is the glyph's share of the
 * slot, tuned so differently shaped marks read at the same optical weight.
 */
const MARKS: Record<
  MarkId,
  {
    name: string;
    scale: number;
    tone: string;
    /** A function receives an ID unique to this instance, for gradients. */
    draw: ReactNode | ((id: string) => ReactNode);
    viewBox?: string;
  }
> = {
  claude: {
    name: 'Claude Code',
    scale: 0.92,
    tone: 'var(--color-provider-claude)',
    viewBox: '0 0 24 24',
    // Claude Code's own mark, supplied by the project owner. It is wide and
    // short, so it takes more of the slot to match the Codex mark's weight.
    draw: <path fillRule="evenodd" clipRule="evenodd" fill="currentColor" d={CLAUDE_CODE_PATH} />,
  },
  codex: {
    name: 'Codex',
    scale: 0.86,
    tone: 'var(--color-provider-codex)',
    // Cropped to the mark itself; the tile it ships on is dropped.
    viewBox: '3 3 18 18',
    draw: (id) => (
      <>
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="12" x2="12" y1="3" y2="21">
            <stop stopColor="var(--color-provider-codex-from)" />
            <stop offset=".5" stopColor="var(--color-provider-codex-mid)" />
            <stop offset="1" stopColor="var(--color-provider-codex-to)" />
          </linearGradient>
        </defs>
        <path fill={`url(#${id})`} d={CODEX_PATH} />
      </>
    ),
  },
  mock: {
    name: 'Mock provider',
    scale: 0.72,
    tone: 'var(--color-text-subtle)',
    draw: (
      <circle
        cx="8"
        cy="8"
        r="5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="2.6 2.4"
      />
    ),
  },
};

export interface ProviderIconProps {
  /** The agent a conversation presents as. */
  presentation?: Presentation;
  /** The adapter actually running it, when that is the honest thing to show. */
  providerId?: ProviderId;
  density?: IconDensity;
  /** Pass a name when the icon is the only indication of which agent this is. */
  label?: string;
  className?: string;
}

export function ProviderIcon({
  presentation,
  providerId,
  density = 'dense',
  label,
  className = '',
}: ProviderIconProps) {
  // The demo adapter never borrows a real provider's mark, whatever the
  // conversation was presented as.
  const id: MarkId | undefined =
    providerId === 'mock' ? 'mock' : (presentation ?? (providerId as MarkId | undefined));
  const mark = id ? MARKS[id] : undefined;
  const slot = ICON_SLOT[density];
  const gradientId = `mark-${useId().replace(/:/g, '')}`;
  if (!mark)
    // An unknown provider stays unknown rather than borrowing another's mark.
    return (
      <IconSlot density={density} label={label ?? 'Unknown provider'} className={className}>
        <span className="icon-fallback" />
      </IconSlot>
    );
  return (
    <IconSlot density={density} label={label} className={`provider-icon ${className}`}>
      <svg
        viewBox={mark.viewBox ?? '0 0 16 16'}
        width={Math.round(slot * mark.scale)}
        height={Math.round(slot * mark.scale)}
        style={{ color: mark.tone }}
        focusable="false"
      >
        {typeof mark.draw === 'function' ? mark.draw(gradientId) : mark.draw}
      </svg>
    </IconSlot>
  );
}

export function providerName(presentation?: Presentation) {
  return presentation ? MARKS[presentation].name : 'Unknown provider';
}

/** The name of the adapter actually running a session. */
export function sessionProviderName(session?: {
  providerId: ProviderId;
  presentation: Presentation;
}) {
  if (!session) return 'Unknown provider';
  return session.providerId === 'mock' ? 'Demo provider' : providerName(session.presentation);
}

const RESOURCE_GLYPHS = {
  conversation: MessageSquare,
  terminal: Terminal,
  browser: Globe,
  file: FileText,
  'file-browser': Folder,
  diff: FileDiff,
  settings: Settings,
} as const satisfies Record<ResourceKind, unknown>;

export interface ResourceIconProps {
  kind: ResourceKind;
  /** A conversation shows its agent's mark instead of a generic bubble. */
  presentation?: Presentation;
  /** The adapter running the conversation, so a demo never shows a real mark. */
  providerId?: ProviderId;
  density?: IconDensity;
  label?: string;
  className?: string;
}

export function ResourceIcon({
  kind,
  presentation,
  providerId,
  density = 'dense',
  label,
  className = '',
}: ResourceIconProps) {
  if (kind === 'conversation')
    return (
      <ProviderIcon
        presentation={presentation}
        providerId={providerId}
        density={density}
        label={label}
        className={className}
      />
    );
  const Glyph = RESOURCE_GLYPHS[kind];
  return (
    <IconSlot density={density} label={label} className={`resource-icon ${className}`}>
      <Glyph size={Math.round(ICON_SLOT[density] * 0.78)} strokeWidth={1.5} />
    </IconSlot>
  );
}

/** A folder with a second behind it: a checkout of its own. */
export function WorktreeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M1.5 5a1 1 0 011-1h3l1.3 1.3h3.7a1 1 0 011 1v5.2a1 1 0 01-1 1h-8a1 1 0 01-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M13 7.5h1.5v5.8a1 1 0 01-1 1h-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
