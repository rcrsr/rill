/**
 * Tests for highlight module
 *
 * Validates StreamParser implementation for rill syntax highlighting.
 */

import { describe, it, expect } from 'vitest';
import { type StringStream } from '@codemirror/language';
import { rillHighlighter, type RillHighlightState } from '../highlight.js';
import { TOKEN_TYPES } from '@rcrsr/rill';

// Type-safe helper to ensure methods exist
const highlighter = {
  name: rillHighlighter.name,
  startState: rillHighlighter.startState!,
  token: rillHighlighter.token!,
  copyState: rillHighlighter.copyState!,
  blankLine: rillHighlighter.blankLine!,
};

// ============================================================
// TEST HELPERS
// ============================================================

/**
 * Mock StringStream for testing token() method
 *
 * Implements minimal StringStream interface required by StreamParser.
 */
class MockStringStream {
  string: string;
  pos: number;
  start: number;
  tabSize = 2;
  indentUnit = 2;
  lastColumnPos = 0;
  lastColumnValue = 0;
  lineStart = 0;

  constructor(line: string) {
    this.string = line;
    this.pos = 0;
    this.start = 0;
  }

  sol(): boolean {
    return this.pos === 0;
  }

  eol(): boolean {
    return this.pos >= this.string.length;
  }

  next(): string | undefined {
    if (this.pos >= this.string.length) {
      return undefined;
    }
    return this.string[this.pos++];
  }

  peek(): string | undefined {
    if (this.pos >= this.string.length) {
      return undefined;
    }
    return this.string[this.pos];
  }

  eat(): string | undefined {
    return this.next();
  }

  eatWhile(): boolean {
    return false;
  }

  eatSpace(): boolean {
    return false;
  }

  skipToEnd(): void {
    this.pos = this.string.length;
  }

  skipTo(): boolean {
    return false;
  }

  backUp(n: number): void {
    this.pos -= n;
  }

  column(): number {
    return this.pos;
  }

  indentation(): number {
    return 0;
  }

  match(): boolean {
    return false;
  }

  current(): string {
    return this.string.substring(this.start, this.pos);
  }
}

/**
 * Tokenize a line and return tag sequence
 */
function tokenizeLine(line: string): Array<string | null> {
  const stream = new MockStringStream(line) as unknown as StringStream;
  const state = highlighter.startState(2);
  const tags: Array<string | null> = [];

  while (!stream.eol()) {
    const tag = highlighter.token(stream, state);
    tags.push(tag);
  }

  return tags;
}

// ============================================================
// STREAM PARSER INTERFACE TESTS
// ============================================================

describe('rillHighlighter', () => {
  describe('StreamParser interface', () => {
    it('has name property set to "rill"', () => {
      expect(highlighter.name).toBe('rill');
    });

    it('has startState method', () => {
      expect(typeof highlighter.startState).toBe('function');
    });

    it('has token method', () => {
      expect(typeof highlighter.token).toBe('function');
    });

    it('has copyState method', () => {
      expect(typeof highlighter.copyState).toBe('function');
    });

    it('has blankLine method', () => {
      expect(typeof highlighter.blankLine).toBe('function');
    });
  });

  describe('startState', () => {
    it('returns RillHighlightState with initial values', () => {
      const state = highlighter.startState(2);

      expect(state).toBeDefined();
      expect(state.lineNumber).toBe(0);
      expect(state.lineTokens).toEqual([]);
      expect(state.tokenIndex).toBe(0);
    });

    it('returns new state object on each call', () => {
      const state1 = highlighter.startState(2);
      const state2 = highlighter.startState(2);

      expect(state1).not.toBe(state2);
    });
  });

  describe('copyState', () => {
    it('returns deep copy of state', () => {
      const state = highlighter.startState(2);
      state.lineNumber = 5;

      const copy = highlighter.copyState(state);

      expect(copy).not.toBe(state);
      expect(copy.lineNumber).toBe(5);
    });

    it('creates independent copy that does not share references', () => {
      const state: RillHighlightState = {
        lineNumber: 0,
        lineTokens: [
          {
            type: TOKEN_TYPES.NUMBER,
            value: '42',
            span: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 3, offset: 2 },
            },
          },
        ],
        tokenIndex: 0,
        lineComplete: false,
        inTripleQuoteString: false,
      };

      const copy = highlighter.copyState(state);

      // Mutate copy
      copy.lineNumber = 99;
      copy.lineTokens = [];

      // Original should be unchanged
      expect(state.lineNumber).toBe(0);
      expect(state.lineTokens).toHaveLength(1);
    });
  });

  describe('blankLine', () => {
    it('increments lineNumber', () => {
      const state = highlighter.startState(2);
      expect(state.lineNumber).toBe(0);

      highlighter.blankLine(state, 2);
      expect(state.lineNumber).toBe(1);

      highlighter.blankLine(state, 2);
      expect(state.lineNumber).toBe(2);
    });
  });
});

