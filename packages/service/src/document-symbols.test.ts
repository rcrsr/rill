import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';
import { documentSymbols } from './document-symbols.js';

describe('documentSymbols', () => {
  it('returns one symbol per capture and per closure in a well-formed script', () => {
    const source = `
1 => $a
2 => $b
3 => $c
4 => $d
5 => $e
6 => $f
7 => $g
8 => $h
9 => $i
10 => $j
|x| ($x * 2) => $double
|x| ($x + 1) => $increment
|x, y| ($x + $y) => $add
|x| ($x -> .upper) => $shout
|x| ($x -> .len) => $length
`;

    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(true);

    const captureCount = parsed.ast.statements.filter(
      (statement) =>
        statement.type === 'Statement' &&
        statement.expression.type === 'PipeChain' &&
        (statement.expression.terminator?.type === 'Capture' ||
          statement.expression.pipes.some((pipe) => pipe.type === 'Capture'))
    ).length;
    expect(captureCount).toBe(15);

    const symbols = documentSymbols(parsed);

    expect(symbols).toHaveLength(15);

    const variables = symbols.filter((symbol) => symbol.kind === 'variable');
    const functions = symbols.filter((symbol) => symbol.kind === 'function');
    expect(variables).toHaveLength(10);
    expect(functions).toHaveLength(5);

    expect(variables.map((symbol) => symbol.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
      'i',
      'j',
    ]);
    expect(functions.map((symbol) => symbol.name)).toEqual([
      'double',
      'increment',
      'add',
      'shout',
      'length',
    ]);

    for (const symbol of symbols) {
      expect(symbol.range.start.line).toBeGreaterThanOrEqual(0);
      expect(symbol.range.start.character).toBeGreaterThanOrEqual(0);
      expect(symbol.selectionRange.start.line).toBeGreaterThanOrEqual(0);
      expect(symbol.selectionRange.start.character).toBeGreaterThanOrEqual(0);
    }

    const doubleSymbol = functions.find((symbol) => symbol.name === 'double');
    expect(doubleSymbol?.range.start.line).toBe(11);
  });

  it('returns an empty array for an empty script', () => {
    const parsed = parseWithRecovery('');

    expect(documentSymbols(parsed)).toEqual([]);
  });

  it('returns an empty array for a whitespace-only script', () => {
    const parsed = parseWithRecovery('   \n  \n');

    expect(documentSymbols(parsed)).toEqual([]);
  });

  it('tolerates a script with recovery errors and returns partial symbols without throwing', () => {
    const source = `
1 => $a
2 => $b
|||broken syntax here
3 => $c
`;

    const parsed = parseWithRecovery(source);
    expect(parsed.success).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);

    let symbols: ReturnType<typeof documentSymbols> = [];
    expect(() => {
      symbols = documentSymbols(parsed);
    }).not.toThrow();

    const variableNames = symbols
      .filter((symbol) => symbol.kind === 'variable')
      .map((symbol) => symbol.name);
    expect(variableNames).toContain('a');
    expect(variableNames).toContain('b');
  });

  it('returns a field symbol for each dict entry key', () => {
    const parsed = parseWithRecovery('dict[name: "Alice", age: 30] => $person');

    const symbols = documentSymbols(parsed);
    const fields = symbols.filter((symbol) => symbol.kind === 'field');

    expect(fields.map((symbol) => symbol.name)).toEqual(['name', 'age']);
  });
});
