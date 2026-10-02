// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitBranches } from '@jam/protocol';
import { nativeViewsOccluded } from '../state/native-occlusion';
import { ChoicePill } from './ChoicePill';
import { MenuSelect } from './MenuSelect';
import { WorkspaceTarget } from './NewChatTarget';

/**
 * The shared anchored menu, in a DOM. Layout is not computed here, so every
 * rectangle is supplied: the window, the trigger and the menu's width.
 */

const WINDOW = { width: 1440, height: 900 };
const rects = new Map<string, Partial<DOMRect>>();
const rect = (box: Partial<DOMRect>): DOMRect =>
  ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...box }) as DOMRect;

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rects.clear();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.classList.contains('overlay-host'))
      return rect({ right: WINDOW.width, bottom: WINDOW.height, ...WINDOW });
    if (this.getAttribute('role') === 'menu') return rect({ width: 300, height: 200 });
    const label = this.getAttribute('aria-label') ?? '';
    for (const [prefix, box] of rects) if (label.startsWith(prefix)) return rect(box);
    return rect({});
  });
  // Stands in for a pane or the sidebar, which the menu must not render in.
  container = document.createElement('div');
  container.className = 'pane';
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const render = (element: ReactElement) => act(() => root.render(element));
const trigger = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="menu"]')].find((button) =>
    button.getAttribute('aria-label')?.startsWith(label),
  )!;
const menu = () => document.querySelector<HTMLElement>('[role="menu"]');
const click = (element: Element) =>
  act(() => {
    // A real press: the pointer goes down, then the click follows.
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    (element as HTMLElement).click();
  });
const key = (element: Element, name: string) =>
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }),
    );
  });

const access = (onChange = vi.fn()) =>
  createElement(ChoicePill, {
    label: 'Access',
    className: 'access-pill',
    value: 'edits',
    values: [
      { value: 'ask', label: 'Ask for approval' },
      { value: 'edits', label: 'Auto-accept edits' },
      { value: 'full', label: 'Full access' },
    ],
    onChange,
    compact: true,
  });