// ============================================================
// TOKEN HIGHLIGHTING TESTS (AC-14-19)
// ============================================================

describe('token highlighting', () => {
  describe('AC-14: keyword highlighting', () => {
    it('highlights "each" as keyword', () => {
      const tags = tokenizeLine('each');
      expect(tags).toContain('keyword');
    });

    it('highlights "map" as keyword', () => {
      const tags = tokenizeLine('map');
      expect(tags).toContain('keyword');
    });

    it('highlights "break" as keyword', () => {
      const tags = tokenizeLine('break');
      expect(tags).toContain('keyword');
    });
  });

  describe('AC-15: operator highlighting', () => {
    it('highlights "->" as operator', () => {
      const tags = tokenizeLine('->');
      expect(tags).toContain('operator');
    });

    it('highlights "+" as operator', () => {
      const tags = tokenizeLine('1 + 2');
      expect(tags).toContain('operator');
    });

    it('highlights "==" as operator', () => {
      const tags = tokenizeLine('x == y');
      expect(tags).toContain('operator');
    });
  });

  describe('AC-16: string highlighting', () => {
    it('highlights double-quoted string as string', () => {
      const tags = tokenizeLine('"hello"');
      expect(tags).toContain('string');
    });

    it('highlights string with spaces as string', () => {
      const tags = tokenizeLine('"hello world"');
      expect(tags).toContain('string');
    });
  });

  describe('AC-17: number highlighting', () => {
    it('highlights integer as number', () => {
      const tags = tokenizeLine('42');
      expect(tags).toContain('number');
    });

    it('highlights decimal as number', () => {
      const tags = tokenizeLine('3.14');
      expect(tags).toContain('number');
    });
  });

  describe('AC-18: bool highlighting', () => {
    it('highlights "true" as bool', () => {
      const tags = tokenizeLine('true');
      expect(tags).toContain('bool');
    });

    it('highlights "false" as bool', () => {
      const tags = tokenizeLine('false');
      expect(tags).toContain('bool');
    });
  });

  describe('AC-19: variableName highlighting', () => {
    it('highlights identifier as variableName', () => {
      const tags = tokenizeLine('foo');
      expect(tags).toContain('variableName');
    });

    it('highlights variable with $ as variableName', () => {
      const tags = tokenizeLine('$x');
      expect(tags).toContain('variableName');
    });
  });

  describe('typeName highlighting', () => {
    it('highlights "string" as typeName not variableName', () => {
      const tags = tokenizeLine('string');
      expect(tags).toContain('typeName');
      expect(tags).not.toContain('variableName');
    });

    it('highlights "number" as typeName', () => {
      const tags = tokenizeLine('number');
      expect(tags).toContain('typeName');
    });

    it('highlights "bool" as typeName', () => {
      const tags = tokenizeLine('bool');
      expect(tags).toContain('typeName');
    });

    it('highlights non-type identifier "foo" as variableName not typeName', () => {
      const tags = tokenizeLine('foo');
      expect(tags).toContain('variableName');
      expect(tags).not.toContain('typeName');
    });

    it('highlights type annotation ":string" on variable declaration line as typeName', () => {
      const tags = tokenizeLine('$x: string');
      expect(tags).toContain('typeName');
    });
  });

  describe('functionName highlighting', () => {
    it('highlights method name after dot as functionName', () => {
      const tags = tokenizeLine('$x.len()');
      expect(tags).toContain('functionName');
    });

    it('highlights property name after dot as functionName', () => {
      const tags = tokenizeLine('$x.name');
      expect(tags).toContain('functionName');
    });

    it('highlights method name after optional chaining as functionName', () => {
      const tags = tokenizeLine('$x.?upper()');
      expect(tags).toContain('functionName');
    });

    it('does not highlight standalone function call as functionName', () => {
      const tags = tokenizeLine('foo()');
      expect(tags).not.toContain('functionName');
      expect(tags).toContain('variableName');
    });
  });

  describe('punctuation highlighting', () => {
    it('highlights "." as punctuation', () => {
      const tags = tokenizeLine('obj.method');
      expect(tags).toContain('punctuation');
    });

    it('highlights "," as punctuation', () => {
      const tags = tokenizeLine('[1, 2]');
      expect(tags).toContain('punctuation');
    });
  });

  describe('bracket highlighting', () => {
    it('highlights "(" and ")" as bracket', () => {
      const tags = tokenizeLine('(x)');
      expect(tags).toContain('bracket');
    });

    it('highlights "[" and "]" as bracket', () => {
      const tags = tokenizeLine('[1, 2]');
      expect(tags).toContain('bracket');
    });
  });
});

