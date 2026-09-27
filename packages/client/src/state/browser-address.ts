/**
 * Turns what the reader typed into the address field into a URL to open.
 *
 * Local development is the common case, so `localhost:3000`, `127.0.0.1` and
 * other bare local hosts become `http://`; a bare domain becomes `https://`.
 * Anything that is not an ordinary web page is refused here and again by the
 * host, which is the boundary that actually enforces it.
 */
export type AddressResult = { url: string } | { error: string };

const LOCAL =
  /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0|[\w-]+\.localhost)(:\d+)?(\/|$|\?|#)/i;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const DOMAIN = /^[^\s/:?#]+\.[^\s/:?#]{2,}(:\d+)?(\/|$|\?|#)/;

export function parseAddress(input: string): AddressResult {
  const text = input.trim();
  if (!text) return { error: 'Type an address.' };
  if (text.length > 8192) return { error: 'That address is too long.' };
  let candidate: string;
  if (LOCAL.test(text)) candidate = `http://${text}`;
  else if (/^\d+$/.test(text)) candidate = `http://localhost:${text}`;
  else if (HAS_SCHEME.test(text) && !/^[\w.-]+:\d+/.test(text)) candidate = text;
  else if (DOMAIN.test(text)) candidate = `https://${text}`;
  else return { error: 'Search is not available. Type a web address.' };
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'That is not a web address.' };
  }
  if (url.href === 'about:blank') return { url: url.href };
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname)
    return { error: 'Only http and https pages can open in the browser.' };
  return { url: url.href };
}

/** The address split for display: origin prominent, the rest subdued. */
export function displayAddress(href: string): { origin: string; rest: string; secure: boolean } {
  if (!href || href === 'about:blank') return { origin: '', rest: '', secure: false };
  try {
    const url = new URL(href);
    const origin = url.host;
    const rest = `${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    return { origin, rest, secure: url.protocol === 'https:' || isLocalHost(url.hostname) };
  } catch {
    return { origin: href, rest: '', secure: false };
  }
}

export function isLocalHost(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname === '0.0.0.0' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}
