/**
 * Rill Language Tests: Atom literals and `:atom` primitive
 *
 * Covers (Phase 1):
 * - FR-ERR-2/3: Atom literals `#NAME` parse into AtomLiteralNode.
 * - Atoms are identified and compared by name; any valid name is an atom.
 * - EC-12: Parse-time malformed atoms produce a RecoveryErrorNode.
 *
 * Deferred to Phase 2 (evaluator support for AtomLiteralNode):
 * - Running `#TIMEOUT == #TIMEOUT` end-to-end inside a rill script.
 *   The language-level identity test uses AST + registry assertions
 *   while the AtomLiteral evaluator is still landing.
 */

import { describe, expect, it } from 'vitest';
import {
  atomName,
  createRuntimeContext,
  deserializeValue,
  execute,
  isAtom,
  parse,
  ParseError,
  parseWithRecovery,
  resolveAtom,
  type RillAtomValue,
} from '@rcrsr/rill';
import { ERROR_IDS } from '../../src/error-registry.js';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/types/halt.js';

/** Run a script and return its final value. */
async function runScript(src: string): Promise<unknown> {
  const ast = parse(src);
  const ctx = createRuntimeContext({});
  const { result } = await execute(ast, ctx);
  return result;
}

/**
 * Unwraps a script's first statement and returns the head primary of its
 * pipe chain. Language tests use this to inspect the first expression node
 * without threading through the full AST shape each time.
 */
function firstPrimary(source: string): unknown {
  const ast = parse(source);
  const stmt = ast.statements[0];
  if (!stmt || stmt.type !== 'Statement') {
    throw new Error(
      `Expected Statement at index 0, got ${stmt ? stmt.type : 'undefined'}`
    );
  }
  // Statement -> PipeChain -> head (PostfixExpr) -> primary
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expr = (stmt as any).expression;
  return expr.head.primary;
}

describe('Atom literals (#NAME)', () => {
  describe('Parser (FR-ERR-2/3)', () => {
    it('parses #TIMEOUT into an AtomLiteralNode', () => {
      const primary = firstPrimary('#TIMEOUT');
      expect(primary).toMatchObject({
        type: 'AtomLiteral',
        name: 'TIMEOUT',
      });
    });

    it('parses a well-formed but unregistered atom #FOO', () => {
      const primary = firstPrimary('#FOO');
      expect(primary).toMatchObject({
        type: 'AtomLiteral',
        name: 'FOO',
      });
    });

    it('parses underscored uppercase names #RATE_LIMIT', () => {
      const primary = firstPrimary('#RATE_LIMIT');
      expect(primary).toMatchObject({
        type: 'AtomLiteral',
        name: 'RATE_LIMIT',
      });
    });

    it('the reserved sentinel #ok is not a script-authorable atom literal', () => {
      // The lexer only emits an ATOM token for `#` followed by an uppercase
      // letter, so `#ok` is consumed as a comment (no tokens emitted).
      // The `ok` atom is reachable only through the registry (`resolveAtom("ok")`)
      // or via the runtime `#ok` constant produced by the evaluator for the
      // empty status sidecar; it is not a parseable source-level literal.
      const ast = parse('#ok');
      expect(ast.statements).toHaveLength(0);
    });
  });

  describe('Parse-time malformed atom (EC-12)', () => {
    it('throws on strict parse for a mixed-case atom (#Timeout)', () => {
      // readAtom accepts any identifier character after the uppercase
      // first letter, so #Timeout tokenises successfully. The parser's
      // ATOM_NAME_SHAPE regex then rejects it; strict parse reports the
      // shape violation and throws instead of silently returning a
      // RecoveryErrorNode.
      expect(() => firstPrimary('#Timeout')).toThrow(/Invalid atom name/);
    });

    it('produces a RecoveryErrorNode with a RILL_P004 diagnostic under recovery parsing', () => {
      const result = parseWithRecovery('#Timeout');
      expect(result.success).toBe(false);
      expect(result.errors[0]?.errorId).toBe(ERROR_IDS.RILL_P004);
      const stmt = result.ast.statements[0];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expr = (stmt as any).expression;
      const primary = expr.head.primary;
      expect(primary).toMatchObject({
        type: 'RecoveryError',
        text: '#Timeout',
      });
    });

    it('parses a well-formed atom as AtomLiteralNode (no recovery)', () => {
      const primary = firstPrimary('#TIMEOUT');
      expect(primary).toMatchObject({
        type: 'AtomLiteral',
        name: 'TIMEOUT',
      });
    });
  });
});

