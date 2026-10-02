import { describe, expect, it } from 'vitest';
import { fileReference, lineFromHash } from './file-refs';

describe('fileReference', () => {
  it('recognizes project files with an optional line', () => {
    expect(fileReference('src/math.ts')).toEqual({ path: 'src/math.ts' });
    expect(fileReference('math.test.ts:18')).toEqual({ path: 'math.test.ts', line: 18 });
    expect(fileReference('./crates/runtime/src/turns.rs:210:4')).toEqual({
      path: 'crates/runtime/src/turns.rs',
      line: 210,
    });
    expect(fileReference('docs/PROVIDERS.md#L12')).toEqual({
      path: 'docs/PROVIDERS.md',
      line: 12,
    });
    expect(fileReference('Dockerfile')).toEqual({ path: 'Dockerfile' });
    expect(fileReference('math.ts:0')).toEqual({ path: 'math.ts' });
  });

  it('leaves code that only looks like a path alone', () => {
    for (const code of [
      'pty.kill',
      'a / b',
      'a/b',
      'v1.2.3',
      'divide(a, b)',
      'new Error("Division by zero")',
      'https://example.com/a.ts',
      '/etc/passwd.conf',
      '../outside.ts',
      'src/',
    ])
      expect(fileReference(code), code).toBeNull();
  });

  it('reads a line fragment', () => {
    expect(lineFromHash('L42')).toBe(42);
    expect(lineFromHash('heading')).toBeUndefined();
    expect(lineFromHash(undefined)).toBeUndefined();
  });
});
