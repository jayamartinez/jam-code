// Writes THIRD_PARTY_NOTICES.md: the assets vendored into this repository and
// every package the shipped app contains, with its declared license. Run
// `node scripts/third-party-notices.mjs` after changing dependencies; CI
// fails when the file is out of date (`--check`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  });

/** Crates linked into the app (normal and build dependencies) on both targets. */
function crates() {
  const found = new Map();
  for (const target of ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin']) {
    const meta = JSON.parse(
      run('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', target]),
    );
    const packages = new Map(meta.packages.map((item) => [item.id, item]));
    const nodes = new Map(meta.resolve.nodes.map((node) => [node.id, node]));
    const own = new Set(['jam-desktop', 'jam-runtime']);
    const stack = meta.packages.filter((item) => own.has(item.name)).map((item) => item.id);
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of nodes.get(id).deps)
        if (dep.dep_kinds.some((kind) => kind.kind === null || kind.kind === 'build'))
          stack.push(dep.pkg);
    }
    for (const id of seen) {
      const item = packages.get(id);
      if (own.has(item.name)) continue;
      found.set(`${item.name}@${item.version}`, {
        name: item.name,
        version: item.version,
        license: item.license ?? 'See the crate',
      });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Production npm packages bundled into the interface. */
function npmPackages() {
  const byLicense = JSON.parse(run('pnpm', ['licenses', 'list', '--prod', '--json']));
  const found = [];
  for (const [license, items] of Object.entries(byLicense))
    for (const item of items)
      found.push({ name: item.name, version: item.versions.join(', '), license });
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const table = (rows) =>
  ['| Package | Version | License |', '| --- | --- | --- |']
    .concat(rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`))
    .join('\n');

const materialLicense = readFileSync(
  new URL('packages/client/src/components/file-icons/material/LICENSE.md', root),
  'utf8',
).trim();

const text = `# Third-party notices

JAM Code is released under the MIT License (see \`LICENSE\`). It includes the
third-party material below, each under its own license. This file is generated
by \`scripts/third-party-notices.mjs\`; do not edit it by hand.

## Vendored assets

### Material Icon Theme file icons

\`packages/client/src/components/file-icons/material/\` contains file icons
from Material Icon Theme by Material Extensions, used unmodified.

\`\`\`text
${materialLicense}
\`\`\`

### Geist and Geist Mono

The interface bundles the Geist and Geist Mono typefaces (via
\`@fontsource-variable/geist\` and \`@fontsource-variable/geist-mono\`),
Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font),
licensed under the SIL Open Font License, Version 1.1:
https://openfontlicense.org/open-font-license-official-text/

### Provider marks

The Claude Code and Codex marks shown beside conversations identify those
providers' products. They are trademarks of Anthropic and OpenAI respectively.
JAM Code is an independent project, not affiliated with or endorsed by either.

## Libraries in the interface (npm)

${table(npmPackages())}

## Libraries in the desktop app (Rust)

Crates licensed under the MPL-2.0 are used unmodified; their source is
available from crates.io at the versions listed.

${table(crates())}
`;

const target = new URL('THIRD_PARTY_NOTICES.md', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text) {
    console.error(
      'THIRD_PARTY_NOTICES.md is out of date. Run node scripts/third-party-notices.mjs',
    );
    process.exit(1);
  }
} else {
  writeFileSync(target, text);
}
