/**
 * Rill Language Tests: Atom literals and `:atom` primitive
 *
 * Covers (Phase 1):
 * - FR-ERR-2/3: Atom literals `#NAME` parse into AtomLiteralNode.
 * - AC-3: Atoms with the same name share identity across references.
 * - EC-12: Parse-time malformed atoms produce a RecoveryErrorNode.
 * - EC-13: Unregistered well-formed name via `:atom` deserialize path
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
  atomName,
  createRuntimeContext,
  deserializeValue,
  execute,
  isAtom,
  parse,
  resolveAtom,
  type RillAtomValue,
} from '@rcrsr/rill';

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

describe(':atom primitive via deserialize (EC-13)', () => {
  it('deserializing a registered atom name yields a :atom value with identity-equal atom', () => {
    const code = deserializeValue('TIMEOUT', 'atom') as RillAtomValue;
    expect(isAtom(code)).toBe(true);
    expect(code.atom).toBe(resolveAtom('TIMEOUT'));
    expect(atomName(code.atom)).toBe('TIMEOUT');
  });

  it('EC-13: deserializing an unregistered name yields a :atom whose atom is #R001', () => {
    const code = deserializeValue(
      'DEFINITELY_NOT_REGISTERED',
      'atom'
    ) as RillAtomValue;
    expect(isAtom(code)).toBe(true);
    expect(code.atom).toBe(resolveAtom('R001'));
  });

  it(':atom values compare by identity across independent deserializations', () => {
    const a = deserializeValue('TIMEOUT', 'atom') as RillAtomValue;
    const b = deserializeValue('TIMEOUT', 'atom') as RillAtomValue;
    // The RillAtomValue wrappers may differ, but the interned atom is shared.
    expect(a.atom).toBe(b.atom);
  });
});

describe(':>atom pipe target (AC-8, AC-9, AC-37, AC-38)', () => {
  it('AC-8: `"TIMEOUT" -> :>atom` converts the string to the registered TIMEOUT atom', async () => {
    // AC-8 happy path: a well-formed, pre-registered atom name piped through
    // `:>atom` returns a `:atom` value whose interned atom is identity-equal
    // to the registry entry for `#TIMEOUT`. TIMEOUT is pre-registered during
    // atom-registry bootstrap, so no extra registration is required here.
    const ast = parse('"TIMEOUT" -> :>atom');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('TIMEOUT'));
    expect(atomName((result as RillAtomValue).atom)).toBe('TIMEOUT');
  });

  it('AC-9: unregistered well-formed name via `:>atom` falls back to #R001', async () => {
    // AC-9: a syntactically valid but unregistered atom name collapses to
    // the `#R001` fallback through the registry (EC-3 contract). Identity
    // equality with `resolveAtom("R001")` holds because atoms intern.
    const ast = parse('"DEFINITELY_NOT_REGISTERED_XYZ" -> :>atom');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('R001'));
  });

  it('AC-37: empty string through `:>atom` falls back to #R001', async () => {
    // AC-37: empty string is not a registered atom name; resolution falls
    // back to `#R001`. The stringConvertTo entry delegates to resolveAtom,
    // which never throws and returns the fallback atom.
    const ast = parse('"" -> :>atom');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('R001'));
  });

  it('AC-38: whitespace-only string through `:>atom` falls back to #R001', async () => {
    // AC-38: whitespace-only names are never registered, so resolution
    // collapses to `#R001` via the same fallback path as AC-37.
    const ast = parse('"   " -> :>atom');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('R001'));
  });
});

describe('isAtom safety (EC-4, AC-27)', () => {
  it('AC-27: rejects legacy `__rill_code` brand (no coercion from old marker)', () => {
    // Regression guard: prior to the atom rename, `:atom` values carried a
    // `__rill_code: true` brand. `isAtom` must NOT treat legacy-shaped
    // objects as atoms post-rename, even when they carry the old brand
    // alongside atom-shaped fields.
    const legacy = { __rill_code: true, name: 'TIMEOUT', kind: 'default' };
    expect(isAtom(legacy)).toBe(false);
  });

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
  it('evaluates #TIMEOUT to a :atom value whose atom matches the registry', async () => {
    // AtomLiteral dispatch landed in Phase 2.2 (core.ts case 'AtomLiteral');
    // the evaluator materialises a `:atom` value carrying the interned atom.
    const ast = parse('#TIMEOUT');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('TIMEOUT'));
  });

  it('evaluates unregistered #FOO to a :atom whose atom is #R001', async () => {
    // EC-12 runtime half: unregistered names collapse to #R001 via the
    // registry fallback. The evaluator resolves at Phase 2.
    const ast = parse('#FOO');
    const ctx = createRuntimeContext({});
    const { result } = await execute(ast, ctx);
    expect(isAtom(result as never)).toBe(true);
    expect((result as RillAtomValue).atom).toBe(resolveAtom('R001'));
  });
});

// ============================================================
// POST-RENAME LEGACY SYNTAX REGRESSION (EC-8, EC-9, AC-24, AC-25)
// ============================================================

describe('Legacy `:code` type syntax rejected after rename', () => {
  it('EC-8 / AC-24: `$x :code` produces an unknown-type parse error (VALID_TYPE_NAMES membership failure)', () => {
    // After the `code` -> `atom` rename, the string literal `code` is no
    // longer a member of VALID_TYPE_NAMES. The parser reaches `:code`
    // through the type-assertion path and rejects it via parseTypeName's
    // membership check, producing a ParseError. `atom` remains listed,
    // which anchors this as a regression guard for the rename.
    const src = '"abc" => $x\n$x :code';
    expect(() => parse(src)).toThrow(/Invalid type: code/);
    // Confirm the valid replacement still parses, guarding against the
    // error firing for unrelated reasons.
    expect(() => parse('"abc" => $x\n$x :atom')).not.toThrow();
  });

  it('EC-9 / AC-25: `:code("TIMEOUT")` as a pipe target produces an unknown-type parse error', () => {
    // `:code("TIMEOUT")` was the pre-rename parameterised conversion form.
    // After the rename, the parser's existing VALID_TYPE_NAMES dispatch
    // rejects `code`. The error message cites the allowed list, which
    // must contain `atom` and must NOT contain `code`.
    const src = '"x" -> :code("TIMEOUT")';
    expect(() => parse(src)).toThrow(/Invalid type: code/);
    // The error message enumerates the allowed type names. After the
    // rename `atom` is present, and the enumerated-list portion must not
    // contain `code`.
    try {
      parse(src);
      expect.unreachable('expected ParseError');
    } catch (e) {
      const msg = (e as Error).message;
      // `atom` appears in the allowed list.
      expect(msg).toMatch(/expected:[^)]*\batom\b/);
      // `code` appears only in the "Invalid type: code" prefix, NOT in
      // the enumerated allowed list.
      expect(msg).not.toMatch(/expected:[^)]*\bcode\b/);
    }
  });

  it('EC-9 / AC-25: bare `:code("TIMEOUT")` statement produces a parse error', () => {
    // When `:code("TIMEOUT")` appears at the head of a statement (not as a
    // pipe target), the parser rejects the leading `:` via the existing
    // dispatch failure path before any type-name validation runs. The
    // exact shape is "Unexpected token: :" from the statement-head
    // dispatcher; this test guards the broader "parse error or
    // unknown-operator error" contract from the spec.
    expect(() => parse(':code("TIMEOUT")')).toThrow(/Unexpected token: :/);
  });
});
