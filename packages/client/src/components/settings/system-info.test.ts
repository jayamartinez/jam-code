import { describe, expect, it } from 'vitest';
import { buildFacts, diagnosticsText, runtimeDescription, webViewName } from './system-info';

describe('system facts', () => {
  it('omits a version the build does not report', () => {
    expect(buildFacts(undefined, false)).toEqual({ development: false });
    expect(buildFacts('', true)).toEqual({ development: true });
    expect(buildFacts('0.1.0', false)).toEqual({ version: '0.1.0', development: false });
  });

  it('names the host honestly', () => {
    expect(webViewName('macos')).toBe('WebKit (system)');
    expect(webViewName('windows')).toBe('WebView2 (system)');
    expect(runtimeDescription('web')).toContain('Browser preview');
  });

  it('copies versions and platform only', () => {
    const text = diagnosticsText('macos', { version: '0.1.0', development: true }, 'UA');
    expect(text).toContain('jam 0.1.0 (development build)');
    expect(text).toContain('protocol v1');
    expect(text).toContain('platform macos');
    expect(diagnosticsText('windows', { development: false }, '')).not.toContain('user agent');
  });
});
