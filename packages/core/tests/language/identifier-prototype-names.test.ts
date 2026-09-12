/**
 * Rill Language Tests: identifiers named after Object.prototype members.
 *
 * The lexer previously looked up identifier text in the KEYWORDS table with
 * `KEYWORDS[value] ?? TOKEN_TYPES.IDENTIFIER`. Because KEYWORDS is a plain
 * JS object, names inherited from Object.prototype (`toString`,
 * `constructor`, `valueOf`, `hasOwnProperty`, `__proto__`) resolved through
 * the prototype chain instead of falling through to IDENTIFIER, producing a
 * non-token-type value for the token. These tests confirm such identifiers
 * lex and parse as ordinary identifiers/keys, and that real keywords are
 * unaffected.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  execute,
  parse,
  TOKEN_TYPES,
  tokenize,
} from '@rcrsr/rill';
import { isInvalid } from '../../src/runtime/core/types/status.js';

async function run(code: string) {
  const ctx = createRuntimeContext({});
  const result = await execute(parse(code), ctx);
  return result.result;
}

const PROTOTYPE_NAMES = [
  'toString',
  'constructor',
  'valueOf',
  'hasOwnProperty',
  '__proto__',
];

describe('identifiers named after Object.prototype members', () => {
  it.each(PROTOTYPE_NAMES)(
    'lexes "%s" as an IDENTIFIER token, not a keyword',
    (name) => {
      const tokens = tokenize(name);
      expect(typeof tokens[0]?.type).toBe('string');
      expect(tokens[0]?.type).toBe(TOKEN_TYPES.IDENTIFIER);
    }
  );

  it('real keyword "true" still lexes as its keyword token type', () => {
    const tokens = tokenize('true');
    expect(tokens[0]?.type).toBe(TOKEN_TYPES.TRUE);
    expect(tokens[0]?.type).not.toBe(TOKEN_TYPES.IDENTIFIER);
  });

  it('real keyword "while" still lexes as its keyword token type', () => {
    const tokens = tokenize('while');
    expect(tokens[0]?.type).toBe(TOKEN_TYPES.WHILE);
  });

  it('dict[toString: 1] parses and $d.toString reads 1', async () => {
    const result = await run('dict[toString: 1] => $d\n$d.toString');
    expect(result).toBe(1);
  });

  it('1 => $valueOf works as a plain variable binding', async () => {
    const result = await run('1 => $valueOf\n$valueOf');
    expect(result).toBe(1);
  });

  it('$d.valueOf halts on a missing field, not a parse error', async () => {
    const result = await run('dict[a: 1] => $d\nguard { $d.valueOf }');
    expect(isInvalid(result as never)).toBe(true);
  });

  it('|constructor| ($constructor) => $f defines a closure usable as $f(3)', async () => {
    const result = await run('|constructor| ($constructor) => $f\n$f(3)');
    expect(result).toBe(3);
  });

  it('dict[] -> :?dict(hasOwnProperty: number) parses a type name field', async () => {
    const result = await run(
      'dict[hasOwnProperty: 5] -> :?dict(hasOwnProperty: number)'
    );
    expect(result).toBe(true);
  });

  it('dict["toString": 1] still works with a quoted key', async () => {
    const result = await run('dict["toString": 1] => $d\n$d.toString');
    expect(result).toBe(1);
  });
});
