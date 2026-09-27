import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { jamHighlighter } from '../code/highlight';
import { loadLanguage } from '../code/languages';
import { useAppearance } from '../appearance/store';
import { themeOf } from '../appearance/resolve';

/**
 * The CodeMirror instance.
 *
 * This module is only imported by a File pane that is actually being rendered,
 * so a hidden or merely open file never constructs an editor. Language modes
 * load on demand, one chunk per language. Colours are semantic classes from
 * `jamHighlighter`, coloured by the theme's `--syntax-*` roles in code.css, so
 * a theme change restyles the editor without reconfiguring it.
 */

/** Geometry follows the Paper editor frame: 12px mono on a 20px line. */
const theme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--color-text-body)',
    // `--font-mono` is Paper's family *name*; the loaded face is Geist Mono
    // Variable. Using the name alone fell back to the browser's default
    // serif, so the editor reads the resolved stack instead.
    fontSize: 'var(--editor-font-size, 12px)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--editor-font-family)',
    lineHeight: 'var(--editor-line-height, 20px)',
    paddingBlock: '10px',
    overflow: 'auto',
  },
  // The Files frame: a 48px gutter with numbers right-aligned 14px from a
  // hairline, then the code 8px past it. The hairline belongs to the gutter
  // so numbers and divider can never drift apart.
  '.cm-content': { paddingLeft: '8px' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    borderRight: '1px solid var(--color-border-subtle)',
    color: 'var(--color-text-ghost)',
  },
  '.cm-lineNumbers': { minWidth: '48px' },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 14px 0 0',
    minWidth: '0',
    textAlign: 'right',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--color-text-muted)',
  },
  '.cm-activeLine': { backgroundColor: 'var(--color-fill-subtle)' },
  '.cm-cursor': { borderLeftColor: 'var(--color-accent-strong)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--color-selection)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--color-fill-strong)',
    outline: '1px solid var(--color-border-strong)',
  },
  '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--color-danger)' },
  '&.cm-focused': { outline: 'none' },
});

export interface CodeMirrorEditorProps {
  text: string;
  language: string;
  editable: boolean;
  onChange?(text: string): void;
  /** Cmd+S on macOS, Ctrl+S elsewhere. */
  onSave?(): void;
}

export default function CodeMirrorEditor({
  text,
  language,
  editable,
  onChange,
  onSave,
}: CodeMirrorEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const languageSlot = useRef(new Compartment());
  const schemeSlot = useRef(new Compartment());
  const { appearance } = useAppearance();
  const dark = themeOf(appearance).scheme === 'dark';
  const darkRef = useRef(dark);
  darkRef.current = dark;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      history(),
      bracketMatching(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      syntaxHighlighting(jamHighlighter),
      // Light or dark only changes CodeMirror's own defaults (e.g. the
      // search panel); every colour JAM draws comes from the theme's roles.
      schemeSlot.current.of(EditorView.darkTheme.of(darkRef.current)),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current?.();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      theme,
      // No soft wrap: code keeps its lines and scrolls sideways, as editors do.
      languageSlot.current.of([]),
      EditorView.editable.of(editable),
      EditorState.readOnly.of(!editable),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
      }),
    ];
    const instance = new EditorView({
      state: EditorState.create({ doc: text, extensions }),
      parent: host.current,
    });
    view.current = instance;
    return () => {
      instance.destroy();
      view.current = null;
    };
    // The document is replaced through a transaction below, not by remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  useEffect(() => {
    const instance = view.current;
    if (!instance || instance.state.doc.toString() === text) return;
    instance.dispatch({
      changes: { from: 0, to: instance.state.doc.length, insert: text },
    });
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    void loadLanguage(language).then((support) => {
      if (cancelled || !view.current) return;
      view.current.dispatch({
        effects: languageSlot.current.reconfigure(support ? [support] : []),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({
      effects: schemeSlot.current.reconfigure(EditorView.darkTheme.of(dark)),
    });
  }, [dark]);

  return <div className="code-editor" ref={host} />;
}
