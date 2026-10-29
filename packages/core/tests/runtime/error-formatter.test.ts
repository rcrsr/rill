/**
 * Rill Runtime Tests: Error Formatter
 * Characterization coverage for formatRillError's primary-location snippet
 * rendering across the plain-`sources` branch and the cross-module
 * `sourceId`-bearing branch.
 */

import {
  formatRillError,
  RuntimeError,
  type CallFrame,
  type SourceLocation,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

describe('Rill Runtime: formatRillError', () => {
  it('renders a source snippet for a plain-`sources` error', () => {
    const script = ['1 + 1', '"5" + 1', '3 + 3'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 5, offset: 10 },
      undefined,
      {
        start: { line: 2, column: 5, offset: 10 },
        end: { line: 2, column: 6, offset: 11 },
      }
    );

    const formatted = formatRillError(err, {
      filePath: 'script.rill',
      sources: { script },
    });

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at script.rill:2:5',
        '  2 | "5" + 1',
        '    |     ^',
      ].join('\n')
    );
  });

  it('renders a source snippet for a cross-module sourceId error', () => {
    const moduleSource = ['fn() {', '  1 + "1"', '}'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 3, offset: 9 },
      { sourceText: moduleSource },
      {
        start: { line: 2, column: 3, offset: 9 },
        end: { line: 2, column: 4, offset: 10 },
      },
      'module:greetings'
    );

    const formatted = formatRillError(err);

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at module:greetings:2:3',
        '  2 |   1 + "1"',
        '    |   ^',
      ].join('\n')
    );
  });

  it('renders a clean snippet line for CRLF source (no trailing \\r)', () => {
    const script = ['1 + 1', '"5" + 1', '3 + 3'].join('\r\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 5, offset: 11 },
      undefined,
      {
        start: { line: 2, column: 5, offset: 11 },
        end: { line: 2, column: 6, offset: 12 },
      }
    );

    const formatted = formatRillError(err, {
      filePath: 'script.rill',
      sources: { script },
    });

    const snippetLine = formatted
      .split('\n')
      .find((line) => line.includes('"5" + 1'));
    expect(snippetLine).toBeDefined();
    expect(snippetLine).not.toContain('\r');
    expect(snippetLine?.charCodeAt(snippetLine.length - 1)).not.toBe(13);
  });

  it('places the caret at the correct visual column on a line with a leading emoji', () => {
    // "😀" is a surrogate pair: 2 UTF-16 code units but 1 visual column.
    const script = ['😀bad + 1'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 1, column: 3, offset: 2 },
      undefined,
      {
        start: { line: 1, column: 3, offset: 2 },
        end: { line: 1, column: 6, offset: 5 },
      }
    );

    const formatted = formatRillError(err, {
      filePath: 'script.rill',
      sources: { script },
    });

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at script.rill:1:3',
        '  1 | 😀bad + 1',
        '    |  ^',
      ].join('\n')
    );
  });

  it('is unchanged for a plain ASCII source line (regression)', () => {
    const script = ['1 + 1', 'foo + bar', '3 + 3'].join('\n');
    const err = new RuntimeError(
      'RILL-R001',
      'type mismatch',
      { line: 2, column: 7, offset: 12 },
      undefined,
      {
        start: { line: 2, column: 7, offset: 12 },
        end: { line: 2, column: 10, offset: 15 },
      }
    );

    const formatted = formatRillError(err, {
      filePath: 'script.rill',
      sources: { script },
    });

    expect(formatted).toBe(
      [
        'error[RILL-R001]: type mismatch',
        '  at script.rill:2:7',
        '  2 | foo + bar',
        '    |       ^',
      ].join('\n')
    );
  });
});

