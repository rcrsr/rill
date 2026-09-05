/**
 * Runtime Tests: Atom registry primitives
 *
 * Covers:
 * - AC-B7: 64-char atom registers; 65-char rejects.
 * - EC-1: double-registration with a different kind throws.
 * - EC-2: lowercase / malformed names reject.
 * - EC-3: unregistered name resolves to `#R001` fallback.
 * - AC-3: resolveAtom returns identical references across calls.
 *
 * These exercise `registerErrorCode`, `resolveAtom`, and `atomName`
 * directly. The canonical module lives at
 * `src/runtime/core/types/atom-registry.ts`; it is imported by path here
 * because the top-level barrel does not yet re-export these symbols
 * (Phase 1 keeps the registry as an internal-runtime concern).
 */

import { describe, expect, it } from 'vitest';
import { ERROR_ATOMS, ERROR_IDS } from '../../src/error-registry.js';
// Side-effect import: execute.ts registers a second batch of RILL_R* halt
// atoms (RILL_R001, RILL_R005-R009, RILL_R015, RILL_R043, RILL_R060) at
// module load. Vitest isolates module graphs per test file, so without this
// import those registrations never run and resolveAtom() for those codes
// would silently fall back to #R001 in this file alone.
import '../../src/runtime/core/execute.js';
import {
  atomName,
  registerErrorCode,
  resolveAtom,
} from '../../src/runtime/core/types/atom-registry.js';

/**
 * The `RILL_R*` keys that are actually registered as halt atoms, gathered
 * from the two registration sites (`atom-registry.ts`'s
 * `CORE_ATOM_REGISTRATIONS` and `execute.ts`'s `registerErrorCode` calls).
 * `ERROR_ATOMS` maps every `ERROR_IDS` key (the full `RILL-Lxxx` /
 * `RILL-Pxxx` / `RILL-Rxxx` / `RILL-Cxxx` surface), but only this subset is
 * ever routed through the atom registry as an emitted halt atom.
 *
 * A mechanical scan of every emitter site to confirm this list is
 * exhaustive is out of scope for this regression test; the chosen coverage
 * is a per-atom round-trip through the registry for each id already known
 * to be registered, which is what a reader relies on when adding a new
 * `RILL_R*` id to either registration site.
 */
const REGISTERED_HALT_ATOM_IDS = [
  // atom-registry.ts: CORE_ATOM_REGISTRATIONS
  ERROR_IDS.RILL_R016,
  ERROR_IDS.RILL_R002,
  ERROR_IDS.RILL_R003,
  ERROR_IDS.RILL_R010,
  ERROR_IDS.RILL_R036,
  ERROR_IDS.RILL_R037,
  ERROR_IDS.RILL_R038,
  ERROR_IDS.RILL_R040,
  ERROR_IDS.RILL_R041,
  ERROR_IDS.RILL_R042,
  ERROR_IDS.RILL_R044,
  ERROR_IDS.RILL_R054,
  ERROR_IDS.RILL_R055,
  ERROR_IDS.RILL_R056,
  ERROR_IDS.RILL_R057,
  ERROR_IDS.RILL_R058,
  ERROR_IDS.RILL_R061,
  ERROR_IDS.RILL_R082,
  ERROR_IDS.RILL_R083,
  ERROR_IDS.RILL_R012,
  // execute.ts: registerErrorCode calls
  ERROR_IDS.RILL_R043,
  ERROR_IDS.RILL_R060,
  ERROR_IDS.RILL_R001,
  ERROR_IDS.RILL_R005,
  ERROR_IDS.RILL_R006,
  ERROR_IDS.RILL_R007,
  ERROR_IDS.RILL_R008,
  ERROR_IDS.RILL_R009,
  ERROR_IDS.RILL_R015,
] as const;

