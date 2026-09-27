import { describe, expect, it } from 'vitest';
import { displayAddress, parseAddress } from './browser-address';

const url = (input: string) => {
  const result = parseAddress(input);
  return 'url' in result ? result.url : null;
};

describe('browser address parsing', () => {
  it('treats local development hosts as http', () => {
    expect(url('localhost:5173')).toBe('http://localhost:5173/');
    expect(url('localhost:3000/app?x=1')).toBe('http://localhost:3000/app?x=1');
    expect(url('127.0.0.1:8080')).toBe('http://127.0.0.1:8080/');
    expect(url('api.localhost:4000')).toBe('http://api.localhost:4000/');
    expect(url('5173')).toBe('http://localhost:5173/');
  });

  it('treats bare domains as https and keeps explicit schemes', () => {
    expect(url('example.com')).toBe('https://example.com/');
    expect(url('docs.example.com/path#x')).toBe('https://docs.example.com/path#x');
    expect(url('http://example.com')).toBe('http://example.com/');
    expect(url('https://example.com:8443/a')).toBe('https://example.com:8443/a');
    expect(url('about:blank')).toBe('about:blank');
  });

  it('refuses anything that is not an ordinary web page', () => {
    for (const input of [
      '',
      '   ',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'tauri://localhost/',
      'ipc://localhost',
      'about:config',
      'how do I center a div',
    ])
      expect(url(input), input).toBeNull();
    expect(parseAddress('x'.repeat(9000))).toEqual({ error: 'That address is too long.' });
  });

  it('splits an address into a prominent origin and a subdued remainder', () => {
    expect(displayAddress('http://localhost:5173/workspace?restore=1')).toEqual({
      origin: 'localhost:5173',
      rest: '/workspace?restore=1',
      secure: true,
    });
    expect(displayAddress('http://example.com/').secure).toBe(false);
    expect(displayAddress('about:blank').origin).toBe('');
  });
});
