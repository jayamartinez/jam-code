import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JamApp, SnapshotToast, applyCachedAppearance } from '@jam/client';
import type { DesktopServices } from '@jam/client';
import type { JamTransport } from '@jam/protocol';
import { isTauri } from '@tauri-apps/api/core';
import '@jam/client/styles.css';

async function bootstrap() {
  performance.mark('jam-bootstrap');
  // The last theme, before anything paints; the runtime's record follows.
  applyCachedAppearance();
  let transport: JamTransport;
  let desktop: DesktopServices;

  if (isTauri()) {
    const [{ TauriTransport }, { createDesktopServices, suppressBrowserContextMenu }] =
      await Promise.all([import('./tauri-transport'), import('./desktop-services')]);
    transport = new TauriTransport();
    desktop = createDesktopServices();
    suppressBrowserContextMenu();
  } else if (import.meta.env.DEV) {
    const { BrowserPreviewTransport } = await import('@jam/protocol/preview');
    transport = new BrowserPreviewTransport();
    desktop = {
      platform: 'web',
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      startDragging: async () => {},
    };
  } else {
    throw new Error(
      'Open jam in the desktop app. Browser preview is available only in development.',
    );
  }

  const root = document.getElementById('root');
  if (!root) throw new Error('The application root is missing.');
  if (isTauri() && window.location.hash === '#snapshot-toast') {
    const { createSnapshotHost, snapshotToastTransport } = await import('./snapshot-host');
    createRoot(root).render(
      <SnapshotToast transport={snapshotToastTransport} host={createSnapshotHost()} />,
    );
    return;
  }
  createRoot(root).render(
    <StrictMode>
      <JamApp transport={transport} desktop={desktop} />
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  const root = document.getElementById('root');
  if (root) {
    const notice = document.createElement('p');
    notice.setAttribute('role', 'alert');
    notice.textContent = error instanceof Error ? error.message : 'jam could not start.';
    root.replaceChildren(notice);
  }
});
