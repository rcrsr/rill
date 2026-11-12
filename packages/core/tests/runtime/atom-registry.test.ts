/**
 * Runtime Tests: Atom primitives
 *
 * Atoms are identified by name. Builtin names resolve to one shared
 * frozen object; every other valid name resolves to a fresh frozen
 * object. `isValidAtomName` defines which names are valid.
 *
 * The module lives at `src/runtime/core/types/atom-registry.ts` and is
 * imported by path because the top-level barrel does not re-export
 * `isValidAtomName`.
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_ATOMS } from '@rcrsr/rill';
import {
  atomName,
  isValidAtomName,
  resolveAtom,
} from '../../src/runtime/core/types/atom-registry.js';

describe('atom-registry', () => {
  describe('resolveAtom', () => {
    it('returns the same reference for a builtin name resolved twice', () => {
      for (const name of BUILTIN_ATOMS) {
        expect(resolveAtom(name)).toBe(resolveAtom(name));
      }
    });

    it('returns different frozen references with equal names for a non-builtin name', () => {
      const a = resolveAtom('WIRED');
      const b = resolveAtom('WIRED');

      expect(a).not.toBe(b);
      expect(a.name).toBe(b.name);
      expect(Object.isFrozen(a)).toBe(true);
      expect(Object.isFrozen(b)).toBe(true);
    });

    it('does not resolve a non-builtin name to #R001', () => {
      expect(resolveAtom('WIRED').name).toBe('WIRED');
      expect(atomName(resolveAtom('WIRED'))).not.toBe('R001');
    });

    it('carries exactly the keys __rill_atom and name', () => {
      expect(Object.keys(resolveAtom('WIRED'))).toEqual([
        '__rill_atom',
        'name',
      ]);
      expect(Object.keys(resolveAtom('TIMEOUT'))).toEqual([
        '__rill_atom',
        'name',
      ]);
    });

    it('throws on an invalid name', () => {
      expect(() => resolveAtom('1x')).toThrow(/Invalid atom name/);
    });
  });

  describe('isValidAtomName', () => {
    it.each(['wired', 'Wired', '_x', 'A1_b', 'ok', 'a'.repeat(200)])(
      'accepts %s',
      (name) => {
        expect(isValidAtomName(name)).toBe(true);
      }
    );

    it.each(['', '1x', 'a-b', 'a b', '#a', 'é'])('rejects %j', (name) => {
      expect(isValidAtomName(name)).toBe(false);
    });
  });
});
