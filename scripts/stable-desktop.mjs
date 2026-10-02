// Builds this checkout into target/stable and opens it: a copy of JAM Code
// that nothing rebuilds or reloads while you work in it, for working on JAM
// Code inside JAM Code. `pnpm desktop` restarts the app whenever a Rust file
// in its checkout changes, which ends every chat running in it.
//
// The copy uses your real history. It is a release build with the frontend
// embedded, in its own target folder so other builds never replace it.
// Usage: node scripts/stable-desktop.mjs          build, then open
//        node scripts/stable-desktop.mjs --open   open the last build as it is
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const targetDir = join(root, 'target', 'stable');
const binary = join(
  targetDir,
  'release',
  process.platform === 'win32' ? 'jam-desktop.exe' : 'jam-desktop',
);
const openOnly = process.argv.includes('--open');

if (openOnly && !existsSync(binary)) {
  console.error('There is no stable build yet. Run `pnpm desktop:stable` to make one.');
  process.exit(1);
}

if (!openOnly) {
  // Windows keeps a running program's file locked, so the build could not
  // replace it; say so now rather than after minutes of compiling.
  if (process.platform === 'win32' && existsSync(binary)) {
    try {
      closeSync(openSync(binary, 'r+'));
    } catch {
      console.error(
        'The stable copy is running. Quit it from its tray icon, then run this again,\n' +
          'or use `pnpm desktop:stable --open` to bring it back without rebuilding.',
      );
      process.exit(1);
    }
  }
  const build = spawnSync('pnpm --filter @jam/desktop tauri build --no-bundle', {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, CARGO_TARGET_DIR: targetDir },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// On Windows a child inherits every open handle of this process, including an
// output pipe when the command's output is captured (an agent's terminal, a
// script): the app would hold that pipe open and the command would never
// finish. Explorer starts it as a double-click does, inheriting nothing.
const [command, args] = process.platform === 'win32' ? ['explorer.exe', [binary]] : [binary, []];
spawn(command, args, { cwd: root, detached: true, stdio: 'ignore' }).unref();
console.log(`Opened ${binary}`);
