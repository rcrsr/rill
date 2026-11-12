/**
 * Rill Language Tests: Atom versus comment spelling
 *
 * `#` followed by an identifier start is an atom; `#` followed by anything
 * else is a comment. An atom that directly follows an expression on the same
 * line is rejected, because it is almost certainly a comment missing its space.
 */

import { describe, expect, it } from 'vitest';
import { parse, parseWithRecovery, tokenize, TOKEN_TYPES } from '@rcrsr/rill';

const TRAILING =
  "directly follows an expression on the same line; a comment needs a space after '#'";

function parseError(src: string): { errorId: string; message: string } {
  try {
    parse(src);
  } catch (e) {
    const err = e as { errorId?: string; message: string };
    return { errorId: err.errorId ?? '', message: err.message };
  }
  throw new Error(`expected parse to fail: ${src}`);
}

describe('Atom versus comment tokens', () => {
  it.each(['#ok', '#wired', '#_x', '#A1_b'])(
    'tokenizes %s as exactly one ATOM token',
    (src) => {
      const tokens = tokenize(src, undefined, { includeComments: true });
      const atoms = tokens.filter((t) => t.type === TOKEN_TYPES.ATOM);
      const comments = tokens.filter((t) => t.type === TOKEN_TYPES.COMMENT);
      expect(atoms).toHaveLength(1);
      expect(comments).toHaveLength(0);
    }
  );

  it.each(['# c', '#', '##', '#!x', '#1', '#-'])(
    'tokenizes %s as a COMMENT',
    (src) => {
      const tokens = tokenize(src, undefined, { includeComments: true });
      expect(tokens.some((t) => t.type === TOKEN_TYPES.COMMENT)).toBe(true);
      expect(tokens.some((t) => t.type === TOKEN_TYPES.ATOM)).toBe(false);
    }
  );
});

describe('Atom directly after an expression', () => {
  it.each([
    ['1 #note', 'note'],
    ['$x #A', 'A'],
    ['"s" #todo', 'todo'],
    ['$x -> .upper #a', 'a'],
    ['list[1] #a', 'a'],
    ['{ 1 #note }', 'note'],
    ['list[1] -> seq({ $ #x })', 'x'],
    ['#todo #fixme', 'fixme'],
  ])('rejects %s with RILL-P024', (src, name) => {
    const err = parseError(src);
    expect(err.errorId).toBe('RILL-P024');
    expect(err.message).toContain(`Atom #${name} ${TRAILING}`);
  });

  it.each([
    ['#TODO fix this later', 'TODO', 'fix'],
    ['#todo return early', 'todo', 'return'],
  ])('rejects %s with the bare-word message', (src, name, word) => {
    const err = parseError(src);
    expect(err.errorId).toBe('RILL-P024');
    expect(err.message).toContain(
      `Atom #${name} is followed by '${word}' on the same line; a comment needs a space after '#'`
    );
  });

  it('rejects an atom after a dict field value', () => {
    expect(parseError('dict[a: 1 #x]').message).toContain(
      "a comment needs a space after '#'"
    );
  });

  it.each([
    'atom #wired',
    'list(atom) #a',
    '$v.!code == #ok',
    'true ? #a ! #b',
    'list[#a, #b]',
    '#a\n1',
  ])('accepts %j', (src) => {
    expect(() => parse(src)).not.toThrow();
  });

  it('does not report the comment-spelling error for an atom after a pipe', () => {
    expect(parseError('$x -> #a').errorId).not.toBe('RILL-P024');
  });

  it('recovers after the error and still parses the next statement', () => {
    const result = parseWithRecovery('1 #note\n2');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.errorId).toBe('RILL-P024');
    expect(result.ast.statements.length).toBeGreaterThanOrEqual(2);
    const last = result.ast.statements[result.ast.statements.length - 1];
    expect(last?.type).toBe('Statement');
  });
});
