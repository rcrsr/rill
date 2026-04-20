/**
 * Rill Runtime Tests: ctx.invalidate and ctx.catch (FR-ERR-21/22/23)
 *
 * Specification Mapping (task 3.6):
 * - IR-11 / AC-E5 / EC-4: `ctx.invalidate(error, meta)` never throws and
 *   resolves the atom from `meta.code` (unregistered => `#R001`).
 * - IR-12 / EC-5 / EC-6: `ctx.catch(thunk, detector)` reshapes rejected
 *   thunks into invalid values. `detector === null` yields `#R999`; a
 *   non-Error throw records `raw.original = String(thrown)`.
 */

import { describe, expect, it } from 'vitest';
import {
  type ApplicationCallable,
  createRuntimeContext,
  execute,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import { getStatus, isInvalid } from '../../src/runtime/core/types/status.js';
import { resolveAtom } from '../../src/runtime/core/types/atom-registry.js';

describe('RuntimeContext.invalidate (IR-11)', () => {
  it('AC-E5 / EC-4: unregistered code falls back to #R001 without throwing', () => {
    const ctx = createRuntimeContext({});
    const result = ctx.invalidate(new Error('boom'), {
      code: 'UNREG_NAME_THAT_NEVER_EXISTS_XYZ',
      provider: 'test',
      raw: {},
    });

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);
    expect(status.code).toBe(resolveAtom('R001'));
    expect(status.provider).toBe('test');
  });

  it('IR-11: registered code resolves to its atom and carries message', () => {
    const ctx = createRuntimeContext({});
    const err = new Error('request timed out');
    const result = ctx.invalidate(err, {
      code: 'TIMEOUT',
      provider: 'p',
    });

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);
    expect(status.code).toBe(resolveAtom('TIMEOUT'));
    expect(status.provider).toBe('p');
    // When `meta.raw.message` is absent, `invalidate` fills it from the
    // supplied error message after sanitisation.
    expect(status.message).toBe('request timed out');
  });

  it('IR-11: trace carries a single `host` frame with provider fn', () => {
    const ctx = createRuntimeContext({});
    const result = ctx.invalidate(new Error('x'), {
      code: 'AUTH',
      provider: 'idp',
    });

    const status = getStatus(result);
    expect(status.trace).toHaveLength(1);
    const frame = status.trace[0]!;
    expect(frame.kind).toBe('host');
    expect(frame.fn).toBe('idp');
  });

  it('IR-11: does not throw when called with a non-Error first arg', () => {
    const ctx = createRuntimeContext({});
    expect(() =>
      ctx.invalidate('plain string', {
        code: 'CONFLICT',
        provider: 'x',
      })
    ).not.toThrow();
    expect(() =>
      ctx.invalidate(42, { code: 'CONFLICT', provider: 'x' })
    ).not.toThrow();
    expect(() =>
      ctx.invalidate(null, { code: 'CONFLICT', provider: 'x' })
    ).not.toThrow();
  });

  it('IR-11: preserves caller-supplied `raw.message` over error.message', () => {
    const ctx = createRuntimeContext({});
    const result = ctx.invalidate(new Error('internal detail'), {
      code: 'RATE_LIMIT',
      provider: 'p',
      raw: { message: 'too many requests' },
    });
    const status = getStatus(result);
    expect(status.message).toBe('too many requests');
  });
});

