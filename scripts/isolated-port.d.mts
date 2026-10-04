export const FIRST_PORT: number;
export const PORT_COUNT: number;
export function preferredPort(checkoutPath: string, platform?: NodeJS.Platform): number;
export function choosePort(
  checkoutPath: string,
  isFree: (port: number) => boolean | Promise<boolean>,
  platform?: NodeJS.Platform,
): Promise<number>;
