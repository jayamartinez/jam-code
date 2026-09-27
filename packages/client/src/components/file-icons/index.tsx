import { createContext, useContext, useEffect, useState } from 'react';
import { iconKeyForFile, iconKeyForFolder, type IconKey } from './classify';
import { JAM_GLYPHS } from './jam-glyphs';
import { MATERIAL_ICONS } from './material-icons';
import { IconSlot, type IconDensity, ICON_SLOT } from '../icons';

/**
 * File and folder icons.
 *
 * Consumers only ever say what a path is; they never name a theme or reach for
 * a specific pack. Two themes are available so their designs can be compared
 * in place — both classify paths identically and render into the same fixed
 * box, so only the artwork differs.
 */

export type FileIconTheme = 'mixed' | 'jam' | 'material';
export const FILE_ICON_THEMES: FileIconTheme[] = ['mixed', 'jam', 'material'];
export const FILE_ICON_THEME_LABELS: Record<FileIconTheme, string> = {
  mixed: 'Mixed icons',
  jam: 'JAM icons',
  material: 'Material',
};

/**
 * `mixed` is the default: Material's marks read a language faster than an
 * original set can at 14px, while JAM's own folders keep the tree's structure
 * in JAM's line weight rather than a filled brown folder.
 */
const ThemeContext = createContext<FileIconTheme>('mixed');
const STORAGE_KEY = 'jam.fileIconTheme';

export function FileIconThemeProvider({
  theme,
  children,
}: {
  theme: FileIconTheme;
  children: React.ReactNode;
}) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/**
 * Temporary comparison state. It is deliberately client-only and remembered
 * per browser; it is not part of Settings and not a product preference yet.
 */
export function useFileIconThemeChoice(): [FileIconTheme, (next: FileIconTheme) => void] {
  const [theme, setTheme] = useState<FileIconTheme>('mixed');
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (FILE_ICON_THEMES.includes(stored as FileIconTheme)) setTheme(stored as FileIconTheme);
    } catch {
      // Private windows and blocked storage simply keep the default.
    }
  }, []);
  return [
    theme,
    (next) => {
      setTheme(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Losing the preference is acceptable; the tree still renders.
      }
    },
  ];
}

const isFolder = (iconKey: IconKey) => iconKey === 'folder' || iconKey === 'folder-open';

function Glyph({ iconKey, density }: { iconKey: IconKey; density: IconDensity }) {
  const theme = useContext(ThemeContext);
  const size = Math.round(ICON_SLOT[density] * 0.875);
  const useMaterial = theme === 'material' || (theme === 'mixed' && !isFolder(iconKey));
  if (useMaterial) {
    const source = MATERIAL_ICONS[iconKey];
    return (
      <img
        src={source}
        width={size}
        height={size}
        alt=""
        draggable={false}
        // The pack's own artwork, constrained to JAM's box so it cannot
        // outweigh the rest of the interface.
        style={{ display: 'block', opacity: 0.94 }}
      />
    );
  }
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} focusable="false">
      {JAM_GLYPHS[iconKey]}
    </svg>
  );
}

export function FileIcon({
  path,
  density = 'dense',
  label,
}: {
  path: string;
  density?: IconDensity;
  label?: string;
}) {
  return (
    <IconSlot density={density} label={label} className="file-icon">
      <Glyph iconKey={iconKeyForFile(path)} density={density} />
    </IconSlot>
  );
}

export function FolderIcon({
  expanded = false,
  density = 'dense',
  label,
}: {
  /** Folder name, kept for future per-folder recognition. */
  name?: string;
  expanded?: boolean;
  density?: IconDensity;
  label?: string;
}) {
  return (
    <IconSlot density={density} label={label} className="file-icon">
      <Glyph iconKey={iconKeyForFolder(expanded)} density={density} />
    </IconSlot>
  );
}

export { iconKeyForFile, iconKeyForFolder, type IconKey };
