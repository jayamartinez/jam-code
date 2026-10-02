import { describe, expect, it } from 'vitest';
import { APPEARANCE, type CustomTheme, type CustomThemeColors } from '@jam/protocol';
import { colorsFromDefinition, customThemeDefinition, newCustomThemeId, themeFor } from './custom';
import {
  libraryFamilies,
  libraryOrder,
  preferredVariant,
  searchLibrary,
  specimenColors,
} from './library';
import { contrast } from './color';
import { THEMES } from './themes';

const harbour: CustomTheme = {
  id: 'harbour',
  name: 'Harbour',
  dark: { ...colorsFromDefinition(THEMES.nightglass), canvas: '#0d1a1c', text: '#d2e4e3' },
  light: colorsFromDefinition(THEMES.frost),
};

describe('theme library', () => {
  it('groups every built-in theme once, by family, with light before dark', () => {
    const families = libraryFamilies([]);
    const refs = libraryOrder(families).map((variant) => variant.ref);
    expect([...refs].sort()).toEqual([...APPEARANCE.themes].sort());
    const nightglass = families.find((family) => family.name === 'Nightglass')!;
    expect(nightglass.group).toBe('jam');
    expect(nightglass.variants.map((variant) => variant.ref)).toEqual(['frost', 'nightglass']);
    const github = families.find((family) => family.name === 'GitHub')!;
    expect(github.group).toBe('editor');
    expect(github.variants[0]!.theme.scheme).toBe('light');
    expect(github.variants).toHaveLength(3);
  });

  it("lists the reader's own themes as their own group", () => {
    const families = libraryFamilies([harbour]);
    const yours = families.filter((family) => family.group === 'yours');
    expect(yours).toHaveLength(1);
    expect(yours[0]!.variants.map((variant) => variant.ref)).toEqual([
      'custom:harbour:light',
      'custom:harbour:dark',
    ]);
    expect(preferredVariant(yours[0]!, 'dark').ref).toBe('custom:harbour:dark');
  });

  it('searches names, families and brightness, variant by variant', () => {
    const families = libraryFamilies([harbour]);
    const names = (query: string) =>
      searchLibrary(families, query).map((hit) => hit.variant.theme.name);
    expect(names('git')).toEqual(['GitHub Light', 'GitHub Dark', 'GitHub Dark Dimmed']);
    expect(names('git dark')).toEqual(['GitHub Dark', 'GitHub Dark Dimmed']);
    expect(names('harbour light')).toEqual(['Harbour']);
    expect(names('  ')).toEqual([]);
    expect(names('no such theme')).toEqual([]);
    expect(searchLibrary(families, 'hub')[0]!.highlight).toEqual([3, 6]);
    // A family match finds variants whose own names differ.
    expect(names('nightglass')).toContain('Frost');
  });

  it("draws specimens from the theme's own roles", () => {
    for (const theme of Object.values(THEMES)) {
      const colors = specimenColors(theme);
      expect(colors.canvas).toBe(theme.surfaces.pane[0]);
      expect(colors.keyword).toBe(theme.syntax.keyword);
      expect(colors.accent).toBe(theme.accent);
    }
  });
});

describe('custom themes', () => {
  it('are drawn by the editor-theme builder, so contrast floors hold', () => {
    const faint: CustomThemeColors = {
      ...colorsFromDefinition(THEMES.nightglass),
      canvas: '#101010',
      comment: '#1a1a1a',
      keyword: '#141414',
    };
    const theme = customThemeDefinition({ id: 'faint', name: 'Faint', dark: faint }, 'dark')!;
    expect(theme.id).toBe('custom:faint:dark');
    expect(contrast(theme.syntax.keyword, '#101010')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.syntax.comment, '#101010')).toBeGreaterThanOrEqual(3.5);
    expect(customThemeDefinition({ id: 'x', name: 'X', dark: faint }, 'light')).toBeUndefined();
  });

  it('resolve by reference and fall back to Nightglass when missing', () => {
    expect(themeFor('custom:harbour:dark', [harbour]).surfaces.pane[0]).toBe('#0d1a1c');
    expect(themeFor('custom:harbour:dark', []).id).toBe('nightglass');
    expect(themeFor('linen', []).id).toBe('linen');
  });

  it('get unique readable ids', () => {
    expect(newCustomThemeId('Harbour', [])).toBe('harbour');
    expect(newCustomThemeId('Harbour', [harbour])).toBe('harbour-2');
    expect(newCustomThemeId('Één — Nacht!', [])).toBe('een-nacht');
    expect(newCustomThemeId('***', [])).toBe('theme');
  });
});
