/**
 * The layer JAM Code's menus are drawn in.
 *
 * A menu drawn inside the surface that opens it inherits that surface's
 * stacking context and, when the surface is filtered (a pane or the sidebar
 * blurring a wallpaper), its coordinate space: it is then painted under the
 * next surface and placed relative to its own pane rather than the window.
 * Menus therefore render into one host outside every surface, at the end of
 * the document, and are positioned against that host's own rectangle.
 *
 * A modal dialog makes everything outside it inert, so a menu opened from
 * inside a dialog gets a host inside that dialog instead.
 */

const HOST_CLASS = 'overlay-host';

export function overlayHostFor(anchor: Element): HTMLElement {
  const parent = anchor.closest('dialog') ?? anchor.ownerDocument.body;
  for (const child of parent.children) {
    if (child instanceof HTMLElement && child.classList.contains(HOST_CLASS)) return child;
  }
  const host = anchor.ownerDocument.createElement('div');
  host.className = HOST_CLASS;
  parent.append(host);
  return host;
}
