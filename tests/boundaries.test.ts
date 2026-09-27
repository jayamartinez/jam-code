import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') return sources(path);
      return entry.isFile() && /\.tsx?$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

describe('architectural boundaries', () => {
  it('shared packages have no native, Node, provider SDK or desktop imports', async () => {
    const files = await sources(resolve('packages'));
    expect(files.length).toBeGreaterThan(0);
    const forbidden: string[] = [];
    for (const path of files) {
      const source = ts.createSourceFile(
        path,
        await readFile(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const inspect = (node: ts.Node) => {
        const specifier =
          ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
            ? node.moduleSpecifier
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? node.arguments[0]
              : undefined;
        if (
          specifier &&
          ts.isStringLiteral(specifier) &&
          /^(?:@tauri-apps\/|node:|@anthropic-ai\/|@openai\/)|apps[\\/]desktop/.test(specifier.text)
        ) {
          forbidden.push(`${path}: ${specifier.text}`);
        }
        ts.forEachChild(node, inspect);
      };
      inspect(source);
    }
    expect(forbidden).toEqual([]);
  });

  it('the layout tree never names a resource kind', async () => {
    // A leaf holds a view ID. The moment layout code branches on "terminal" or
    // "conversation", panes stop being interchangeable views onto resources.
    const layout = await readFile(resolve('packages/client/src/state/layout.ts'), 'utf8');
    const code = layout.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
    for (const kind of [
      'conversation',
      'terminal',
      'browser',
      'file',
      'file-browser',
      'diff',
      'settings',
    ]) {
      expect(code).not.toContain(`'${kind}'`);
    }
  });

  it('the tile renderer arranges panes without inspecting their contents', async () => {
    const tiles = await readFile(resolve('packages/client/src/components/TileLayout.tsx'), 'utf8');
    // It receives a render callback; it must not import any resource surface.
    expect(tiles).not.toMatch(/from '\.\/(Conversation|File|Demo|Settings|Empty)/);
    expect(tiles).toContain('renderPane');
  });

  it('the runtime remains independent of Tauri and React', async () => {
    const manifest = await readFile(resolve('crates/runtime/Cargo.toml'), 'utf8');
    expect(manifest).not.toMatch(/^\s*(tauri|react)\s*=/m);
  });
});
