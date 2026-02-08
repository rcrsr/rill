/**
 * Editor Component
 *
 * CodeMirror 6 instance with brand neon syntax highlighting.
 * Accepts value/onChange props for controlled content.
 * Accepts errorLine prop to highlight error gutter line.
 * Keyboard shortcut: Cmd/Ctrl+Enter triggers onRun callback.
 * Dark-only brand theme.
 */

import { type JSX, useEffect, useRef } from 'react';
import {
  EditorView,
  keymap,
  lineNumbers,
  Decoration,
  type DecorationSet,
} from '@codemirror/view';
import {
  EditorState,
  type Extension,
  StateField,
  StateEffect,
} from '@codemirror/state';
import { indentUnit, StreamLanguage } from '@codemirror/language';
import { defaultKeymap } from '@codemirror/commands';
import { createThemeExtension } from '../lib/theme.js';
import { createTabKeyBinding } from '../lib/keybindings.js';
import { rillHighlighter } from '../lib/highlight.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Editor component props
 */
export interface EditorProps {
  /** Current editor content */
  value: string;
  /** Callback when content changes */
  onChange: (value: string) => void;
  /** Callback when Cmd/Ctrl+Enter is pressed */
  onRun: () => void;
  /** Line number to highlight for errors (1-based) */
  errorLine?: number | null;
  /** ARIA label for screen readers */
  ariaLabel?: string;
}

// ============================================================
// ERROR LINE DECORATION
// ============================================================

/**
 * State effect for setting error line
 */
const setErrorLineEffect = StateEffect.define<number | null>();

/**
 * State field for error line decorations
 */
const errorLineField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setErrorLineEffect)) {
        decorations = Decoration.none;

        if (effect.value !== null && effect.value > 0) {
          const lineNumber = Math.min(effect.value, tr.state.doc.lines);
          const line = tr.state.doc.line(lineNumber);

          decorations = Decoration.set([
            Decoration.line({
              attributes: { class: 'cm-error-line' },
            }).range(line.from),
          ]);
        }
      }
    }

    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ============================================================
// EDITOR COMPONENT
// ============================================================

export function Editor({
  value,
  onChange,
  onRun,
  errorLine = null,
  ariaLabel = 'Rill code editor',
}: EditorProps): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  // Keep callback refs up to date
  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
  }, [onChange, onRun]);

  // ============================================================
  // INITIALIZATION
  // ============================================================

  useEffect(() => {
    if (!editorRef.current) return;

    const extensions: Extension[] = [
      lineNumbers(),
      indentUnit.of('  '),
      EditorState.tabSize.of(2),
      keymap.of([...createTabKeyBinding(), ...defaultKeymap]),
      // Brand dark theme (always dark)
      createThemeExtension(true),
      StreamLanguage.define(rillHighlighter),
      errorLineField,
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChangeRef.current(newValue);
        }
      }),
      EditorView.baseTheme({
        '&': {
          height: '100%',
          fontSize: '14px',
        },
        '.cm-content': {
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontVariantLigatures: 'normal',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions,
      }),
      parent: editorRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // ============================================================
  // VALUE SYNCHRONIZATION
  // ============================================================

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentValue = view.state.doc.toString();
    if (currentValue !== value) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
    }
  }, [value]);

  // ============================================================
  // ERROR LINE HIGHLIGHTING
  // ============================================================

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: setErrorLineEffect.of(errorLine),
    });

    if (errorLine !== null && errorLine > 0) {
      const lineNumber = Math.min(errorLine, view.state.doc.lines);
      const line = view.state.doc.line(lineNumber);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      });
    }
  }, [errorLine]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div ref={editorRef} aria-label={ariaLabel} className="editor-container" />
  );
}
