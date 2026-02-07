/**
 * Editor Component
 *
 * CodeMirror 6 instance with line numbers and Rill syntax highlighting.
 * Accepts value/onChange props for controlled content.
 * Accepts errorLine prop to highlight error gutter line.
 * Keyboard shortcut: Cmd/Ctrl+Enter triggers onRun callback.
 * ARIA labels for screen reader support.
 * Dark/light theme switching via prop.
 */

import { type JSX, useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, Decoration, type DecorationSet } from '@codemirror/view';
import { EditorState, type Extension, StateField, StateEffect } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Theme variant for editor styling
 */
export type EditorTheme = 'light' | 'dark';

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
  /** Theme variant */
  theme?: EditorTheme;
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

/**
 * Editor component with CodeMirror 6 integration
 *
 * Features:
 * - Line numbers
 * - Rill syntax highlighting (using JavaScript mode as base)
 * - Error line gutter highlighting
 * - Cmd/Ctrl+Enter keyboard shortcut
 * - Dark/light theme switching
 * - Accessibility support
 */
export function Editor({
  value,
  onChange,
  onRun,
  errorLine = null,
  theme = 'light',
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

    // Create extensions array
    const extensions: Extension[] = [
      // Line numbers
      lineNumbers(),
      // JavaScript syntax highlighting (base for Rill)
      javascript(),
      // Error line decoration field
      errorLineField,
      // Keyboard shortcut: Cmd/Ctrl+Enter
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ]),
      // Update callback
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const newValue = update.state.doc.toString();
          onChangeRef.current(newValue);
        }
      }),
      // Base theme
      EditorView.baseTheme({
        '&': {
          height: '100%',
          fontSize: '14px',
        },
        '.cm-content': {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
        '.cm-error-line': {
          backgroundColor: theme === 'light' ? '#fee2e2' : '#7f1d1d',
        },
      }),
    ];

    // Initialize EditorView
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions,
      }),
      parent: editorRef.current,
    });

    viewRef.current = view;

    // Cleanup
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [theme]); // Recreate on theme change

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

    // Dispatch error line effect
    view.dispatch({
      effects: setErrorLineEffect.of(errorLine),
    });

    // Scroll to error line if set
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
    <div
      ref={editorRef}
      aria-label={ariaLabel}
      className="editor-container"
      style={{
        height: '100%',
        width: '100%',
      }}
    />
  );
}
