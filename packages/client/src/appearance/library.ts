import { APPEARANCE, customThemeRef, type CustomTheme, type ThemeRef } from '@jam/protocol';
import { customThemeDefinition } from './custom';
import { JAM_THEMES, THEMES, type ThemeDefinition } from './themes';

/**
 * The theme library as data: families grouped into JAM, Yours and Editor
 * themes, the search over them, and the colours a specimen card draws. All
 * pure, so Settings renders what these return and tests read the same thing.
 */

export type LibraryGroup = 'jam' | 'yours' | 'editor';

export const LIBRARY_GROUPS: { id: LibraryGroup; label: string }[] = [
  { id: 'jam', label: 'JAM' },
  { id: 'yours', label: 'Yours' },
  { id: 'editor', label: 'Editor themes' },
];

export interface LibraryVariant {
  ref: ThemeRef;
  theme: ThemeDefinition;
}

export interface LibraryFamily {
  key: string;
  name: string;
  group: LibraryGroup;
  /** Light variants first, then dark, in the order the themes are listed. */
  variants: LibraryVariant[];
  /** Set for the reader's own themes. */
  customId?: string;
}

const byScheme = (a: LibraryVariant, b: LibraryVariant) =>
  a.theme.scheme === b.theme.scheme ? 0 : a.theme.scheme === 'light' ? -1 : 1;

export function libraryFamilies(customThemes: readonly CustomTheme[]): LibraryFamily[] {
  const builtIn = new Map<string, LibraryFamily>();
  for (const id of APPEARANCE.themes) {
    const theme = THEMES[id];
    const group: LibraryGroup = JAM_THEMES.includes(id) ? 'jam' : 'editor';
    const key = `${group}:${theme.family}`;
    const family = builtIn.get(key) ?? { key, name: theme.family, group, variants: [] };
    family.variants.push({ ref: id, theme });
    builtIn.set(key, family);
  }
  const yours: LibraryFamily[] = customThemes.map((custom) => ({
    key: `yours:${custom.id}`,
    name: custom.name,
    group: 'yours',
    customId: custom.id,
    variants: (['light', 'dark'] as const).flatMap((scheme) => {
      const theme = customThemeDefinition(custom, scheme);
      return theme ? [{ ref: customThemeRef(custom.id, scheme), theme }] : [];
    }),
  }));
  const families = [...builtIn.values(), ...yours];
  for (const family of families) family.variants.sort(byScheme);
  return families;
}

/** Every variant in library order, for stepping through themes one at a time. */
export function libraryOrder(families: readonly LibraryFamily[]): LibraryVariant[] {
  return LIBRARY_GROUPS.flatMap(({ id }) =>
    families.filter((family) => family.group === id).flatMap((family) => family.variants),
  );
}

export interface SearchHit {
  family: LibraryFamily;
  variant: LibraryVariant;
  /** The matched range in the variant's name, for highlighting, if the name matched. */
  highlight?: [number, number];
}

/**
 * Words in the query must each match the variant's name, its family's name,
 * or its brightness ("light", "dark"). While searching, variants are listed
 * one by one so "git dark" finds exactly the dark GitHub themes.
 */
export function searchLibrary(families: readonly LibraryFamily[], query: string): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const { id } of LIBRARY_GROUPS)
    for (const family of families.filter((item) => item.group === id))
      for (const variant of family.variants) {
        const name = variant.theme.name.toLowerCase();
        const familyName = family.name.toLowerCase();
        let highlight: [number, number] | undefined;
        const matches = words.every((word) => {
          if (variant.theme.scheme.startsWith(word)) return true;
          const at = name.indexOf(word);
          if (at >= 0) {
            highlight ??= [at, at + word.length];
            return true;
          }
          return familyName.includes(word);
        });
        if (matches) hits.push({ family, variant, ...(highlight ? { highlight } : {}) });
      }
  return hits;
}

export interface SpecimenColours {
  canvas: string;
  sidebar: string;
  rule: string;
  bar: string;
  text: string;
  muted: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  punctuation: string;
  comment: string;
  accent: string;
}

/** What a specimen card draws for one variant: the theme's own roles, never approximations. */
export function specimenColours(theme: ThemeDefinition): SpecimenColours {
  return {
    canvas: theme.surfaces.pane[0],
    sidebar: theme.surfaces.sidebar[0],
    rule: `color-mix(in srgb, ${theme.tint} ${theme.scheme === 'dark' ? 8 : 10}%, transparent)`,
    bar: `color-mix(in srgb, ${theme.tint} 14%, transparent)`,
    text: theme.text.primary,
    muted: theme.text.muted,
    keyword: theme.syntax.keyword,
    string: theme.syntax.string,
    number: theme.syntax.number,
    function: theme.syntax.function,
    punctuation: theme.syntax.punctuation,
    comment: theme.syntax.comment,
    accent: theme.accent,
  };
}

/** The variant a family shows when picked as a whole: the current brightness if it has one. */
export function preferredVariant(
  family: LibraryFamily,
  scheme: ThemeDefinition['scheme'],
): LibraryVariant {
  return family.variants.find((variant) => variant.theme.scheme === scheme) ?? family.variants[0]!;
}
