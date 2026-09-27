import { describe, expect, it } from 'vitest';
import { iconKeyForFile, iconKeyForFolder } from './classify';

describe('file icon classification', () => {
  it('recognises the types the tree needs to distinguish', () => {
    expect(iconKeyForFile('src/app.ts')).toBe('typescript');
    expect(iconKeyForFile('src/App.tsx')).toBe('tsx');
    expect(iconKeyForFile('a/b.js')).toBe('javascript');
    expect(iconKeyForFile('a/b.jsx')).toBe('jsx');
    expect(iconKeyForFile('src/main.rs')).toBe('rust');
    expect(iconKeyForFile('run.py')).toBe('python');
    expect(iconKeyForFile('tsconfig.json')).toBe('json');
    expect(iconKeyForFile('README.md')).toBe('markdown');
    expect(iconKeyForFile('styles/tokens.css')).toBe('css');
    expect(iconKeyForFile('index.html')).toBe('html');
    expect(iconKeyForFile('ci.yml')).toBe('yaml');
    expect(iconKeyForFile('setup.sh')).toBe('shell');
    expect(iconKeyForFile('logo.svg')).toBe('image');
  });

  it('prefers a whole filename over its extension', () => {
    expect(iconKeyForFile('package.json')).toBe('manifest');
    // A Rust manifest must not borrow the Node package mark.
    expect(iconKeyForFile('Cargo.toml')).toBe('rust');
    expect(iconKeyForFile('pyproject.toml')).toBe('python');
    expect(iconKeyForFile('pnpm-lock.yaml')).toBe('lockfile');
    expect(iconKeyForFile('Cargo.lock')).toBe('lockfile');
    expect(iconKeyForFile('.gitignore')).toBe('git');
    expect(iconKeyForFile('.editorconfig')).toBe('config');
  });

  it('falls back quietly and handles compound and dotless names', () => {
    // A compound suffix still resolves by its final extension.
    expect(iconKeyForFile('src/registry.test.ts')).toBe('typescript');
    expect(iconKeyForFile('LICENSE')).toBe('file');
    expect(iconKeyForFile('weird.qqq')).toBe('file');
    expect(iconKeyForFolder(false)).toBe('folder');
    expect(iconKeyForFolder(true)).toBe('folder-open');
  });
});
