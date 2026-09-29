// Copies the installers `tauri build` produced into target/release-artifacts
// under consistent names, each with a `.sha256` line:
//   JAM-Code_<version>_<platform>-setup.exe   (Windows NSIS installer)
//   JAM-Code_<version>_<platform>.dmg         (macOS disk image)
// Usage: node scripts/collect-release.mjs <platform>, e.g. windows-x64.
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = process.argv[2];
if (!platform) {
  console.error('Usage: node scripts/collect-release.mjs <platform>');
  process.exit(1);
}
const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8'));
const out = join(root, 'target', 'release-artifacts');
mkdirSync(out, { recursive: true });

/** Bundle folders for a native build and for an explicit `--target` build. */
const bundleDirs = [join(root, 'target', 'release', 'bundle')];
for (const entry of readdirSync(join(root, 'target'), { withFileTypes: true }))
  if (entry.isDirectory()) bundleDirs.push(join(root, 'target', entry.name, 'release', 'bundle'));

const wanted = [
  { dir: 'nsis', match: /-setup\.exe$/, name: `JAM-Code_${version}_${platform}-setup.exe` },
  { dir: 'dmg', match: /\.dmg$/, name: `JAM-Code_${version}_${platform}.dmg` },
];
let copied = 0;
for (const { dir, match, name } of wanted) {
  for (const base of bundleDirs) {
    let files;
    try {
      files = readdirSync(join(base, dir));
    } catch {
      continue;
    }
    const file = files.find((item) => match.test(item) && item.includes(version));
    if (!file) continue;
    const target = join(out, name);
    copyFileSync(join(base, dir, file), target);
    const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
    writeFileSync(`${target}.sha256`, `${digest}  ${basename(target)}\n`);
    console.log(`${name}  ${digest}`);
    copied++;
    break;
  }
}
if (!copied) {
  console.error(`No ${version} installers found under target/**/release/bundle.`);
  process.exit(1);
}
