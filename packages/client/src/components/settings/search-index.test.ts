import { describe, expect, it } from 'vitest';
import { SETTINGS_INDEX, searchSettings } from './search-index';

const sources = import.meta.glob<string>(['./pages/*Page.tsx', '../AppearanceSettings.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const source = (page: string) =>
  Object.entries(sources)
    .filter(([path]) =>
      page === 'Appearance' ? path.endsWith('AppearanceSettings.tsx') : path.includes(`/${page}`),
    )
    .map(([, text]) => text)
    .join('\n');

describe('settings search', () => {
  it('names only rows the pages really show', () => {
    const missing = SETTINGS_INDEX.filter(
      (entry) => entry.page !== 'Keybindings' && !source(entry.page).includes(`"${entry.title}"`),
    );
    expect(missing).toEqual([]);
  });

  it('finds a row by its title or another word for it', () => {
    expect(searchSettings('badge')[0]).toMatchObject({
      page: 'Notifications',
      title: 'Show a badge',
    });
    expect(searchSettings('wallpaper').map((entry) => entry.title)).toContain('Background');
    expect(searchSettings('')).toEqual([]);
  });
});