describe('Rill Runtime: formatRillError call stack', () => {
  function makeLocation(line: number, column: number): SourceLocation {
    return { line, column, offset: 0 };
  }

  function makeFrame(
    line: number,
    column: number,
    functionName?: string,
    sourceId?: string
  ): CallFrame {
    return {
      location: {
        start: makeLocation(line, column),
        end: makeLocation(line, column + 1),
      },
      ...(functionName !== undefined ? { functionName } : {}),
      ...(sourceId !== undefined ? { sourceId } : {}),
    };
  }

  function makeError(
    line: number,
    column: number,
    context: Record<string, unknown>,
    sourceId?: string
  ): RuntimeError {
    return new RuntimeError(
      'RILL-R001',
      'boom',
      makeLocation(line, column),
      context,
      {
        start: makeLocation(line, column),
        end: makeLocation(line, column + 1),
      },
      sourceId
    );
  }

  it('lists frames as plain locations when no sources are given', () => {
    const err = makeError(3, 1, {
      callStack: [makeFrame(2, 5, 'outer'), makeFrame(1, 2)],
    });

    expect(formatRillError(err)).toBe(
      [
        'error[RILL-R001]: boom',
        '  at line 3, column 1',
        '',
        '  called from:',
        '  at 2:5 in outer',
        '  at 1:2',
      ].join('\n')
    );
  });

  it('drops a frame at the same spot as the primary location', () => {
    const err = makeError(3, 1, {
      callStack: [makeFrame(3, 1, 'same_spot'), makeFrame(2, 5, 'outer')],
    });

    expect(formatRillError(err)).toBe(
      [
        'error[RILL-R001]: boom',
        '  at line 3, column 1',
        '',
        '  called from:',
        '  at 2:5 in outer',
      ].join('\n')
    );
  });

  it('omits the call stack section when the only frame duplicates the primary location', () => {
    const err = makeError(3, 1, { callStack: [makeFrame(3, 1, 'same_spot')] });

    expect(formatRillError(err)).toBe(
      ['error[RILL-R001]: boom', '  at line 3, column 1'].join('\n')
    );
  });

  it('renders a snippet for a root-script frame when sources are given', () => {
    const script = ['foo()', 'bar()', 'baz + 1'].join('\n');
    const err = makeError(3, 1, { callStack: [makeFrame(1, 2, 'foo')] });

    expect(
      formatRillError(err, { filePath: 'script.rill', sources: { script } })
    ).toBe(
      [
        'error[RILL-R001]: boom',
        '  at script.rill:3:1',
        '  3 | baz + 1',
        '    | ^',
        '',
        '  called from:',
        '  1 | foo()',
        '    |  ^',
      ].join('\n')
    );
  });

  it('labels a frame from another source with its sourceId and widens the gutter', () => {
    const script = ['foo()', 'bar()', 'baz + 1'].join('\n');
    const err = makeError(3, 1, {
      callStack: [makeFrame(12, 3, 'helper', 'mod'), makeFrame(1, 1)],
    });

    expect(
      formatRillError(err, { filePath: 'script.rill', sources: { script } })
    ).toBe(
      [
        'error[RILL-R001]: boom',
        '  at script.rill:3:1',
        '   3 | baz + 1',
        '     | ^',
        '',
        '  called from:',
        '  at mod:12:3 in helper',
        '   1 | foo()',
        '     | ^',
      ].join('\n')
    );
  });

  it('labels root-script frames with the file path when the error is cross-module', () => {
    const script = ['foo()', 'bar()'].join('\n');
    const moduleSource = ['fn() {', '  1 + "1"', '}'].join('\n');
    const err = makeError(
      2,
      3,
      { sourceText: moduleSource, callStack: [makeFrame(1, 1, 'foo')] },
      'module:greetings'
    );

    expect(
      formatRillError(err, { filePath: 'main.rill', sources: { script } })
    ).toBe(
      [
        'error[RILL-R001]: boom',
        '  at module:greetings:2:3',
        '  2 |   1 + "1"',
        '    |   ^',
        '',
        '  called from:',
        '  main.rill:1:1',
        '  1 | foo()',
        '    | ^',
      ].join('\n')
    );
  });

  it('truncates the call stack to maxStackDepth frames', () => {
    const err = makeError(9, 1, {
      callStack: [
        makeFrame(3, 1, 'a'),
        makeFrame(2, 1, 'b'),
        makeFrame(1, 1, 'c'),
      ],
    });

    expect(formatRillError(err, { maxStackDepth: 2 })).toBe(
      [
        'error[RILL-R001]: boom',
        '  at line 9, column 1',
        '',
        '  called from:',
        '  at 3:1 in a',
        '  at 2:1 in b',
      ].join('\n')
    );
  });

  it('falls back to text for a frame whose source line is missing', () => {
    const script = ['foo()', 'bar()', 'baz + 1'].join('\n');
    const err = makeError(3, 1, { callStack: [makeFrame(9, 1, 'gone')] });

    expect(formatRillError(err, { sources: { script } })).toBe(
      [
        'error[RILL-R001]: boom',
        '  at <script>:3:1',
        '  3 | baz + 1',
        '    | ^',
        '',
        '  called from:',
        '  at 9:1 in gone',
      ].join('\n')
    );
  });

  it('omits callStack from the verbose context dump', () => {
    const err = makeError(3, 1, {
      detail: 'x',
      callStack: [makeFrame(2, 5, 'outer')],
    });

    const formatted = formatRillError(err, { verbose: true });

    expect(formatted).toContain('  context: {\n  "detail": "x"\n}\n');
    expect(formatted).not.toContain('"callStack"');
    expect(formatted.endsWith('\n\n  called from:\n  at 2:5 in outer')).toBe(
      true
    );
  });
});