/** Run a script that must halt and return the halt's status code name. */
async function haltCode(src: string): Promise<string> {
  try {
    await runScript(src);
  } catch (e) {
    if (e instanceof RuntimeHaltSignal) {
      return getStatus(e.value).code.name;
    }
    throw e;
  }
  throw new Error('expected the script to halt');
}

describe('Atoms are identified by name', () => {
  it('resolveAtom returns the shared object for builtin names', () => {
    expect(resolveAtom('TIMEOUT')).toBe(resolveAtom('TIMEOUT'));
    expect(atomName(resolveAtom('RATE_LIMIT'))).toBe('RATE_LIMIT');
  });

  it('resolveAtom returns equal-named atoms for non-builtin names', () => {
    const a = resolveAtom('WIRED');
    const b = resolveAtom('WIRED');
    expect(atomName(a)).toBe('WIRED');
    expect(a.name).toBe(b.name);
  });

  it('#TIMEOUT == #TIMEOUT is true', async () => {
    expect(await runScript('#TIMEOUT == #TIMEOUT')).toBe(true);
  });

  it('#TIMEOUT == #NOT_FOUND is false', async () => {
    expect(await runScript('#TIMEOUT == #NOT_FOUND')).toBe(false);
  });

  it('#TIMEOUT -> string is the bare name', async () => {
    expect(await runScript('#TIMEOUT -> string')).toBe('TIMEOUT');
  });

  it('"TIMEOUT" -> atom equals #TIMEOUT', async () => {
    expect(await runScript('("TIMEOUT" -> atom) == #TIMEOUT')).toBe(true);
  });

  it('#WIRED is an atom named WIRED', async () => {
    const result = await runScript('#WIRED');
    expect(isAtom(result as never)).toBe(true);
    expect(atomName((result as RillAtomValue).atom)).toBe('WIRED');
  });

  it('#WIRED == #R001 is false', async () => {
    expect(await runScript('#WIRED == #R001')).toBe(false);
  });

  it('#WIRED -> string is "WIRED"', async () => {
    expect(await runScript('#WIRED -> string')).toBe('WIRED');
  });

  it('a lowercase name round-trips through atom and string', async () => {
    expect(await runScript('("wired" -> atom) -> string')).toBe('wired');
  });

  it('mixed-case and underscore names convert', async () => {
    const wired = (await runScript('"Wired" -> atom')) as RillAtomValue;
    const mixed = (await runScript('"A1_b" -> atom')) as RillAtomValue;
    expect(atomName(wired.atom)).toBe('Wired');
    expect(atomName(mixed.atom)).toBe('A1_b');
  });

  it('"ok" -> atom is an atom named ok', async () => {
    const result = (await runScript('"ok" -> atom')) as RillAtomValue;
    expect(isAtom(result as never)).toBe(true);
    expect(atomName(result.atom)).toBe('ok');
  });

  it('the status code of a valid value equals "ok" -> atom', async () => {
    const src = `
      "x" => $v
      $v.!code == ("ok" -> atom)
    `;
    expect(await runScript(src)).toBe(true);
  });

  it('list[#WIRED] == list[#WIRED] is true', async () => {
    expect(await runScript('list[#WIRED] == list[#WIRED]')).toBe(true);
  });

  it.each(['"1x"', '""', '"   "'])(
    '%s -> atom halts #INVALID_INPUT',
    async (literal) => {
      expect(await haltCode(`${literal} -> atom`)).toBe('INVALID_INPUT');
    }
  );

  it('guard turns an invalid-name conversion into an invalid value', async () => {
    const result = await runScript('guard { "1x" -> atom }');
    expect(isInvalid(result as never)).toBe(true);
    expect(getStatus(result as never).code).toBe(resolveAtom('INVALID_INPUT'));
  });

  it('`.!code -> string` on the caught halt reports "INVALID_INPUT"', async () => {
    const src = `
      guard { "1x" -> atom } => $r
      $r.!code -> string
    `;
    expect(await runScript(src)).toBe('INVALID_INPUT');
  });
});

