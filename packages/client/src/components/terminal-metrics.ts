/**
 * Terminal geometry from the Files and Tiles frames: Geist Mono at 12px on a
 * 19px line, inside 10px/14px padding under the 42px pane header. Kept apart
 * from the xterm view so a shell can be started at the right size before
 * xterm has loaded.
 */
export const TERMINAL_FONT_SIZE = 12;
export const TERMINAL_LINE_PX = 19;
const PADDING_BLOCK = 10;
const PADDING_INLINE = 14;
const HEADER_PX = 42;
/** xterm reserves this for its scrollbar when fitting. */
const SCROLLBAR_PX = 14;

export function terminalFont(element: Element = document.documentElement) {
  return getComputedStyle(element).getPropertyValue('--font-mono-stack').trim() || 'monospace';
}

/** The rendered width of one monospace character. */
export function measureCell(fontFamily: string) {
  const probe = document.createElement('span');
  probe.textContent = 'W'.repeat(32);
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${fontFamily};font-size:${TERMINAL_FONT_SIZE}px;line-height:normal`;
  document.body.append(probe);
  const box = probe.getBoundingClientRect();
  probe.remove();
  return { width: box.width / 32, height: box.height };
}

/**
 * The cells a terminal pane in `element` will fit, rounded down by a column.
 * Starting a shell at its real size matters: zsh pads its prompt to the
 * width it was given, and a wider start leaves a stray line in a narrower view.
 */
export function estimateTerminalSize(element: Element | null) {
  if (!element) return undefined;
  const box = element.getBoundingClientRect();
  const { width } = measureCell(terminalFont(element));
  if (!box.width || !box.height || !width) return undefined;
  const cols = Math.floor((box.width - 2 - PADDING_INLINE * 2 - SCROLLBAR_PX) / width) - 1;
  const rows = Math.floor((box.height - 2 - HEADER_PX - PADDING_BLOCK * 2) / TERMINAL_LINE_PX);
  return cols >= 2 && rows >= 1
    ? { cols: Math.min(cols, 1000), rows: Math.min(rows, 500) }
    : undefined;
}
