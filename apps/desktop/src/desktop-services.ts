import type { DesktopServices } from '@jam/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createSnapshotHost } from './snapshot-host';
import { createBrowserHost } from './browser-host';

/**
 * The WebView's own context menu (Reload, Inspect Element, Back) belongs to a
 * browser, not a desktop app, on macOS and Windows alike. It is suppressed
 * everywhere except where text is edited or selected, so Cut/Copy/Paste and
 * spelling stay native. JAM's own menus call preventDefault themselves; this
 * listener runs after React's, on bubbling, and only fills the gaps.
 */
export function suppressBrowserContextMenu() {
  window.addEventListener('contextmenu', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const editable = target?.closest(
      'input, textarea, [contenteditable=""], [contenteditable="true"]',
    );
    const selected = !(window.getSelection()?.isCollapsed ?? true);
    if (!editable && !selected) event.preventDefault();
  });
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
    browser: createBrowserHost(),
    snapshots: createSnapshotHost(),
  };
}