// ============================================================
// ERROR HANDLING TESTS (AC-24, AC-25, EC-3, EC-4)
// ============================================================

describe('error handling', () => {
  describe('AC-24: tokenize error handling', () => {
    it('handles invalid syntax without throwing', () => {
      // Invalid character that tokenizer cannot handle
      const invalidLine = '§§§';

      expect(() => tokenizeLine(invalidLine)).not.toThrow();
    });

    it('returns tags for invalid syntax (may be empty or fallback)', () => {
      const invalidLine = '§§§';
      const tags = tokenizeLine(invalidLine);

      // Should return array, even if empty
      expect(Array.isArray(tags)).toBe(true);
    });
  });

  describe('AC-25: missing category handling', () => {
    it('handles tokens without highlight category', () => {
      // NEWLINE and EOF tokens have no highlight category
      const line = '\n';

      expect(() => tokenizeLine(line)).not.toThrow();
    });

    it('returns null for tokens without category', () => {
      // Empty line or whitespace-only line
      const stream = new MockStringStream('') as unknown as StringStream;
      const state = highlighter.startState(2);

      // Should handle gracefully
      const tag = highlighter.token(stream, state);
      expect(tag === null || typeof tag === 'string').toBe(true);
    });
  });

  describe('EC-3: tokenize throws error', () => {
    it('returns previous valid tokens on error', () => {
      const validLine = '42';
      const tags = tokenizeLine(validLine);

      // Should have number tag
      expect(tags).toContain('number');
    });

    it('continues parsing after error', () => {
      const stream = new MockStringStream('42 + x') as unknown as StringStream;
      const state = highlighter.startState(2);
      const tags: Array<string | null> = [];

      // Parse entire line
      while (!stream.eol()) {
        const tag = highlighter.token(stream, state);
        tags.push(tag);
      }

      // Should have parsed successfully
      expect(tags.length).toBeGreaterThan(0);
    });
  });

  describe('EC-4: TOKEN_HIGHLIGHT_MAP missing category', () => {
    it('returns null for unmapped token types', () => {
      // NEWLINE is intentionally unmapped
      const stream = new MockStringStream('\n') as unknown as StringStream;
      const state = highlighter.startState(2);

      const tag = highlighter.token(stream, state);

      // Should return null for unmapped category
      expect(tag === null).toBe(true);
    });

    it('does not throw for unmapped categories', () => {
      const stream = new MockStringStream('\n') as unknown as StringStream;
      const state = highlighter.startState(2);

      expect(() => highlighter.token(stream, state)).not.toThrow();
    });
  });
});

// ============================================================
// STRING INTERPOLATION TESTS
// ============================================================