describe('atom-registry', () => {
  describe('registerErrorCode (shape validation)', () => {
    it('EC-2: rejects lowercase names', () => {
      expect(() => registerErrorCode('lowercase', 'generic')).toThrow(
        /does not match uppercase pattern/
      );
    });

    it('EC-2: rejects names that start with a digit', () => {
      expect(() => registerErrorCode('1BAD', 'generic')).toThrow(
        /does not match uppercase pattern/
      );
    });

    it('EC-2: rejects names with lowercase mixed in', () => {
      expect(() => registerErrorCode('MixedCase', 'generic')).toThrow(
        /does not match uppercase pattern/
      );
    });

    it('EC-2: rejects empty string', () => {
      expect(() => registerErrorCode('', 'generic')).toThrow(
        /non-empty string/
      );
    });

    it('accepts names with digits and underscores after the first uppercase letter', () => {
      const atom = registerErrorCode('EXT_OK_V2', 'test-ac-b7');
      expect(atomName(atom)).toBe('EXT_OK_V2');
    });
  });

  describe('AC-B7: length boundary', () => {
    it('registers a 64-character name', () => {
      // 'A' followed by 63 underscores = 64 chars total, matches regex.
      const name = 'A' + '_'.repeat(63);
      expect(name).toHaveLength(64);
      const atom = registerErrorCode(name, 'boundary-ok');
      expect(atomName(atom)).toBe(name);
    });

    it('rejects a 65-character name', () => {
      const name = 'A' + '_'.repeat(64);
      expect(name).toHaveLength(65);
      expect(() => registerErrorCode(name, 'boundary-fail')).toThrow(
        /exceeds 64-character limit/
      );
    });
  });

  describe('Idempotency and EC-1', () => {
    it('returns the same atom when re-registering with the same kind', () => {
      const first = registerErrorCode('IDEMPOTENT_ATOM', 'kind-a');
      const second = registerErrorCode('IDEMPOTENT_ATOM', 'kind-a');
      expect(first).toBe(second);
    });

    it('EC-1: throws when re-registering with a different kind', () => {
      registerErrorCode('CONFLICT_ATOM', 'kind-a');
      expect(() => registerErrorCode('CONFLICT_ATOM', 'kind-b')).toThrow(
        /already registered with kind/
      );
    });
  });

  describe('resolveAtom', () => {
    it('AC-3: returns the same reference for repeated resolution', () => {
      const a = resolveAtom('TIMEOUT');
      const b = resolveAtom('TIMEOUT');
      expect(a).toBe(b);
    });

    it('AC-3: registered atom resolves to the same reference as the one returned by registerErrorCode', () => {
      const registered = registerErrorCode('RESOLVE_CONSISTENT', 'generic');
      const resolved = resolveAtom('RESOLVE_CONSISTENT');
      expect(resolved).toBe(registered);
    });

    it('EC-3: unregistered name resolves to the pre-registered #R001 fallback', () => {
      const fallback = resolveAtom('NEVER_SEEN_BEFORE_XYZ');
      const r001 = resolveAtom('R001');
      expect(fallback).toBe(r001);
      expect(atomName(fallback)).toBe('R001');
    });

    it('EC-3: never throws on unregistered names', () => {
      expect(() => resolveAtom('ALSO_UNREGISTERED')).not.toThrow();
    });

    it('pre-registered core atoms are resolvable without explicit registration', () => {
      for (const name of [
        'TIMEOUT',
        'AUTH',
        'FORBIDDEN',
        'RATE_LIMIT',
        'QUOTA_EXCEEDED',
        'UNAVAILABLE',
        'NOT_FOUND',
        'CONFLICT',
        'INVALID_INPUT',
        'PROTOCOL',
        'DISPOSED',
        'R001',
        'R999',
      ]) {
        const atom = resolveAtom(name);
        expect(atomName(atom)).toBe(name);
      }
    });

    it('the reserved sentinel #ok is pre-registered', () => {
      const ok = resolveAtom('ok');
      expect(atomName(ok)).toBe('ok');
    });
  });

  describe('atomName', () => {
    it('returns the bare uppercase name without the `#` sigil', () => {
      const atom = resolveAtom('TIMEOUT');
      expect(atomName(atom)).toBe('TIMEOUT');
    });
  });

  describe('emitted halt atoms round-trip through the registry', () => {
    it.each(
      REGISTERED_HALT_ATOM_IDS.map((id) => [id, ERROR_ATOMS[id]] as const)
    )(
      '%s (#%s) resolves to itself, never the R001 fallback',
      (_id, atomCode) => {
        const resolved = atomName(resolveAtom(atomCode));
        expect(resolved).toBe(atomCode);
        expect(resolved).not.toBe('R001');
      }
    );

    it('RILL_R012 is registered and does not fall back to R001', () => {
      const atomCode = ERROR_ATOMS[ERROR_IDS.RILL_R012];
      expect(atomName(resolveAtom(atomCode))).toBe(atomCode);
    });

    it('RILL_R040 is registered and does not fall back to R001', () => {
      const atomCode = ERROR_ATOMS[ERROR_IDS.RILL_R040];
      expect(atomName(resolveAtom(atomCode))).toBe(atomCode);
    });
  });
});
