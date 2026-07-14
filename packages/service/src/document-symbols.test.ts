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

  it('omits an inline-argument closure from the outline', () => {
    const parsed = parseWithRecovery(
      'list[1, 2, 3] -> fan({ $ * 2 }) => $doubled'
    );

    const symbols = documentSymbols(parsed);
    const functions = symbols.filter((symbol) => symbol.kind === 'function');

    expect(functions).toHaveLength(0);
    expect(symbols.map((symbol) => symbol.name)).toEqual(['doubled']);
  });

  it('emits only the outer symbol for a closure nested inside a captured closure', () => {
    const source = '|x| ($x -> fan({ $ * 2 })) => $double';
    const parsed = parseWithRecovery(source);

    const symbols = documentSymbols(parsed);
    const functions = symbols.filter((symbol) => symbol.kind === 'function');

    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('double');
  });

  it('omits an uncaptured top-level closure literal from the outline', () => {
    const parsed = parseWithRecovery('|x| ($x * 2)');

    const symbols = documentSymbols(parsed);

    expect(symbols.filter((symbol) => symbol.kind === 'function')).toHaveLength(
      0
    );
  });

  it('still emits one symbol for a directly-captured closure', () => {
    const parsed = parseWithRecovery('|x| ($x * 2) => $double');

    const symbols = documentSymbols(parsed);
    const functions = symbols.filter((symbol) => symbol.kind === 'function');

    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('double');
    // selectionRange narrows to the capture's `$double` token, distinct from
    // the full closure literal's range.
    expect(functions[0]?.selectionRange).not.toEqual(functions[0]?.range);
    expect(functions[0]?.selectionRange.start.character).toBe(16);
    expect(functions[0]?.selectionRange.end.character).toBe(23);
  });

  it('nests a dict entry inside its enclosing dict entry', () => {
    const parsed = parseWithRecovery(
      'dict[user: dict[name: "alice", age: 30]] => $config'
    );

    const symbols = documentSymbols(parsed);

    expect(symbols.map((symbol) => symbol.name)).toEqual(['user', 'config']);

    const user = symbols.find((symbol) => symbol.name === 'user');
    expect(user?.kind).toBe('field');
    expect(user?.children?.map((child) => child.name)).toEqual(['name', 'age']);
    for (const child of user?.children ?? []) {
      expect(child.kind).toBe('field');
      expect(child.children).toBeUndefined();
    }

    const config = symbols.find((symbol) => symbol.name === 'config');
    expect(config?.children).toBeUndefined();
  });

  it('never returns a symbol with an empty or whitespace name', () => {
    const source = `
list[1, 2, 3] -> fan({ $ * 2 }) => $doubled
|x| ($x -> fan({ $ * 2 })) => $double
|x| ($x * 2)
dict[name: "Alice"] => $person
`;
    const parsed = parseWithRecovery(source);

    const symbols = documentSymbols(parsed);

    expect(symbols.length).toBeGreaterThan(0);
    for (const symbol of symbols) {
      expect(symbol.name.trim().length).toBeGreaterThan(0);
    }
  });
});
