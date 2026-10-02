// Which port a checkout's isolated copy (`pnpm desktop:isolated`) serves its
// interface on. Each checkout gets a port of its own, derived from its path,
// so the port is the same on every run and differs between worktrees. When
// something else already has it, the next free one in the range is used.

import { Buffer } from 'node:buffer';

/** The range isolated copies use: clear of 1420, which `pnpm desktop` owns. */
export const FIRST_PORT = 14200;
export const PORT_COUNT = 3000;

/** One spelling per folder: Windows paths name the same folder in either case. */
function samePath(checkoutPath, platform) {
  const plain = checkoutPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return platform === 'win32' ? plain.toLowerCase() : plain;
}

/** The checkout's own port: FNV-1a of its path, folded into the range. */
export function preferredPort(checkoutPath, platform = process.platform) {
  let hash = 0x811c9dc5;
  for (const unit of Buffer.from(samePath(checkoutPath, platform), 'utf8')) {
    hash = Math.imul(hash ^ unit, 0x01000193);
  }
  return FIRST_PORT + ((hash >>> 0) % PORT_COUNT);
}

/**
 * The checkout's own port when `isFree` says it is free, else the next free
 * one, wrapping around the range once.
 */
export async function choosePort(checkoutPath, isFree, platform = process.platform) {
  const first = preferredPort(checkoutPath, platform) - FIRST_PORT;
  for (let step = 0; step < PORT_COUNT; step++) {
    const port = FIRST_PORT + ((first + step) % PORT_COUNT);
    if (await isFree(port)) return port;
  }
  throw new Error(
    `No free port from ${FIRST_PORT} to ${FIRST_PORT + PORT_COUNT - 1} for the isolated copy.`,
  );
}
