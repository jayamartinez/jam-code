import { describe, expect, it } from 'vitest';
import { MENU_INSET, placeMenu, type Box } from './menu-placement';

const viewport: Box = { left: 0, top: 0, right: 1440, bottom: 900 };
const trigger = (left: number, top: number, width = 120, height = 28): Box => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('placing an anchored menu', () => {
  it('opens at its trigger’s left edge in the window', () => {
    const placed = placeMenu({ trigger: trigger(550, 472), layer: viewport, menuWidth: 300 });
    expect(placed.left).toBe(550);
  });

  it('stays on its trigger when the layer is not the window', () => {
    // A layer inside a filtered surface starts where that surface does. The
    // regression put the menu a sidebar's width to the right: 550 became 830.
    const layer: Box = { left: 280, top: 44, right: 1432, bottom: 892 };
    const placed = placeMenu({
      trigger: trigger(550, 472),
      layer,
      menuWidth: 300,
      compact: true,
    });
    expect(layer.left + placed.left).toBe(550);
    expect(layer.top + placed.top!).toBe(472 + 28 + 6);
  });

  it('opens upward from a composer pill and stays attached by its bottom edge', () => {
    const placed = placeMenu({ trigger: trigger(400, 800), layer: viewport, menuWidth: 300 });
    expect(placed.top).toBeUndefined();
    // The menu's bottom edge sits 8px above the trigger's top.
    expect(viewport.bottom - placed.bottom!).toBe(800 - MENU_INSET);
    expect(placed.maxHeight).toBe(800 - 2 * MENU_INSET);
  });

  it('opens a compact menu downward while there is room', () => {
    const placed = placeMenu({
      trigger: trigger(100, 300),
      layer: viewport,
      menuWidth: 200,
      compact: true,
    });
    expect(placed.top).toBe(300 + 28 + 6);
    expect(placed.bottom).toBeUndefined();
    expect(placed.maxHeight).toBe(900 - 328 - 2 * MENU_INSET);
  });

  it('flips a compact menu upward near the bottom of the window', () => {
    const placed = placeMenu({
      trigger: trigger(100, 820),
      layer: viewport,
      menuWidth: 200,
      compact: true,
    });
    expect(placed.top).toBeUndefined();
    expect(placed.bottom).toBe(900 - 820 + MENU_INSET);
  });

  it('keeps going down in a short window that has more room below than above', () => {
    const short: Box = { left: 0, top: 0, right: 960, bottom: 260 };
    const placed = placeMenu({
      trigger: trigger(40, 60),
      layer: short,
      menuWidth: 200,
      compact: true,
    });
    expect(placed.top).toBe(60 + 28 + 6);
  });

  it('moves in from the window’s right edge by no more than it must', () => {
    const placed = placeMenu({ trigger: trigger(1300, 400), layer: viewport, menuWidth: 300 });
    expect(placed.left).toBe(1440 - MENU_INSET - 300);
  });

  it('never leaves the left edge of a window narrower than the menu', () => {
    const narrow: Box = { left: 0, top: 0, right: 280, bottom: 640 };
    const placed = placeMenu({ trigger: trigger(120, 300), layer: narrow, menuWidth: 300 });
    expect(placed.left).toBe(MENU_INSET);
  });

  it('never offers a negative height', () => {
    const placed = placeMenu({ trigger: trigger(10, 4), layer: viewport, menuWidth: 100 });
    expect(placed.maxHeight).toBe(0);
  });
});
