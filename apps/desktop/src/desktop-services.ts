import type { DesktopServices } from '@jam/client';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function createDesktopServices(): DesktopServices {
  const nativeWindow = getCurrentWindow();
  return {
    platform: navigator.platform.startsWith('Mac') ? 'macos' : 'windows',
    minimize: () => nativeWindow.minimize(),
    toggleMaximize: () => nativeWindow.toggleMaximize(),
    close: () => nativeWindow.close(),
    startDragging: () => nativeWindow.startDragging(),
  };
}
