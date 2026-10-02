import type { DesktopServices } from '@jam/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createSnapshotHost } from './snapshot-host';
import { createBrowserHost } from './browser-host';

/**
 * The WebView's own context menu (Reload, Inspect Element, Back) belongs to a
 * browser, not a desktop app, on macOS and Windows alike. It is suppressed
 * everywhere except where text is edited or selected, so Cut/Copy/Paste and
 * spelling stay native. JAM's own menus call preventDefault themselves; this
 * listener runs after React's, on bubbling, and only fills the gaps.
 *
 * On macOS a right-click (by mouse, trackpad or Control-click) selects the
 * word under the pointer just before `contextmenu` fires, so there the
 * selection that counts is the one the reader had made. `selectionchange`
 * arrives later than the menu event, so the last one seen still describes the
 * selection from before the click. A click that is refused takes back the word
 * it selected, leaving the page as it was.
 */
export function suppressBrowserContextMenu() {
  const mac = navigator.platform.startsWith('Mac');
  const hasSelection = () => !(window.getSelection()?.isCollapsed ?? true);
  let selectedBeforeClick = hasSelection();
  if (mac)
    document.addEventListener('selectionchange', () => {
      selectedBeforeClick = hasSelection();
    });
  window.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editable = target?.closest(
      'input, textarea, [contenteditable=""], [contenteditable="true"]',
    );
    if (editable || (mac ? selectedBeforeClick : hasSelection())) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (mac && selection && !selection.isCollapsed) selection.collapseToStart();
  });
}

/**
 * macOS keeps ⌘. from the page (it means "cancel" there); the host forwards
 * it, and it arrives as the key press it was, so shortcuts and the Keybindings
 * recorder handle it like any other.
 */
export function receiveForwardedKeys() {
  void listen<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean }>(
    'command-period',
    ({ payload }) => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '.',
          code: 'Period',
          metaKey: true,
          ...payload,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
  );
}

export function createDesktopServices(): DesktopServices {
  const nativeWindow = getCurrentWindow();
  return {
    platform: navigator.platform.startsWith('Mac') ? 'macos' : 'windows',
    minimize: () => nativeWindow.minimize(),
    toggleMaximize: () => nativeWindow.toggleMaximize(),
    close: () => nativeWindow.close(),
    startDragging: () => nativeWindow.startDragging(),
    pickDirectory: (start?: string) =>
      invoke<string | null>('pick_directory', start ? { start } : {}),
    attachFiles: (room) => invoke('attach_files', { room }),
    openFeedback: (kind) => invoke<void>('open_feedback', { kind }),
    browser: createBrowserHost(),
    snapshots: createSnapshotHost(),
    setAttentionBadge: (badge) => invoke('set_attention_badge', { badge }),
    notify: ({ title, body }) => invoke('notify', { title, body }),
  };
}
