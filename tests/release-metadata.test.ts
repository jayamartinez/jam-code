import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const json = async (path: string) => JSON.parse(await readFile(path, 'utf8'));

/**
 * One version for the whole app. `apps/desktop/package.json` is the source:
 * Tauri reads it for the bundles and Vite embeds it for Settings → About.
 */
describe('release metadata', () => {
  it('every package and crate carries the app version', async () => {
    const { version } = await json('apps/desktop/package.json');
    expect(version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
    for (const path of [
      'package.json',
      'packages/client/package.json',
      'packages/protocol/package.json',
    ])
      expect((await json(path)).version, path).toBe(version);
    const cargo = await readFile('Cargo.toml', 'utf8');
    expect(cargo).toContain(`version = "${version}"`);
    const tauri = await json('apps/desktop/src-tauri/tauri.conf.json');
    expect(tauri.version).toBe('../package.json');
  });

  it('the product is JAM Code under the MIT license', async () => {
    const tauri = await json('apps/desktop/src-tauri/tauri.conf.json');
    expect(tauri.productName).toBe('JAM Code');
    expect(tauri.bundle.license).toBe('MIT');
    expect(await readFile('LICENSE', 'utf8')).toMatch(
      /^MIT License\n\nCopyright \(c\) 2026 Jay Martinez/,
    );
    for (const path of [
      'package.json',
      'apps/desktop/package.json',
      'packages/client/package.json',
      'packages/protocol/package.json',
    ])
      expect((await json(path)).license, path).toBe('MIT');
    expect(await readFile('Cargo.toml', 'utf8')).toContain('license = "MIT"');
  });

  it('bundles ship the license and notices beside the app', async () => {
    const tauri = await json('apps/desktop/src-tauri/tauri.conf.json');
    expect(Object.values(tauri.bundle.resources)).toEqual(['LICENSE', 'THIRD_PARTY_NOTICES.md']);
    expect(tauri.bundle.icon).toEqual(
      expect.arrayContaining(['icons/icon.ico', 'icons/icon.icns', 'icons/icon.png']),
    );
  });
});
