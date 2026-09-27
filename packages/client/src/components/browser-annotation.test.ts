import { describe, expect, it } from 'vitest';
import type { BrowserAnnotation } from '../desktop';
import { describeAnnotation } from './BrowserResource';

const base: BrowserAnnotation = {
  kind: 'element',
  comment: 'Heading should say Workspace',
  selector: 'h1#title',
  label: 'h1#title',
  text: 'Local test page',
  html: '<h1 id="title">Local test page</h1>',
  rect: { x: 20, y: 24, width: 716, height: 38 },
  styles: { color: 'rgb(0, 0, 0)' },
  url: 'http://localhost:5199/',
  title: 'Test',
  console: [{ level: 'error', text: 'Boom', at: 1 }],
  consoleErrors: 1,
};

describe('staged browser annotations', () => {
  it('leads with the reader’s comment and marks page details as untrusted', () => {
    const text = describeAnnotation(base);
    expect(text.split('\n')[0]).toBe('Comment: Heading should say Workspace');
    expect(text).toContain('Element: h1#title');
    expect(text).toContain('Console error: Boom');
    expect(text.trim().endsWith('untrusted.')).toBe(true);
  });

  it('describes a region by its rectangle and what it covers, without a comment', () => {
    const text = describeAnnotation({
      ...base,
      kind: 'region',
      comment: '',
      selector: 'div.card, p',
      html: '',
      styles: {},
      rect: { x: 5, y: 200, width: 436, height: 105 },
    });
    expect(text).not.toContain('Comment:');
    expect(text).toContain('Region: 436 × 105 at 5, 200 covering div.card, p');
    expect(text).not.toContain('Styles:');
    expect(text).not.toContain('HTML:');
  });

  it('stays within the context item selection limit', () => {
    const huge = describeAnnotation({ ...base, text: 'x'.repeat(50_000) });
    expect(huge.length).toBeLessThanOrEqual(20_000);
  });
});
