/**
 * Brand-value guards against the generic dict path.
 *
 * `isDict` (runtime/core/types/guards.ts) is a structural check: any plain
 * object that is not an array, callable, or tuple counts as a dict. Branded
 * runtime values (`:atom`, `^type`, `datetime`, `duration`) are plain
 * objects internally, so any call site that falls back to `isDict(input)`
 * without first excluding these brands treats a branded receiver as an
 * ordinary dict and leaks its internal fields (`__rill_atom`, `__rill_type`,
 * `__rill_datetime`, `__rill_duration`, ...) into the result instead of
 * halting.
 *
 * This suite exercises both fixed call sites:
 * - `getIterableElements` (runtime/core/eval/handlers/collections.ts), the
 *   shared expansion helper behind `seq`, `fold`, `filter`, `take`.
 * - `mFirst`/`mKeys`/`mValues`/`mEntries`
 *   (runtime/ext/builtins/methods/bodies.ts), the per-type method bodies
 *   backing `.first()`, `.keys`, `.values`, `.entries`.
 *
 * Parity is checked against the equivalent number receiver for `seq`,
 * `fold`, `filter`, and `take`: both must raise the identical error id
 * (`RILL-R002`, from `getIterableElements`).
 *
 * `.first()`/`.keys`/`.values`/`.entries` diverge per brand instead of
 * matching a single number-receiver baseline:
 * - atom/datetime/duration reach the `mFirst`/`mKeys`/`mValues`/`mEntries`
 *   fallback added here and raise `RILL-R003`, the same "wrong receiver
 *   type" class every other dict-only method in this file already raises
 *   for a non-dict receiver (`mHead`, `mTail`).
 * - typevalue (`^type`) is intercepted earlier by the type-value property
 *   protocol (`evaluateMethod` in eval/handlers/closures.ts), which raises
 *   `RILL-R009` before dispatch ever reaches the method body. This is a
 *   stricter, pre-existing guard; the `isTypeValue` check added to the
 *   method bodies is defense in depth for callers that reach the method
 *   body directly, not the path exercised by `^type -> .first()` here.
 * - a bare number receiver does not halt at all for `.keys`/`.values`/
 *   `.entries` (a pre-existing, separate leniency in the
 *   `skipReceiverValidation` fallback scan, out of this task's scope), so
 *   it is not usable as the parity baseline for those three methods.
 */

import { describe, expect, it } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

/** Rill source constructing each branded value under test, plus the error
 * id `.first()`/`.keys`/`.values`/`.entries` raise for that brand. */
const BRANDS: Record<string, { expr: string; dictFallbackErrorId: string }> = {
  atom: { expr: '#IGNORE', dictFallbackErrorId: 'RILL-R003' },
  typevalue: { expr: '42.^type', dictFallbackErrorId: 'RILL-R009' },
  datetime: { expr: 'now()', dictFallbackErrorId: 'RILL-R003' },
  duration: { expr: 'duration(1)', dictFallbackErrorId: 'RILL-R003' },
};

/** Run source and capture the rejection, failing the test if it resolves. */
async function haltOf(source: string): Promise<{
  errorId?: string;
  message?: string;
}> {
  try {
    const result = await run(source);
    throw new Error(
      `expected '${source}' to halt, but it resolved to ${JSON.stringify(result)}`
    );
  } catch (e) {
    return e as { errorId?: string; message?: string };
  }
}

