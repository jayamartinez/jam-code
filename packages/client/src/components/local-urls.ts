/**
 * Local servers a command reported, such as Vite's
 * `Local: http://localhost:5173/`. Only addresses on this computer count,
 * matching what the runtime agrees to open in the default browser.
 */
const LOCAL_URL =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d{1,5})?(?![\w@-]|\.[\w-])(?:\/[^\s'"<>`)\]]*)?/gi;

/** Distinct local addresses in `outputs`, first seen first, at most three. */
export function localUrls(outputs: string[]): string[] {
  const seen = new Set<string>();
  for (const output of outputs)
    for (const match of output.slice(0, 200_000).matchAll(LOCAL_URL)) {
      // 0.0.0.0 listens everywhere; the browser reaches it as localhost.
      const url = match[0].replace('0.0.0.0', 'localhost').replace(/[.,;:]+$/, '');
      seen.add(url.endsWith('/') || url.includes('/', url.indexOf('//') + 2) ? url : `${url}/`);
      if (seen.size === 3) return [...seen];
    }
  return [...seen];
}