describe(':atom primitive via deserialize', () => {
  it('deserializing a builtin atom name yields an atom of that name', () => {
    const code = deserializeValue('TIMEOUT', 'atom') as RillAtomValue;
    expect(isAtom(code)).toBe(true);
    expect(atomName(code.atom)).toBe('TIMEOUT');
  });

  it('deserializing a non-builtin name yields an atom of that name', () => {
    const code = deserializeValue('WIRED', 'atom') as RillAtomValue;
    expect(isAtom(code)).toBe(true);
    expect(atomName(code.atom)).toBe('WIRED');
  });

  it('deserializing an invalid name halts #INVALID_INPUT', () => {
    try {
      deserializeValue('1x', 'atom');
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeHaltSignal);
      expect(getStatus((e as RuntimeHaltSignal).value).code.name).toBe(
        'INVALID_INPUT'
      );
      return;
    }
    throw new Error('expected deserializeValue to halt');
  });
});

describe('isAtom safety (EC-4, AC-27)', () => {
  it('EC-4: returns false without throwing for arbitrary non-atom inputs', () => {
    // `isAtom` must be total: it accepts `unknown` and returns a boolean
    // for every input, never throwing.
    expect(isAtom(null)).toBe(false);
    expect(isAtom(undefined)).toBe(false);
    expect(isAtom({})).toBe(false);
    expect(isAtom('string')).toBe(false);
    expect(isAtom(42)).toBe(false);
    expect(isAtom(true)).toBe(false);
    expect(isAtom([])).toBe(false);
  });
});

// ============================================================
// PHASE 2 ACTIVATED (evaluator for AtomLiteralNode)
// ============================================================

describe('Atom runtime evaluation (Phase 2)', () => {
  it('evaluates #TIMEOUT to a :atom value named TIMEOUT', async () => {
    const ast = parse('#TIMEOUT');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect(atomName((result as RillAtomValue).atom)).toBe('TIMEOUT');
  });
});

// ============================================================
// POST-RENAME LEGACY SYNTAX REGRESSION (EC-8, EC-9, AC-24, AC-25)
// ============================================================

describe('Legacy `:code` type syntax rejected after rename', () => {
  it('EC-9 / AC-25: bare `:code("TIMEOUT")` statement produces a parse error', () => {
    // When `:code("TIMEOUT")` appears at the head of a statement (not as a
    // pipe target), the parser rejects the leading `:` via the existing
    // dispatch failure path before any type-name validation runs. The
    // exact shape is "Unexpected token: :" from the statement-head
    // dispatcher; this test guards the broader "parse error or
    // unknown-operator error" contract from the spec.
    expect(() => parse(':code("TIMEOUT")')).toThrow(/Unexpected token: :/);
  });

  it('rejects `code` as a type name while `atom` stays allowed', () => {
    let caught: unknown;
    try {
      parse('"x" -> :code("TIMEOUT")');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect((caught as ParseError).errorId).toBe('RILL-P003');
    const message = (caught as ParseError).message;
    expect(message).toMatch(/\batom\b/);
    expect(message).not.toMatch(/expected:.*\bcode\b/);
    expect(() => parse('"abc" => $x\n$x :atom')).not.toThrow();
  });
});