describe('brand-value guards against the generic dict path', () => {
  describe.each(Object.entries(BRANDS))(
    '%s receiver',
    (_brandName, { expr, dictFallbackErrorId }) => {
      it('.first() halts instead of returning a dict iterator', async () => {
        const brandHalt = await haltOf(`${expr} -> .first()`);
        expect(brandHalt.errorId).toBe(dictFallbackErrorId);
      });

      it('.keys halts instead of returning []', async () => {
        const brandHalt = await haltOf(`${expr} -> .keys`);
        expect(brandHalt.errorId).toBe(dictFallbackErrorId);
      });

      it('.values halts instead of returning []', async () => {
        const brandHalt = await haltOf(`${expr} -> .values`);
        expect(brandHalt.errorId).toBe(dictFallbackErrorId);
      });

      it('.entries halts instead of returning []', async () => {
        const brandHalt = await haltOf(`${expr} -> .entries`);
        expect(brandHalt.errorId).toBe(dictFallbackErrorId);
      });

      it('seq halts with the same error id as a number receiver', async () => {
        const numberHalt = await haltOf('42 -> seq({ $ })');
        const brandHalt = await haltOf(`${expr} -> seq({ $ })`);
        expect(brandHalt.errorId).toBe(numberHalt.errorId);
        expect(brandHalt.errorId).toBe('RILL-R002');
      });

      it('fold halts with the same error id as a number receiver', async () => {
        const numberHalt = await haltOf('42 -> fold(0, { $@ + $ })');
        const brandHalt = await haltOf(`${expr} -> fold(0, { $@ + $ })`);
        expect(brandHalt.errorId).toBe(numberHalt.errorId);
        expect(brandHalt.errorId).toBe('RILL-R002');
      });

      it('filter halts with the same error id as a number receiver', async () => {
        const numberHalt = await haltOf('42 -> filter({ $ > 0 })');
        const brandHalt = await haltOf(`${expr} -> filter({ $ > 0 })`);
        expect(brandHalt.errorId).toBe(numberHalt.errorId);
        expect(brandHalt.errorId).toBe('RILL-R002');
      });

      it('take halts with the same error id as a number receiver', async () => {
        const numberHalt = await haltOf('42 -> take(1)');
        const brandHalt = await haltOf(`${expr} -> take(1)`);
        expect(brandHalt.errorId).toBe(numberHalt.errorId);
        expect(brandHalt.errorId).toBe('RILL-R002');
      });
    }
  );

  // sort(dict, ...) guards datetime/duration/ordered/vector receivers
  // directly in ext/builtins/functions/collections.ts (throwTypeHalt,
  // #TYPE_MISMATCH), a file outside this task's target files. atom/
  // typevalue are not yet guarded there and still leak into the dict-sort
  // path; that gap is tracked separately (see Implementation Notes) rather
  // than fixed here, since fixing it would mean editing a file this task
  // is scoped not to touch.
  describe('sort: pre-existing datetime/duration guard (regression only)', () => {
    it('halts #TYPE_MISMATCH for a datetime receiver', async () => {
      await expectHalt(() => run('now() -> sort'), { code: 'TYPE_MISMATCH' });
    });

    it('halts #TYPE_MISMATCH for a duration receiver', async () => {
      await expectHalt(() => run('duration(1) -> sort'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('regression: real dict and ordered receivers are unaffected', () => {
    it('dict .keys returns canonical key order', async () => {
      expect(await run('dict[a: 1, b: 2] -> .keys')).toEqual(['a', 'b']);
    });

    it('dict .values returns canonical value order', async () => {
      expect(await run('dict[a: 1, b: 2] -> .values')).toEqual([1, 2]);
    });

    it('dict .entries returns canonical [key, value] pairs', async () => {
      expect(await run('dict[a: 1, b: 2] -> .entries')).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('dict .first() yields an iterator over entries', async () => {
      const result = await run('dict[a: 1] -> .first()');
      expect(result).toMatchObject({
        done: false,
        value: { key: 'a', value: 1 },
      });
    });

    it('ordered .keys returns parameter names in order', async () => {
      expect(await run('ordered[a: 1, b: 2] -> .keys')).toEqual(['a', 'b']);
    });

    it('ordered .values returns argument values in order', async () => {
      expect(await run('ordered[a: 1, b: 2] -> .values')).toEqual([1, 2]);
    });

    it('ordered .entries returns [key, value] pairs in order', async () => {
      expect(await run('ordered[a: 1, b: 2] -> .entries')).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('list seq/fold/filter/sort/take still iterate normally', async () => {
      expect(await run('list[1, 2, 3] -> seq({ $ * 2 })')).toEqual([2, 4, 6]);
      expect(await run('list[1, 2, 3] -> fold(0, { $@ + $ })')).toBe(6);
      expect(await run('list[1, 2, 3] -> filter({ $ > 1 })')).toEqual([2, 3]);
      expect(await run('list[3, 1, 2] -> sort')).toEqual([1, 2, 3]);
      expect(await run('list[1, 2, 3] -> take(2)')).toEqual([1, 2]);
    });

    it('list .first() yields an iterator over elements', async () => {
      const result = await run('list[1, 2, 3] -> .first()');
      expect(result).toMatchObject({ done: false, value: 1 });
    });
  });
});
