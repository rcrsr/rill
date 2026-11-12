/**
 * Tests for highlight module
 *
 * Validates StreamParser implementation for rill syntax highlighting.
 */

import { describe, it, expect } from 'vitest';
import { type StringStream } from '@codemirror/language';
import { rillHighlighter, type RillHighlightState } from '../highlight.js';
import { TOKEN_TYPES } from '@rcrsr/rill';
import { measureP95 } from '../../../tests/helpers/measure.js';

// Type-safe helper to ensure methods exist
const highlighter = {
  name: rillHighlighter.name,
  startState: (indentUnit: number) => rillHighlighter.startState!(indentUnit),
  token: (stream: StringStream, state: RillHighlightState) =>
    rillHighlighter.token(stream, state),
  copyState: (state: RillHighlightState) => rillHighlighter.copyState!(state),
  blankLine: (state: RillHighlightState, indentUnit: number) =>
    rillHighlighter.blankLine!(state, indentUnit),
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
    return this.string.slice(this.start, this.pos);
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

/**
 * Shared probe table: each `#` form with the tags tokenize() emits for it
 * alone and whether it counts as an atom (true) or a comment (false) when
 * scanning a line for an unterminated triple-quote opener.
 */
const HASH_PROBES: ReadonlyArray<{
  readonly text: string;
  readonly isAtom: boolean;
}> = [
  { text: '#wired', isAtom: true },
  { text: '#Wired', isAtom: true },
  { text: '#A1_b', isAtom: true },
  { text: '#ok', isAtom: true },
  { text: '#_x', isAtom: true },
  { text: '# text', isAtom: false },
  { text: '#', isAtom: false },
  { text: '##', isAtom: false },
  { text: '#---', isAtom: false },
  { text: '#!', isAtom: false },
  { text: '#1', isAtom: false },
];

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
// TOKEN HIGHLIGHTING TESTS
// ============================================================

describe('token highlighting', () => {
  describe('keyword highlighting', () => {
    it('"each" is no longer a keyword (now an identifier)', () => {
      const tags = tokenizeLine('each');
      expect(tags).toContain('variableName');
      expect(tags).not.toContain('keyword');
    });

    it('"map" is no longer a keyword (now an identifier)', () => {
      const tags = tokenizeLine('map');
      expect(tags).toContain('variableName');
      expect(tags).not.toContain('keyword');
    });

    it('highlights "break" as keyword', () => {
      const tags = tokenizeLine('break');
      expect(tags).toContain('keyword');
    });
  });

  describe('operator highlighting', () => {
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

  describe('string highlighting', () => {
    it('highlights double-quoted string as string', () => {
      const tags = tokenizeLine('"hello"');
      expect(tags).toContain('string');
    });

    it('highlights string with spaces as string', () => {
      const tags = tokenizeLine('"hello world"');
      expect(tags).toContain('string');
    });
  });

  describe('number highlighting', () => {
    it('highlights integer as number', () => {
      const tags = tokenizeLine('42');
      expect(tags).toContain('number');
    });

    it('highlights decimal as number', () => {
      const tags = tokenizeLine('3.14');
      expect(tags).toContain('number');
    });
  });

  describe('bool highlighting', () => {
    it('highlights "true" as bool', () => {
      const tags = tokenizeLine('true');
      expect(tags).toContain('bool');
    });

    it('highlights "false" as bool', () => {
      const tags = tokenizeLine('false');
      expect(tags).toContain('bool');
    });
  });

  describe('variableName highlighting', () => {
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

    it('highlights "union" in union(string, number) as typeName', () => {
      const tags = tokenizeLine('union(string, number)');
      expect(tags[0]).toBe('typeName');
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

describe('atom and comment highlighting', () => {
  describe.each(HASH_PROBES)('for $text', ({ text, isAtom }) => {
    it(`tags it as ${isAtom ? 'meta' : 'comment'}`, () => {
      expect(tokenizeLine(text)).toEqual([isAtom ? 'meta' : 'comment']);
    });
  });

  it('tags an atom after a number as meta', () => {
    expect(tokenizeLine('1 #note')).toEqual(['number', null, 'meta']);
  });
});

// ============================================================
// ERROR HANDLING TESTS
// ============================================================

describe('error handling', () => {
  describe('tokenize error handling', () => {
    it('returns null tags for invalid syntax without throwing', () => {
      const line = '42 § x';

      expect(() => tokenizeLine(line)).not.toThrow();
      const tags = tokenizeLine(line);
      expect(tags).toHaveLength(6);
      expect(tags.every((tag) => tag === null)).toBe(true);
    });
  });

  describe('missing category handling', () => {
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
      expect(tag).toBeNull();
    });
  });

  describe('tokenize throws error', () => {
    it('recovers tokens before an unterminated string', () => {
      const tags = tokenizeLine('42 "abc');

      expect(tags).toEqual(['number', null, 'string']);
    });
  });

  describe('TOKEN_HIGHLIGHT_MAP missing category', () => {
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

    it('treats {{ and }} as escaped literal braces in a single-line string', () => {
      // "a{{b}}c" — {{ and }} are escaped literal braces, not interpolation,
      // matching readers.ts readString. The whole string is a single token.
      const tags = tokenizeLine('"a{{b}}c"');
      expect(tags).not.toContain('bracket');
      expect(tags).toEqual(['string']);
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

    it('sets inTripleQuoteString even when the opening line has an odd number of embedded quotes', () => {
      const state = highlighter.startState(2);
      const openTags = processLine(state, '"""She said "hi');

      expect(state.inTripleQuoteString).toBe(true);
      expect(openTags).toContain('string');

      const contentTags = processLine(state, 'more content');
      expect(contentTags).toContain('string');
    });

    it('does not flip to string mode for a closed """a""" pair followed by an in-progress double-quote', () => {
      const state = highlighter.startState(2);
      processLine(state, '"""a""" "b');

      expect(state.inTripleQuoteString).toBe(false);

      const nextTags = processLine(state, '42');
      expect(nextTags).toContain('number');
    });

    it('does not enter triple-quote mode for a triple-quote inside a comment', () => {
      const state = highlighter.startState(2);
      // `~` is an invalid character, forcing tokenize() to throw for a
      // reason unrelated to the triple-quote in the trailing comment.
      processLine(state, '~ # """');

      expect(state.inTripleQuoteString).toBe(false);

      const nextTags = processLine(state, '42');
      expect(nextTags).toContain('number');
    });

    it('keeps triple-quote mode when an atom literal precedes the opener', () => {
      const state = highlighter.startState(2);
      processLine(state, '~ #TODO """');

      expect(state.inTripleQuoteString).toBe(true);
    });

    describe.each(HASH_PROBES)(
      'after $text before a triple-quote opener',
      ({ text, isAtom }) => {
        it(`${isAtom ? 'enters' : 'does not enter'} multi-line string mode`, () => {
          const state = highlighter.startState(2);
          processLine(state, `~ ${text} """`);

          expect(state.inTripleQuoteString).toBe(isAtom);
          if (!isAtom) {
            expect(processLine(state, '42')).toContain('number');
          }
        });
      }
    );

    it('treats a trailing bare # as a comment without throwing', () => {
      const state = highlighter.startState(2);

      expect(() => processLine(state, '~ #')).not.toThrow();
      expect(state.inTripleQuoteString).toBe(false);
    });

    it('still enters multi-line string mode for a genuine unterminated triple-quote opener', () => {
      const state = highlighter.startState(2);
      const openTags = processLine(state, '"""genuinely unterminated');

      expect(state.inTripleQuoteString).toBe(true);
      expect(openTags).toContain('string');

      const contentTags = processLine(state, 'more content');
      expect(contentTags).toContain('string');
    });
  });
});

// ============================================================
// PERFORMANCE
// ============================================================

describe('highlighting performance', () => {
  describe('Empty document highlighting', () => {
    it('highlights empty document in less than 1ms', () => {
      const state = rillHighlighter.startState!(2);
      const mockStream = {
        string: '',
        pos: 0,
        start: 0,
        sol: () => true,
        eol: () => true,
        next: () => {},
      } as unknown as StringStream;

      const p95 = measureP95(
        () => {
          rillHighlighter.token(mockStream, state);
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
              next: (): string | undefined => {
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
              rillHighlighter.token(mockStream, state);
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
              next: (): string | undefined => {
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
              rillHighlighter.token(mockStream, state);
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
        next: (): string | undefined => {
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
            rillHighlighter.token(mockStream, sampleState);
          }
        },
        { samples: 50, warmup: 5 }
      );

      expect(p95).toBeLessThan(50);
    });
  });
});
