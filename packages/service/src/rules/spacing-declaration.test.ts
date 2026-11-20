import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { spacingDeclaration } from './spacing-declaration.js';
import { makeConfig, toParseResult } from './test-support.js';

function check(source: string) {
  return runRules(toParseResult(source), source, makeConfig(), [
    spacingDeclaration,
  ]);
}

describe('SPACING_DECLARATION', () => {
  it.each([
    ['list [1, 2]\n', 'list'],
    ['dict [a: 1]\n', 'dict'],
    ['tuple [1]\n', 'tuple'],
    ['ordered [a: 1]\n', 'ordered'],
  ])('fires on a space between a keyword and its bracket: %s', (source, kw) => {
    const result = check(source);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_DECLARATION',
      severity: 'info',
      message: `No space between '${kw}' and '[': write '${kw}[...]'`,
      location: { line: 1, column: kw.length + 1 },
      fix: { replacement: '', applicable: true },
    });
  });

  it.each([
    ['list[ list [1] ]\n', [10]],
    ['list [ list [1] ]\n', [4, 11]],
    ['list [[1], [2]]\n', [4]],
    ['tuple [ [1] ]\n', [5]],
  ])(
    'reports one diagnostic per spaced keyword, at its own gap: %s',
    (source, offsets) => {
      const result = check(source);
      expect(result.map((d) => d.fix?.range.start.offset)).toEqual(offsets);
    }
  );

  it('fires on a space between a written type and its bracket', () => {
    const result = check('list(number) [1, 2]\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      message: "No space between a type and its '[': write 'type[...]'",
      location: { line: 1, column: 13 },
      fix: {
        replacement: '',
        range: { start: { offset: 12 }, end: { offset: 13 } },
      },
    });
  });

  it('fires on a missing space before a scalar value', () => {
    const result = check('string"x"\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      message: 'Use exactly one space between a type and its value',
      fix: { replacement: ' ' },
    });
  });

  it('fires on extra spaces before an atom value', () => {
    const result = check('union(#a, #b)   #a\n');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      message: 'Use exactly one space between a type and its value',
      fix: {
        replacement: ' ',
        range: { start: { offset: 13 }, end: { offset: 16 } },
      },
    });
  });

  it.each([
    'list[1, 2]\n',
    'dict[a: 1]\n',
    'tuple[1]\n',
    'ordered[a: 1]\n',
    'list(number)[1, 2]\n',
    'list(number)[]\n',
    'string "x"\n',
    'union("a", "b") "a" => $x\n',
    'union(#a, #b) #a\n',
    'list(number)\n[1, 2]\n',
    '$l[0]\n',
  ])('is silent on preferred spacing: %s', (source) => {
    expect(check(source)).toEqual([]);
  });
});