describe('anchored menus', () => {
  it('renders in the overlay host, outside the surface that opened it', () => {
    rects.set('Access', { left: 550, top: 472, right: 670, bottom: 500 });
    render(access());
    expect(menu()).toBeNull();
    click(trigger('Access'));
    const host = menu()!.parentElement!;
    expect(host.className).toBe('overlay-host');
    expect(host.parentElement).toBe(document.body);
    expect(container.contains(menu())).toBe(false);
    expect(trigger('Access').getAttribute('aria-expanded')).toBe('true');
  });

  it('is placed from its trigger’s rectangle in the window', () => {
    rects.set('Access', { left: 550, top: 472, right: 670, bottom: 500 });
    render(access());
    click(trigger('Access'));
    // Beside its pill at 550, not a pane's width to the right of it.
    expect(menu()!.style.left).toBe('550px');
    expect(menu()!.style.top).toBe('506px');
  });

  it('moves in from the right edge of the window', () => {
    rects.set('Access', { left: 1300, top: 472, right: 1420, bottom: 500 });
    render(access());
    click(trigger('Access'));
    expect(menu()!.style.left).toBe(`${WINDOW.width - 8 - 300}px`);
  });

  it('opens upward when it is not compact, anchored by its bottom edge', () => {
    rects.set('Effort', { left: 400, top: 800, right: 480, bottom: 828 });
    render(
      createElement(ChoicePill, {
        label: 'Effort',
        className: 'composer-pill',
        value: 'high',
        values: [
          { value: 'low', label: 'Low' },
          { value: 'high', label: 'High' },
        ],
        onChange: vi.fn(),
      }),
    );
    click(trigger('Effort'));
    expect(menu()!.style.top).toBe('');
    expect(menu()!.style.bottom).toBe(`${WINDOW.height - 800 + 8}px`);
  });

  it('focuses the chosen item, and a choice made in the portaled menu is not an outside press', () => {
    const onChange = vi.fn();
    render(access(onChange));
    click(trigger('Access'));
    expect(document.activeElement?.textContent).toContain('Auto-accept edits');
    const full = [...menu()!.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Full access'),
    )!;
    click(full);
    expect(onChange).toHaveBeenCalledWith('full');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger('Access'));
  });

  it('closes on a press outside, and its own trigger toggles it', () => {
    render(access());
    click(trigger('Access'));
    expect(menu()).not.toBeNull();
    // The trigger's own press is not "outside": one click closes, not reopens.
    click(trigger('Access'));
    expect(menu()).toBeNull();
    click(trigger('Access'));
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(menu()).toBeNull();
  });

  it('Escape closes it and returns focus to the trigger', () => {
    render(access());
    click(trigger('Access'));
    key(document.activeElement!, 'Escape');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger('Access'));
  });

  it('arrow, Home and End keys move between items', () => {
    render(access());
    click(trigger('Access'));
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Full access');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Ask for approval');
    key(document.activeElement!, 'End');
    expect(document.activeElement?.textContent).toContain('Full access');
    key(document.activeElement!, 'Home');
    expect(document.activeElement?.textContent).toContain('Ask for approval');
  });

  it('Tab closes it and leaves focus on the trigger to move on from', () => {
    render(access());
    click(trigger('Access'));
    key(document.activeElement!, 'Tab');
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger('Access'));
  });

  it('closes when the window is resized or a list holding its trigger scrolls', () => {
    render(access());
    click(trigger('Access'));
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(menu()).toBeNull();

    click(trigger('Access'));
    // A list beside the trigger (a transcript) scrolling is not its concern.
    const beside = document.createElement('div');
    document.body.append(beside);
    act(() => {
      beside.dispatchEvent(new Event('scroll'));
    });
    expect(menu()).not.toBeNull();
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    expect(menu()).toBeNull();
  });

  it('opening another menu closes the first', () => {
    render(
      createElement(
        'div',
        null,
        createElement(MenuSelect, {
          label: 'Filter history by project',
          value: '',
          options: [{ value: '', label: 'Any project' }],
          onChange: vi.fn(),
        }),
        createElement(MenuSelect, {
          label: 'Filter history by provider',
          value: '',
          options: [
            { value: '', label: 'Any provider' },
            { value: 'claude', label: 'Claude Code' },
          ],
          onChange: vi.fn(),
        }),
      ),
    );
    click(trigger('Filter history by project'));
    click(trigger('Filter history by provider'));
    const menus = document.querySelectorAll('[role="menu"]');
    expect(menus).toHaveLength(1);
    expect(menus[0]!.getAttribute('aria-label')).toBe('Filter history by provider');
    expect(menus[0]!.className).toContain('select-menu');
  });

  it('hides native Browser pages only while it is open', () => {
    render(access());
    expect(nativeViewsOccluded()).toBe(false);
    click(trigger('Access'));
    expect(nativeViewsOccluded()).toBe(true);
    key(document.activeElement!, 'Escape');
    expect(nativeViewsOccluded()).toBe(false);
  });

  it('opened from a dialog, renders inside that dialog', () => {
    act(() => root.unmount());
    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    root = createRoot(dialog);
    render(access());
    click(trigger('Access'));
    // A modal dialog makes the rest of the document inert.
    expect(menu()!.parentElement!.className).toBe('overlay-host');
    expect(menu()!.parentElement!.parentElement).toBe(dialog);
  });
});

describe('the branch menu', () => {
  const branches: GitBranches = {
    projectId: 'project-jam',
    state: 'repository',
    current: 'main',
    detached: false,
    changed: 0,
    busy: false,
    truncated: false,
    branches: [
      { name: 'main', remote: false, current: true },
      { name: 'feat/panes', remote: false, current: false },
    ],
  };

  it('puts focus in its search field and filters as you type', () => {
    rects.set('Branch', { left: 620, top: 430, right: 700, bottom: 452 });
    render(
      createElement(WorkspaceTarget, {
        workspace: { kind: 'checkout' },
        branches,
        onChange: vi.fn(),
        onRefresh: vi.fn(),
      }),
    );
    click(trigger('Branch'));
    const search = menu()!.querySelector('input')!;
    expect(document.activeElement).toBe(search);
    expect(menu()!.parentElement!.className).toBe('overlay-host');
    expect(menu()!.style.left).toBe('620px');
    expect(menu()!.textContent).toContain('feat/panes');
  });
});
