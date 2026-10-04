import { describe, expect, it } from 'vitest';
import { FIRST_PORT, PORT_COUNT, choosePort, preferredPort } from '../scripts/isolated-port.mjs';

const LAST_PORT = FIRST_PORT + PORT_COUNT - 1;

describe('the isolated copy’s port', () => {
  it('is the same for a checkout on every run, and inside the range', () => {
    const port = preferredPort('/work/jam-code', 'linux');
    expect(preferredPort('/work/jam-code', 'linux')).toBe(port);
    expect(port).toBeGreaterThanOrEqual(FIRST_PORT);
    expect(port).toBeLessThanOrEqual(LAST_PORT);
    // 1420 belongs to `pnpm desktop`.
    expect(FIRST_PORT).toBeGreaterThan(1420);
  });

  it('differs between worktrees of one repository', () => {
    const ports = ['a', 'b', 'c', 'd'].map((name) =>
      preferredPort(`/work/jam-code-worktrees/${name}`, 'linux'),
    );
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('names one folder one way: slashes, a trailing separator and Windows case', () => {
    const port = preferredPort('C:\\Work\\Jam-Code\\', 'win32');
    expect(preferredPort('c:/work/jam-code', 'win32')).toBe(port);
    // Elsewhere, case tells folders apart.
    expect(preferredPort('/work/Jam', 'linux')).not.toBe(preferredPort('/work/jam', 'linux'));
  });

  it('takes the next free port when its own is taken, wrapping at the end of the range', async () => {
    const own = preferredPort('/work/jam-code', 'linux');
    expect(await choosePort('/work/jam-code', () => true, 'linux')).toBe(own);
    const next = own === LAST_PORT ? FIRST_PORT : own + 1;
    expect(await choosePort('/work/jam-code', (port) => port !== own, 'linux')).toBe(next);
    // Only the port before its own is free: every other one is tried first.
    const before = own === FIRST_PORT ? LAST_PORT : own - 1;
    expect(await choosePort('/work/jam-code', (port) => port === before, 'linux')).toBe(before);
  });

  it('says so when the whole range is taken', async () => {
    await expect(choosePort('/work/jam-code', () => false, 'linux')).rejects.toThrow(
      /No free port/,
    );
  });
});
