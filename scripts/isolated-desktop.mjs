// Runs this checkout's app in development as a copy of its own: its own data,
// its own single-instance identity and its own port. It runs beside the stable
// copy (`pnpm desktop:stable`), beside `pnpm desktop`, and beside the isolated
// copies of other checkouts, so agents in separate worktrees can each try the
// build they are working on.
//
// `pnpm desktop` always uses port 1420 and your real history; this picks a
// free port and never touches that history.
// Usage: node scripts/isolated-desktop.mjs [arguments for `tauri dev`]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = join(root, 'apps', 'desktop');
const base = JSON.parse(readFileSync(join(desktop, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const basePort = new URL(base.build.devUrl).port;

/** A port nothing is listening on, chosen by the operating system. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

// One identity per checkout: an identifier takes letters, digits, hyphens and
// periods, so the folder's name is reduced to those.
const checkout =
  basename(root)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'checkout';
const identifier = `${base.identifier}.isolated.${checkout}`;
const port = await freePort();

// Tauri merges this over tauri.conf.json. The development content security
// policy names the port, so it moves with it.
const config = {
  identifier,
  build: {
    devUrl: `http://127.0.0.1:${port}`,
    beforeDevCommand: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
  },
  app: { security: { devCsp: base.app.security.devCsp.replaceAll(`:${basePort}`, `:${port}`) } },
};
// Under target/, which Git ignores and the development watcher does not watch.
const configDir = join(root, 'target', 'isolated');
mkdirSync(configDir, { recursive: true });
const configPath = join(configDir, 'tauri.conf.json');
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Isolated copy of ${basename(root)}: port ${port}, data in ${identifier}`);
const extra = process.argv.slice(2).join(' ');
const run = spawnSync(`pnpm --filter @jam/desktop tauri dev --config "${configPath}" ${extra}`, {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
process.exit(run.status ?? 1);
