/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: DictEntry keyForm metadata
 * AST-inspection tests verifying keyForm is set correctly by the parser.
 */

import { describe, expect, it } from 'vitest';
import { type DictEntryNode, parse } from '@rcrsr/rill';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

/** Recursively find the first node with the given `type` field. */
function findFirst(node: unknown, typeName: string): unknown | null {
  if (!node || typeof node !== 'object') return null;
  if ('type' in node && (node as { type: unknown }).type === typeName)
    return node;
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirst(item, typeName);
        if (found !== null) return found;
      }
    } else {
      const found = findFirst(value, typeName);
      if (found !== null) return found;
    }
  }
  return null;
}

describe('AST keyForm metadata', () => {
  it('bare identifier key sets keyForm to identifier', () => {
    const ast = parse('dict[name: "x"]');
    const entry = findFirst(ast, 'DictEntry') as DictEntryNode;
    expect(entry).toBeTruthy();
    expect(entry.keyForm).toBe('identifier');
  });

  it('quoted string key sets keyForm to string', () => {
    const ast = parse('dict["maxResults": 10]');
    const entry = findFirst(ast, 'DictEntry') as DictEntryNode;
    expect(entry).toBeTruthy();
    expect(entry.keyForm).toBe('string');
  });

  rule('dict.key-string').it(
    'number key sets keyForm to number and stores its spelling',
    () => {
      const ast = parse('dict[1: "x", -2.50: "y"]');
      const dictNode = findFirst(ast, 'Dict') as { entries: DictEntryNode[] };
      expect(dictNode.entries.map((e) => [e.key, e.keyForm])).toEqual([
        ['1', 'number'],
        ['-2.50', 'number'],
      ]);
    }
  );

  rule('dict.key-string').it(
    'boolean key sets keyForm to bool and stores its spelling',
    () => {
      const ast = parse('dict[true: "x", false: "y"]');
      const dictNode = findFirst(ast, 'Dict') as { entries: DictEntryNode[] };
      expect(dictNode.entries.map((e) => [e.key, e.keyForm])).toEqual([
        ['true', 'bool'],
        ['false', 'bool'],
      ]);
    }
  );

  it('synthesized pass<> option entry has keyForm identifier', () => {
    const ast = parse('42 -> pass<on_error: #IGNORE> { 1 }');
    const passBlock = findFirst(ast, 'PassBlock') as {
      options: { entries: DictEntryNode[] };
    };
    expect(passBlock).toBeTruthy();
    const entry = passBlock.options.entries[0];
    expect(entry).toBeTruthy();
    expect(entry!.keyForm).toBe('identifier');
  });

  const reservedWordKeys = [
    'break',
    'return',
    'yield',
    'pass',
    'assert',
    'error',
    'guard',
    'retry',
    'while',
    'do',
  ];

  it.each(reservedWordKeys)(
    'reserved word "%s" used as a dict key sets keyForm to identifier with a string key',
    (word) => {
      const ast = parse(`dict[${word}: 1]`);
      const entry = findFirst(ast, 'DictEntry') as DictEntryNode;
      expect(entry).toBeTruthy();
      expect(entry.keyForm).toBe('identifier');
      expect(entry.key).toBe(word);
      expect(typeof entry.key).toBe('string');
    }
  );

  it('all reserved-word keys parse together in a single dict literal', () => {
    const ast = parse(
      'dict[break:1,return:2,guard:3,do:4,while:5,error:6,retry:7,assert:8,yield:9,pass:10]'
    );
    const dictNode = findFirst(ast, 'Dict') as {
      entries: DictEntryNode[];
    };
    expect(dictNode).toBeTruthy();
    expect(dictNode.entries).toHaveLength(10);
    for (const entry of dictNode.entries) {
      expect(entry.keyForm).toBe('identifier');
      expect(typeof entry.key).toBe('string');
    }
  });

  it('dict[error:1] evaluates identically to dict["error":1]', async () => {
    const bareResult = await run('dict[error: 1]');
    const quotedResult = await run('dict["error": 1]');
    expect(bareResult).toEqual(quotedResult);
  });
});

describe('Dict key method ordering', () => {
  it('.keys returns string keys in sorted order regardless of literal order', async () => {
    const result = await run('dict[zebra: 1, apple: 2, mango: 3] -> .keys');
    expect(result).toEqual(['apple', 'mango', 'zebra']);
  });

  it('.entries aligns keys and values under sorted key order', async () => {
    const result = await run(
      'dict[zebra: 1, apple: 2, mango: 3] -> .entries => $e\n$e == list[tuple["apple", 2], tuple["mango", 3], tuple["zebra", 1]]'
    );
    expect(result).toBe(true);
  });

  rule('dict.entries-type').it(
    '.entries of a dict and of an ordered has type list(tuple(string, number))',
    async () => {
      const dictEntries = 'dict[b: 2, a: 1] -> .entries => $e\n';
      expect(
        await run(`${dictEntries}$e == list[tuple["a", 1], tuple["b", 2]]`)
      ).toBe(true);
      expect(
        await run(`${dictEntries}$e.^type == list(tuple(string, number))`)
      ).toBe(true);
      const orderedEntries = 'ordered[b: 2, a: 1] -> .entries => $e\n';
      expect(
        await run(`${orderedEntries}$e == list[tuple["b", 2], tuple["a", 1]]`)
      ).toBe(true);
      expect(
        await run(`${orderedEntries}$e.^type == list(tuple(string, number))`)
      ).toBe(true);
    }
  );

  it('sorts number-spelled keys as strings, so "10" precedes "9"', async () => {
    const result = await run('dict[9: "a", 10: "b", 1: "c"] -> .keys');
    expect(result).toEqual(['1', '10', '9']);
  });

  it('.values follows the same sorted key order as .keys and .entries', async () => {
    const result = await run('dict[zebra: 1, apple: 2, mango: 3] -> .values');
    expect(result).toEqual([2, 3, 1]);
  });

  it('doc example: dict[name: "test", count: 42] -> .keys yields sorted keys', async () => {
    const result = await run('dict[name: "test", count: 42] -> .keys');
    expect(result).toEqual(['count', 'name']);
  });
});