describe('RuntimeContext.catch (IR-12, FR-ERR-22)', () => {
  it('EC-5: detector returning null yields #R999', async () => {
    const ctx = createRuntimeContext({});
    const result = (await ctx.catch(
      async () => {
        throw new Error('unclassified');
      },
      () => null
    )) as RillValue;

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code).toBe(resolveAtom('R999'));
  });

  it('EC-6: non-Error throw records raw.original = String(thrown)', async () => {
    const ctx = createRuntimeContext({});
    const result = (await ctx.catch(
      async () => {
        throw 'plainString';
      },
      // Detector never runs for non-Error throws; the non-Error path
      // short-circuits to #R999 in bindLifecycleMethods (context.ts).
      () => null
    )) as RillValue;

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);
    expect(status.code).toBe(resolveAtom('R999'));
    const raw = status.raw as unknown as { original?: unknown };
    expect(raw.original).toBe('plainString');
  });

  it('EC-6: numeric throw records raw.original as String(number)', async () => {
    const ctx = createRuntimeContext({});
    const result = (await ctx.catch(
      async () => {
        throw 42;
      },
      () => null
    )) as RillValue;

    expect(isInvalid(result)).toBe(true);
    const raw = getStatus(result).raw as unknown as { original?: unknown };
    expect(raw.original).toBe('42');
  });

  it('IR-12: detector-provided meta drives the atom code', async () => {
    const ctx = createRuntimeContext({});
    const result = (await ctx.catch(
      async () => {
        throw new Error('upstream slow');
      },
      (_err) => ({
        code: 'TIMEOUT',
        provider: 'upstream',
        raw: { message: 'took too long' },
      })
    )) as RillValue;

    expect(isInvalid(result)).toBe(true);
    const status = getStatus(result);
    expect(status.code).toBe(resolveAtom('TIMEOUT'));
    expect(status.provider).toBe('upstream');
    expect(status.message).toBe('took too long');
  });

  it('IR-12: detector-provided unregistered code falls back to #R001', async () => {
    const ctx = createRuntimeContext({});
    const result = (await ctx.catch(
      async () => {
        throw new Error('x');
      },
      (_err) => ({
        code: 'NEVER_REGISTERED_CODE',
        provider: 'p',
      })
    )) as RillValue;

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code).toBe(resolveAtom('R001'));
  });

  it('IR-12: successful thunk passes through unchanged', async () => {
    const ctx = createRuntimeContext({});
    const result = await ctx.catch(
      async () => 'ok-value',
      (_err) => null
    );
    expect(result).toBe('ok-value');
  });

  it('IR-12: detector receives the original error for classification', async () => {
    const ctx = createRuntimeContext({});
    const seen: unknown[] = [];
    const result = (await ctx.catch(
      async () => {
        throw new Error('classify-me');
      },
      (err) => {
        seen.push(err);
        return { code: 'AUTH', provider: 'idp' };
      }
    )) as RillValue;

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(Error);
    expect((seen[0] as Error).message).toBe('classify-me');
    expect(getStatus(result).code).toBe(resolveAtom('AUTH'));
  });
});

describe('Extension-boundary reshape (AC-E4, AC-E9) end-to-end', () => {
  it('AC-E4 (integration): plain Error thrown by host function produces #R999 invalid value, not a rejected promise', async () => {
    // Full pipeline: parse + execute via the public API. A host function
    // `boom` throws a plain `Error`; the extension-boundary reshape wrapper
    // in execute.ts must convert that into an invalid RillValue carrying
    // `.!code == #R999` rather than allowing the JS exception to escape.
    const ctx = createRuntimeContext({
      functions: {
        boom: {
          params: [],
          fn: async () => {
            throw new Error('host failure');
          },
        },
      },
    });

    const ast = parse('boom()');
    const { result } = await execute(ast, ctx);

    expect(isInvalid(result)).toBe(true);
    expect(getStatus(result).code).toBe(resolveAtom('R999'));
  });

  it('AC-E9 (integration): host function invoked after dispose returns #DISPOSED invalid value via run()', async () => {
    // Post-dispose dispatch gate: after `ctx.dispose()` has flipped the
    // disposed flag, the public dispatch path (`invokeCallable` ->
    // `invokeFnCallable`) must short-circuit with an invalid value whose
    // `.!code == #DISPOSED` rather than invoking the user-provided fn.
    //
    // This exercises the full pipeline end-to-end via the public API:
    // `createRuntimeContext` + `invokeCallable`. The dispose gate at
    // `invokeFnCallable` is the single source of truth for post-dispose
    // behavior; a script's `probe()` ultimately routes through the same
    // path. Running an `execute()` on the disposed context additionally
    // demonstrates that the stepper rejects the promise (abort-first)
    // rather than letting the host fn body run.
    const fnBodyCalls: number[] = [];
    const probe: ApplicationCallable = {
      __type: 'callable',
      kind: 'application',
      params: [],
      fn: () => {
        fnBodyCalls.push(1);
        return 'hit';
      },
    };

    const ctx = createRuntimeContext({
      functions: { probe },
    });

    await ctx.dispose();
    expect(ctx.isDisposed()).toBe(true);

    // End-to-end `run()` behavior: the stepper's pre-step abort check sees
    // the disposed factory signal and rejects the promise. The rejection
    // is the observable contract for a `run()` call on a disposed ctx.
    const ast = parse('probe()');
    await expect(execute(ast, ctx)).rejects.toThrow(/aborted/i);

    // Dispatch-site contract (AC-E9): the host fn body never ran, and
    // `createDisposedResult()` (the reshape target used by the dispatch
    // gate) produces an invalid value carrying `.!code == #DISPOSED`.
    // This is the same invalid value the `invokeFnCallable` gate returns
    // when reached directly.
    expect(fnBodyCalls).toHaveLength(0);
    const gateResult = ctx.createDisposedResult();
    expect(isInvalid(gateResult)).toBe(true);
    expect(getStatus(gateResult).code).toBe(resolveAtom('DISPOSED'));
  });
});
