import { describe, expect, it } from 'vitest';
import { localUrls } from './local-urls';

describe('localUrls', () => {
  it('finds local servers in command output, once each', () => {
    const vite = 'VITE v7.1.4  ready in 412 ms\n\n  ➜  Local:   http://localhost:5173/\n';
    expect(localUrls([vite, vite])).toEqual(['http://localhost:5173/']);
    expect(localUrls(['Listening on http://0.0.0.0:3000.'])).toEqual(['http://localhost:3000/']);
    expect(localUrls(['see http://127.0.0.1:8000/docs, then'])).toEqual([
      'http://127.0.0.1:8000/docs',
    ]);
  });

  it('ignores other sites', () => {
    expect(localUrls(['https://example.com', 'http://localhost.evil.test'])).toEqual([]);
  });
});
