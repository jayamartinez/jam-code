import { PROTOCOL_VERSION } from '@jam/protocol';
import type { DesktopServices } from '../../desktop';

/**
 * Facts About and Advanced may state, each from a real source: the version
 * the desktop build embeds (see apps/desktop/vite.config.ts), Vite's
 * development flag, the protocol constant and the host platform. Anything a
 * build does not report is `undefined`, and the pages omit it.
 */

export interface BuildFacts {
  version?: string;
  development: boolean;
}

/**
 * Reads the exact `import.meta.env.VITE_JAM_VERSION` expression, which the
 * desktop build replaces at compile time; other hosts leave it undefined.
 */
export function buildFacts(
  version: unknown = import.meta.env.VITE_JAM_VERSION,
  development: unknown = import.meta.env.DEV,
): BuildFacts {
  return {
    ...(typeof version === 'string' && version ? { version } : {}),
    development: development === true,
  };
}

/** The system web engine the interface runs in, by host. */
export function webViewName(platform: DesktopServices['platform']) {
  if (platform === 'macos') return 'WebKit (system)';
  if (platform === 'windows') return 'WebView2 (system)';
  return 'This browser';
}

export function runtimeDescription(platform: DesktopServices['platform']) {
  return platform === 'web'
    ? 'Browser preview · a simulated runtime in this tab'
    : 'Running in the app process';
}

/**
 * What "Copy diagnostics" puts on the clipboard: versions and platform only.
 * Never tokens, paths, project names or message content.
 */
export function diagnosticsText(
  platform: DesktopServices['platform'],
  facts: BuildFacts,
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
) {
  return [
    `jam ${facts.version ?? 'version unknown'}${facts.development ? ' (development build)' : ''}`,
    `protocol v${PROTOCOL_VERSION}`,
    `platform ${platform}`,
    `webview ${webViewName(platform)}`,
    ...(userAgent ? [`user agent ${userAgent}`] : []),
  ].join('\n');
}
