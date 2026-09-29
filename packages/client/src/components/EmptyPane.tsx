import { Plus } from 'lucide-react';
import { PaneChrome, type PaneChromeProps } from './PaneChrome';
import { useShortcutHint } from '../state/keybindings';

/**
 * A pane with no resource yet.
 *
 * Splitting creates this state deliberately: the new pane exists, and the next
 * step is choosing what it should show. It keeps the same header controls as
 * every other pane so the arrangement can still be changed from here.
 */
export function EmptyPane({
  shortcut,
  onChoose,
  ...chrome
}: Pick<
  PaneChromeProps,
  'focused' | 'onSplitRight' | 'onSplitDown' | 'onExpand' | 'expandLabel' | 'menu'
> & {
  shortcut: string;
  onChoose(anchor: Element): void;
}) {
  const newTabHint = useShortcutHint('new-tab', shortcut === '⌘');
  return (
    <PaneChrome
      {...chrome}
      className="empty-pane"
      label="Empty pane"
      heading={<span className="muted">New pane</span>}
    >
      <div className="empty-pane-body">
        <p>Choose what to open here.</p>
        <button
          type="button"
          className="button primary"
          onClick={(event) => onChoose(event.currentTarget)}
        >
          <Plus size={14} />
          New resource
        </button>
        <p className="subtle">
          A chat, terminal, file, file browser or review can go in any pane.
          <br />
          This pane belongs to this tab.{' '}
          {newTabHint ? (
            <>
              <kbd>{newTabHint}</kbd> opens a new tab instead.
            </>
          ) : (
            'A new tab is another way in.'
          )}
        </p>
      </div>
    </PaneChrome>
  );
}