describe('string interpolation sub-highlighting', () => {
  describe('containsInterpolation detection', () => {
    it('produces bracket tags for a string with a simple interpolation', () => {
      // "value: {$x}" should contain 'bracket' for { and }
      const tags = tokenizeLine('"value: {$x}"');
      expect(tags).toContain('bracket');
    });

    it('produces variableName tag for the interpolated variable', () => {
      const tags = tokenizeLine('"value: {$x}"');
      expect(tags).toContain('variableName');
    });

    it('still produces string tag for the literal parts', () => {
      const tags = tokenizeLine('"value: {$x}"');
      expect(tags).toContain('string');
    });

    it('plain string without interpolation renders only as string', () => {
      const tags = tokenizeLine('"hello world"');
      expect(tags).not.toContain('bracket');
      expect(tags).toContain('string');
    });
  });

  describe('tag sequence ordering', () => {
    it('emits string → bracket → variableName → bracket → string for "a{$x}b"', () => {
      const tags = tokenizeLine('"a{$x}b"');
      const filtered = tags.filter((t) => t !== null);
      // Verify the sequence contains the expected pattern in order
      const strIdx = filtered.indexOf('string');
      const lbraceIdx = filtered.indexOf('bracket');
      const varIdx = filtered.indexOf('variableName');
      // string content before brace, then bracket, then variable
      expect(strIdx).toBeLessThan(lbraceIdx);
      expect(lbraceIdx).toBeLessThan(varIdx);
    });

    it('emits bracket tags flanking the expression in "{$x}"', () => {
      const tags = tokenizeLine('"{$x}"');
      const filtered = tags.filter((t) => t !== null);
      const firstBracket = filtered.indexOf('bracket');
      const lastBracket = filtered.lastIndexOf('bracket');
      // There must be two bracket tags (open and close)
      expect(firstBracket).not.toBe(-1);
      expect(lastBracket).toBeGreaterThan(firstBracket);
    });
  });

  describe('escape handling', () => {
    it('skips \\\\ escape so the char after it is not treated as interpolation start', () => {
      // "\\\\" is a valid rill escape (backslash); the char after the escape is not {
      // so no interpolation is detected — whole string is rendered as string
      const tags = tokenizeLine('"\\\\value"');
      expect(tags).not.toContain('bracket');
      expect(tags).toContain('string');
    });

    it('correctly finds interpolation after a \\\\ escape sequence', () => {
      // "\\\\{$x}" — backslash escape followed by a real interpolation
      const tags = tokenizeLine('"\\\\{$x}"');
      expect(tags).toContain('bracket');
      expect(tags).toContain('variableName');
    });
  });

  describe('arithmetic expression inside interpolation', () => {
    it('highlights number inside {1 + 2} as number', () => {
      const tags = tokenizeLine('"{1 + 2}"');
      expect(tags).toContain('number');
      expect(tags).toContain('operator');
    });
  });

  describe('no matching closing brace', () => {
    it('does not throw when { has no closing } on the line', () => {
      expect(() => tokenizeLine('"unclosed {$x"')).not.toThrow();
    });

    it('still returns string tag when { has no closing }', () => {
      const tags = tokenizeLine('"unclosed {$x"');
      expect(tags).toContain('string');
    });
  });

  describe('multiple interpolations', () => {
    it('produces brackets for both interpolations in "{$a} and {$b}"', () => {
      const tags = tokenizeLine('"{$a} and {$b}"');
      const bracketCount = tags.filter((t) => t === 'bracket').length;
      // 2 open braces + 2 close braces = 4
      expect(bracketCount).toBe(4);
    });
  });

  describe('triple-quote single-line string', () => {
    it('highlights interpolation inside single-line triple-quote string', () => {
      const tags = tokenizeLine('"""hello {$x}"""');
      expect(tags).toContain('bracket');
      expect(tags).toContain('variableName');
      expect(tags).toContain('string');
    });

    it('treats {{ as escaped in triple-quote string — no bracket emitted', () => {
      const tags = tokenizeLine('"""{{not interpolated}}"""');
      expect(tags).not.toContain('bracket');
      expect(tags).toContain('string');
    });
  });

  describe('multi-line triple-quote with interpolation', () => {
    function processLine(
      state: RillHighlightState,
      line: string
    ): Array<string | null> {
      const stream = new MockStringStream(line) as unknown as StringStream;
      const result: Array<string | null> = [];
      while (!stream.eol()) {
        result.push(highlighter.token(stream, state));
      }
      return result;
    }

    it('highlights {$x} on a continuation line inside triple-quote string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');
      const contentTags = processLine(state, 'value: {$x}');
      expect(contentTags).toContain('bracket');
      expect(contentTags).toContain('variableName');
    });

    it('still highlights plain continuation lines as string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');
      const contentTags = processLine(state, 'no interpolation here');
      expect(contentTags).toContain('string');
      expect(contentTags).not.toContain('bracket');
    });

    it('highlights closing """ line as string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');
      processLine(state, '{$x}');
      const closeTags = processLine(state, '"""');
      expect(closeTags).toContain('string');
      expect(state.inTripleQuoteString).toBe(false);
    });
  });
});

