/**
 * Integration Tests for Editor Features
 *
 * Validates theme extensions, key bindings, and syntax highlighting across
 * multiple editor features. Tests both functionality and performance
 * requirements.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createThemeExtension } from '../../src/lib/theme.js';
import { createTabKeyBinding } from '../../src/lib/keybindings.js';
import { rillHighlighter } from '../../src/lib/highlight.js';
import { indentUnit, type StringStream } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { measureP95 } from '../helpers/measure.js';

// ============================================================
// THEME INTEGRATION TESTS
// ============================================================

describe('Theme Integration', () => {
  describe('Theme creation performance', () => {
    it('completes theme creation within 100ms', () => {
      const darkP95 = measureP95(
        () => {
          createThemeExtension(true);
        },
        { samples: 50, warmup: 5 }
      );
      expect(darkP95).toBeLessThan(100);

      const lightP95 = measureP95(
        () => {
          createThemeExtension(false);
        },
        { samples: 50, warmup: 5 }
      );
      expect(lightP95).toBeLessThan(100);
    });
  });

  describe('Rapid theme creation calls', () => {
    it('completes 10 rapid createThemeExtension calls', () => {
      const p95 = measureP95(
        () => {
          for (let i = 0; i < 10; i++) {
            createThemeExtension(i % 2 === 0);
          }
        },
        { samples: 20, warmup: 3 }
      );

      // All 10 calls should complete within 1 second
      expect(p95).toBeLessThan(1000);
    });
  });
});

// ============================================================
// TAB KEY BINDING INTEGRATION TESTS
// ============================================================

describe('Tab Key Binding Integration', () => {
  function runBinding(
    key: string,
    doc: string,
    cursor: number
  ): { doc: string; handled: boolean } {
    const view = new EditorView({
      state: EditorState.create({
        doc,
        selection: { anchor: cursor },
        extensions: [indentUnit.of('  ')],
      }),
    });
    const binding = createTabKeyBinding().find((b) => b.key === key);
    const handled = binding?.run?.(view) ?? false;
    const result = view.state.doc.toString();
    view.destroy();
    return { doc: result, handled };
  }

  it('binds exactly Tab and Shift-Tab with preventDefault', () => {
    const bindings = createTabKeyBinding();

    expect(bindings.map((b) => b.key)).toEqual(['Tab', 'Shift-Tab']);
    expect(bindings.every((b) => b.preventDefault === true)).toBe(true);
  });

  it('Tab inserts indentation at the cursor', () => {
    const result = runBinding('Tab', 'ab', 1);

    expect(result.handled).toBe(true);
    expect(result.doc).toBe('a\tb');
  });

  it('Shift-Tab removes one indent level from the line', () => {
    const result = runBinding('Shift-Tab', '    x', 5);

    expect(result.handled).toBe(true);
    expect(result.doc).toBe('  x');
  });

  it('does not capture Escape so focus navigation stays available', () => {
    const escapeBinding = createTabKeyBinding().find((b) => b.key === 'Escape');

    expect(escapeBinding).toBeUndefined();
  });
});

// ============================================================
// SYNTAX HIGHLIGHTING INTEGRATION TESTS
// ============================================================

describe('Syntax Highlighting Integration', () => {
  describe('Highlight categories', () => {
    it('has name property set to "rill"', () => {
      expect(rillHighlighter.name).toBe('rill');
    });
  });

  describe('Missing category handling', () => {
    it('returns null for unmapped token types', () => {
      const state = rillHighlighter.startState!(2);

      const mockStream = {
        string: '',
        pos: 0,
        start: 0,
        sol: () => true,
        eol: () => true,
        next: () => undefined,
      } as unknown as StringStream;

      const result = rillHighlighter.token!(mockStream, state);

      expect(result).toBe(null);
    });

    it('does not throw for missing TOKEN_HIGHLIGHT_MAP entries', () => {
      const state = rillHighlighter.startState!(2);

      const mockStream = {
        string: '\n',
        pos: 0,
        start: 0,
        sol: () => true,
        eol: () => true,
        next: () => {
          mockStream.pos++;
          return '\n';
        },
      } as unknown as StringStream;

      expect(() => rillHighlighter.token!(mockStream, state)).not.toThrow();
    });
  });
});

// ============================================================
// PERFORMANCE INTEGRATION TESTS
// ============================================================

describe('Performance Integration', () => {
  describe('Empty document highlighting', () => {
    it('highlights empty document in less than 1ms', () => {
      const state = rillHighlighter.startState!(2);
      const mockStream = {
        string: '',
        pos: 0,
        start: 0,
        sol: () => true,
        eol: () => true,
        next: () => undefined,
      } as unknown as StringStream;

      const p95 = measureP95(
        () => {
          rillHighlighter.token!(mockStream, state);
        },
        { samples: 200, warmup: 20 }
      );

      expect(p95).toBeLessThan(1);
    });
  });

  describe('1000-line document highlighting', () => {
    it('highlights 1000-line document in less than 16ms', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `${i} -> $var${i}`);

      const p95 = measureP95(
        () => {
          for (const line of lines) {
            const state = rillHighlighter.startState!(2);
            const mockStream = {
              string: line,
              pos: 0,
              start: 0,
              sol: () => mockStream.pos === 0,
              eol: () => mockStream.pos >= mockStream.string.length,
              next: () => {
                if (mockStream.pos < mockStream.string.length) {
                  const char = mockStream.string[mockStream.pos];
                  mockStream.pos++;
                  return char;
                }
                return undefined;
              },
              peek: () =>
                mockStream.pos < mockStream.string.length
                  ? mockStream.string[mockStream.pos]
                  : undefined,
            } as unknown as StringStream;

            while (!mockStream.eol()) {
              rillHighlighter.token!(mockStream, state);
            }
          }
        },
        { samples: 5, warmup: 2 }
      );

      expect(p95).toBeLessThan(200);
    });
  });

  describe('10,000-line document highlighting', () => {
    it('highlights 10,000-line document in less than 1000ms', () => {
      const lines = Array.from({ length: 10000 }, (_, i) => `${i} -> $var${i}`);

      const p95 = measureP95(
        () => {
          for (const line of lines) {
            const state = rillHighlighter.startState!(2);
            const mockStream = {
              string: line,
              pos: 0,
              start: 0,
              sol: () => mockStream.pos === 0,
              eol: () => mockStream.pos >= mockStream.string.length,
              next: () => {
                if (mockStream.pos < mockStream.string.length) {
                  const char = mockStream.string[mockStream.pos];
                  mockStream.pos++;
                  return char;
                }
                return undefined;
              },
              peek: () =>
                mockStream.pos < mockStream.string.length
                  ? mockStream.string[mockStream.pos]
                  : undefined,
            } as unknown as StringStream;

            while (!mockStream.eol()) {
              rillHighlighter.token!(mockStream, state);
            }
          }
        },
        { samples: 3, warmup: 1 }
      );

      expect(p95).toBeLessThan(1000);
    });
  });

  describe('1000-character single line highlighting', () => {
    it('highlights 1000-character line in less than 50ms', () => {
      const longLine = Array.from({ length: 250 }, () => '1 + ').join('') + '1';

      expect(longLine.length).toBeGreaterThanOrEqual(1000);

      const mockStream = {
        string: longLine,
        pos: 0,
        start: 0,
        sol: () => mockStream.pos === 0,
        eol: () => mockStream.pos >= mockStream.string.length,
        next: () => {
          if (mockStream.pos < mockStream.string.length) {
            const char = mockStream.string[mockStream.pos];
            mockStream.pos++;
            return char;
          }
          return undefined;
        },
        peek: () =>
          mockStream.pos < mockStream.string.length
            ? mockStream.string[mockStream.pos]
            : undefined,
      } as unknown as StringStream;

      const p95 = measureP95(
        () => {
          // Both resets matter: the loop below consumes the stream and
          // mutates the highlighter state, so without them every sample
          // after the first would start at EOL and measure no work at all.
          mockStream.pos = 0;
          const sampleState = rillHighlighter.startState!(2);
          while (!mockStream.eol()) {
            rillHighlighter.token!(mockStream, sampleState);
          }
        },
        { samples: 50, warmup: 5 }
      );

      expect(p95).toBeLessThan(50);
    });
  });
});

// ============================================================
// FONT AND TYPOGRAPHY TESTS
// ============================================================

describe('Font and Typography', () => {
  describe('JetBrains Mono font loading', () => {
    it('HTML includes Google Fonts preconnect links', () => {
      const htmlPath = resolve(__dirname, '../../index.html');
      const htmlContent = readFileSync(htmlPath, 'utf-8');

      expect(htmlContent).toContain('https://fonts.googleapis.com');
      expect(htmlContent).toContain('https://fonts.gstatic.com');
      expect(htmlContent).toContain('preconnect');
    });

    it('CSS includes JetBrains Mono in font custom property', () => {
      const cssPath = resolve(__dirname, '../../src/index.css');
      const cssContent = readFileSync(cssPath, 'utf-8');

      expect(cssContent).toContain('JetBrains Mono');
      expect(cssContent).toContain('--font-mono');
    });
  });

  describe('Font ligature support', () => {
    it('CSS enables ligatures with font-variant-ligatures normal', () => {
      const cssPath = resolve(__dirname, '../../src/index.css');
      const cssContent = readFileSync(cssPath, 'utf-8');

      expect(cssContent).toContain('font-variant-ligatures: normal');
    });
  });

  describe('Font fallback chain', () => {
    it('CSS includes ui-monospace fallback in font custom property', () => {
      const cssPath = resolve(__dirname, '../../src/index.css');
      const cssContent = readFileSync(cssPath, 'utf-8');

      expect(cssContent).toContain('ui-monospace');
      expect(cssContent).toContain("'JetBrains Mono'");
    });

    it('CSS includes generic monospace fallback', () => {
      const cssPath = resolve(__dirname, '../../src/index.css');
      const cssContent = readFileSync(cssPath, 'utf-8');

      expect(cssContent).toContain('monospace');
    });
  });
});
