/**
 * Rill Language Tests: DictEntry keyForm metadata
 * AST-inspection tests verifying keyForm is set correctly by the parser.
 */

import { describe, expect, it } from 'vitest';
import { type DictEntryNode, parse } from '@rcrsr/rill';
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

  it('number key leaves keyForm undefined', () => {
    const ast = parse('dict[1: "x"]');
    const entry = findFirst(ast, 'DictEntry') as DictEntryNode;
    expect(entry).toBeTruthy();
    expect('keyForm' in entry).toBe(false);
  });

  it('boolean key leaves keyForm undefined', () => {
    const ast = parse('dict[true: "x"]');
    const entry = findFirst(ast, 'DictEntry') as DictEntryNode;
    expect(entry).toBeTruthy();
    expect('keyForm' in entry).toBe(false);
  });

  it('synthesized pass<> option entry has keyForm identifier', () => {
    const ast = parse('42 -> pass<on_error: #IGNORE> { $1 }');
    const passBlock = findFirst(ast, 'PassBlock') as {
      options: { entries: DictEntryNode[] };
    };
    expect(passBlock).toBeTruthy();
    const entry = passBlock.options.entries[0];
    expect(entry).toBeTruthy();
    expect(entry.keyForm).toBe('identifier');
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
