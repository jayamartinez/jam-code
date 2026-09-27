import type { IconKey } from './classify';

import folder from './material/folder.svg';
import typescript from './material/typescript.svg';
import reactTs from './material/react_ts.svg';
import javascript from './material/javascript.svg';
import react from './material/react.svg';
import rust from './material/rust.svg';
import python from './material/python.svg';
import json from './material/json.svg';
import markdown from './material/markdown.svg';
import css from './material/css.svg';
import html from './material/html.svg';
import yaml from './material/yaml.svg';
import console from './material/console.svg';
import image from './material/image.svg';
import git from './material/git.svg';
import nodejs from './material/nodejs.svg';
import lock from './material/lock.svg';
import settings from './material/settings.svg';
import document from './material/document.svg';

/**
 * A curated subset of the Material Icon Theme, vendored under its MIT licence
 * (see `material/LICENSE.md`). Only the types JAM actually distinguishes are
 * included: the full pack is roughly a thousand icons and most of a megabyte.
 *
 * Each entry is a URL, so the browser fetches an icon only when a row that
 * uses it is rendered. The pack has no open-folder variant, so the tree's own
 * chevron carries that state.
 */
export const MATERIAL_ICONS: Record<IconKey, string> = {
  folder,
  'folder-open': folder,
  typescript,
  tsx: reactTs,
  javascript,
  jsx: react,
  rust,
  python,
  json,
  markdown,
  css,
  html,
  yaml,
  shell: console,
  image,
  git,
  manifest: nodejs,
  lockfile: lock,
  config: settings,
  file: document,
};
