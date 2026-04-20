/**
 * Rill Language Tests: Atom literals and `:code` primitive
 *
 * Covers (Phase 1):
 * - FR-ERR-2/3: Atom literals `#NAME` parse into AtomLiteralNode.
 * - AC-3: Atoms with the same name share identity across references.
 * - EC-12: Parse-time malformed atoms produce a RecoveryErrorNode.
 * - EC-13: Unregistered well-formed name via `:code` deserialize path
 *   returns an atom whose identity equals the pre-registered `#R001`
 *   fallback (registry behavior, `resolveAtom`).
 *
 * Deferred to Phase 2 (evaluator support for AtomLiteralNode):
 * - Running `#TIMEOUT == #TIMEOUT` end-to-end inside a rill script.
 *   The language-level identity test uses AST + registry assertions
 *   while the AtomLiteral evaluator is still landing.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  deserializeValue,
  execute,
  parse,
} from '@rcrsr/rill';
import {
  atomName,
  resolveAtom,
} from '../../src/runtime/core/types/atom-registry.js';
import { isCode } from '../../src/runtime/core/types/guards.js';
import type { RillCodeValue } from '../../src/runtime/core/types/structures.js';

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
    it('produces a RecoveryErrorNode for a mixed-case atom (#Timeout)', () => {
      // readAtom accepts any identifier character after the uppercase
      // first letter, so #Timeout tokenises successfully. The parser's
      // ATOM_NAME_SHAPE regex then rejects it and emits a RecoveryErrorNode
      // in the AST (evaluator later resolves this to #R001 per EC-12).
      const primary = firstPrimary('#Timeout');
      expect(primary).toMatchObject({
        type: 'RecoveryError',
        text: '#Timeout',
      });
      expect((primary as { message: string }).message).toMatch(
        /Invalid atom name/
      );
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

describe('Atom registry (AC-3, EC-3, EC-13)', () => {
  it('AC-3: resolveAtom returns the same reference for repeated names', () => {
    const a = resolveAtom('TIMEOUT');
    const b = resolveAtom('TIMEOUT');
    expect(a).toBe(b);
  });

  it('AC-3: pre-registered atoms identity-equal their registry entries', () => {
    const timeoutFromAtom = resolveAtom('TIMEOUT');
    const rateLimitFromAtom = resolveAtom('RATE_LIMIT');
    expect(atomName(timeoutFromAtom)).toBe('TIMEOUT');
    expect(atomName(rateLimitFromAtom)).toBe('RATE_LIMIT');
    expect(timeoutFromAtom).not.toBe(rateLimitFromAtom);
  });

  it('EC-3: unregistered name resolves to #R001 fallback', () => {
    const unregistered = resolveAtom('NEVER_REGISTERED_XYZ');
    const r001 = resolveAtom('R001');
    expect(unregistered).toBe(r001);
    expect(atomName(unregistered)).toBe('R001');
  });

  it('EC-3: two distinct unregistered names collapse to the same #R001 atom', () => {
    const a = resolveAtom('UNREG_ONE');
    const b = resolveAtom('UNREG_TWO');
    expect(a).toBe(b);
    expect(atomName(a)).toBe('R001');
  });
});

describe(':code primitive via deserialize (EC-13)', () => {
  it('deserializing a registered atom name yields a :code value with identity-equal atom', () => {
    const code = deserializeValue('TIMEOUT', 'code') as RillCodeValue;
    expect(isCode(code)).toBe(true);
    expect(code.atom).toBe(resolveAtom('TIMEOUT'));
    expect(atomName(code.atom)).toBe('TIMEOUT');
  });

  it('EC-13: deserializing an unregistered name yields a :code whose atom is #R001', () => {
    const code = deserializeValue(
      'DEFINITELY_NOT_REGISTERED',
      'code'
    ) as RillCodeValue;
    expect(isCode(code)).toBe(true);
    expect(code.atom).toBe(resolveAtom('R001'));
  });

  it(':code atoms compare by identity across independent deserializations', () => {
    const a = deserializeValue('TIMEOUT', 'code') as RillCodeValue;
    const b = deserializeValue('TIMEOUT', 'code') as RillCodeValue;
    // The RillCodeValue wrappers may differ, but the interned atom is shared.
    expect(a.atom).toBe(b.atom);
  });
});

// ============================================================
// PHASE 2 ACTIVATED (evaluator for AtomLiteralNode)
// ============================================================

describe('Atom runtime evaluation (Phase 2)', () => {
  it('evaluates #TIMEOUT to a :code value whose atom matches the registry', async () => {
    // AtomLiteral dispatch landed in Phase 2.2 (core.ts case 'AtomLiteral');
    // the evaluator materialises a `:code` value carrying the interned atom.
    const ast = parse('#TIMEOUT');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isCode(result as never)).toBe(true);
    expect((result as RillCodeValue).atom).toBe(resolveAtom('TIMEOUT'));
  });

  it('evaluates unregistered #FOO to a :code whose atom is #R001', async () => {
    // EC-12 runtime half: unregistered names collapse to #R001 via the
    // registry fallback. The evaluator resolves at Phase 2.
    const ast = parse('#FOO');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isCode(result as never)).toBe(true);
    expect((result as RillCodeValue).atom).toBe(resolveAtom('R001'));
  });
});