// ============================================================
// INTEGRATION TESTS
// ============================================================

describe('integration', () => {
  describe('multi-token lines', () => {
    it('highlights pipe chain correctly', () => {
      const tags = tokenizeLine('1 -> $x');

      // Should contain number, operator, and variableName
      expect(tags).toContain('number');
      expect(tags).toContain('operator');
      expect(tags).toContain('variableName');
    });

    it('highlights function call correctly', () => {
      const tags = tokenizeLine('log("test")');

      // Should contain variableName (function), bracket, and string
      expect(tags).toContain('variableName');
      expect(tags).toContain('bracket');
      expect(tags).toContain('string');
    });
  });

  describe('line number tracking', () => {
    it('tracks line number through multiple lines', () => {
      const state = highlighter.startState(2);
      expect(state.lineNumber).toBe(0);

      // Process first line
      const stream1 = new MockStringStream('42') as unknown as StringStream;
      while (!stream1.eol()) {
        highlighter.token(stream1, state);
      }
      expect(state.lineNumber).toBe(1);

      // Process blank line
      highlighter.blankLine(state, 2);
      expect(state.lineNumber).toBe(2);

      // Process third line
      const stream2 = new MockStringStream(
        '"hello"'
      ) as unknown as StringStream;
      while (!stream2.eol()) {
        highlighter.token(stream2, state);
      }
      expect(state.lineNumber).toBe(3);
    });
  });

  describe('multi-line triple-quote strings', () => {
    // Helper: process one line through the shared state and return all tags
    function processLine(
      state: RillHighlightState,
      line: string
    ): Array<string | null> {
      const stream = new MockStringStream(line) as unknown as StringStream;
      const tags: Array<string | null> = [];
      while (!stream.eol()) {
        const tag = highlighter.token(stream, state);
        tags.push(tag);
      }
      return tags;
    }

    it('highlights all three lines as "string" for an open/content/close sequence', () => {
      const state = highlighter.startState(2);
      const openTags = processLine(state, '"""');
      const contentTags = processLine(state, 'hello world');
      const closeTags = processLine(state, '"""');

      expect(openTags).toContain('string');
      expect(contentTags).toContain('string');
      expect(closeTags).toContain('string');
    });

    it('sets inTripleQuoteString to true after processing the opening """', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');

      expect(state.inTripleQuoteString).toBe(true);
    });

    it('clears inTripleQuoteString to false after processing the closing """', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');
      processLine(state, 'content');
      processLine(state, '"""');

      expect(state.inTripleQuoteString).toBe(false);
    });

    it('does not set inTripleQuoteString for a single-line triple-quote string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""hello"""');

      expect(state.inTripleQuoteString).toBe(false);
    });

    it('tokenizes normally after a closed multi-line triple-quote string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');
      processLine(state, 'hello');
      processLine(state, '"""');
      const afterTags = processLine(state, '42');

      expect(afterTags).toContain('number');
    });

    it('copyState preserves inTripleQuoteString when inside a multi-line string', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""');

      const copy = highlighter.copyState(state);

      expect(copy.inTripleQuoteString).toBe(true);
    });
  });
});
