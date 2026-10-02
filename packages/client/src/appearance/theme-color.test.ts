import { describe, expect, it } from 'vitest';
import {
  APPEARANCE,
  DEFAULT_APPEARANCE,
  customThemeProblem,
  type CustomTheme,
} from '@jam/protocol';
import { colorsFromDefinition, ownCopyName, themeFor, withThemeColor } from './custom';
import { THEMES } from './themes';

describe('changing a theme color on the Appearance page', () => {
  it('saves a built-in theme as a theme of the reader’s own and selects it', () => {
    const next = withThemeColor(DEFAULT_APPEARANCE, 'canvas', '#424242')!;
    expect(next.customThemes).toHaveLength(1);
    const [copy] = next.customThemes;
    expect(copy!.name).toBe('Nightglass (custom)');
    expect(copy!.name).toBe(ownCopyName(THEMES.nightglass));
    expect(next.theme).toBe(`custom:${copy!.id}:dark`);
    // Everything but the changed color is the built-in's, in the one scheme it was drawn in.
    expect(copy!.dark).toEqual({ ...colorsFromDefinition(THEMES.nightglass), canvas: '#424242' });
    expect(copy!.light).toBeUndefined();
    expect(customThemeProblem(copy)).toBeNull();
    expect(themeFor(next.theme, next.customThemes).surfaces.pane[0]).toBe('#424242');
    // Nightglass is translucent and a theme of the reader's own is opaque: the look is kept.
    expect(next.paneOpacity).toBe(THEMES.nightglass.surfaces.pane[1]);
    expect(next.sidebarOpacity).toBe(THEMES.nightglass.surfaces.sidebar[1]);
    expect(
      withThemeColor({ ...DEFAULT_APPEARANCE, paneOpacity: 40 }, 'canvas', '#424242')!.paneOpacity,
    ).toBe(40);
    // The built-in itself is untouched.
    expect(THEMES.nightglass.surfaces.pane[0]).not.toBe('#424242');
  });

  it('keeps writing into that theme, never a second copy', () => {
    const first = withThemeColor(DEFAULT_APPEARANCE, 'canvas', '#424242')!;
    const second = withThemeColor(first, 'raised', '#4d5150')!;
    expect(second.theme).toBe(first.theme);
    expect(second.customThemes).toHaveLength(1);
    expect(second.customThemes[0]!.dark).toMatchObject({ canvas: '#424242', raised: '#4d5150' });
    // Back on the built-in, the copy that is already there is reused.
    const again = withThemeColor({ ...second, theme: 'nightglass' }, 'sidebar', '#090a0f')!;
    expect(again.customThemes).toHaveLength(1);
    expect(again.theme).toBe(first.theme);
    expect(again.customThemes[0]!.dark).toMatchObject({
      canvas: '#424242',
      raised: '#4d5150',
      sidebar: '#090a0f',
    });
  });

  it('changes one of the reader’s themes in place, in the scheme in use', () => {
    const harbor: CustomTheme = {
      id: 'harbor',
      name: 'Harbor',
      dark: colorsFromDefinition(THEMES.nightglass),
      light: colorsFromDefinition(THEMES.frost),
    };
    const other: CustomTheme = { id: 'other', name: 'Other', dark: harbor.dark! };
    const next = withThemeColor(
      { theme: 'custom:harbor:light', customThemes: [other, harbor] },
      'sidebar',
      '#eeeeee',
    )!;
    expect(next.theme).toBe('custom:harbor:light');
    expect(next.customThemes[0]).toBe(other);
    expect(next.customThemes[1]!.light!.sidebar).toBe('#eeeeee');
    expect(next.customThemes[1]!.dark).toEqual(harbor.dark);
    expect(next).not.toHaveProperty('paneOpacity');
  });

  it('makes a light copy of a light built-in, and refuses when there is no room', () => {
    const light = withThemeColor({ theme: 'frost', customThemes: [] }, 'canvas', '#fafafa')!;
    expect(light.theme).toMatch(/^custom:.+:light$/);
    expect(light.customThemes[0]!.dark).toBeUndefined();
    const many = Array.from({ length: APPEARANCE.limits.customThemes }, (_, index) => ({
      id: `t${index}`,
      name: `T${index}`,
      dark: colorsFromDefinition(THEMES.nightglass),
    }));
    expect(
      withThemeColor({ theme: 'nightglass', customThemes: many }, 'canvas', '#000000'),
    ).toBeNull();
    // One of the reader's own themes can still be changed when the list is full.
    expect(
      withThemeColor({ theme: 'custom:t0:dark', customThemes: many }, 'canvas', '#000000'),
    ).not.toBeNull();
  });
});
