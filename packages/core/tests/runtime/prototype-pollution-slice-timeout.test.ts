/**
 * Rill Runtime Tests: prototype-pollution hardening, fractional slice bounds,
 * and timeout timer/catchability.
 *
 * Covers three defects:
 * - #263: dict field access and dict literals must never expose or be mutated
 *   by JS-inherited members (constructor, __proto__, toString, ...).
 * - #268: slice<> with a fractional bound must halt, not emit undefined holes.
 * - #270: withTimeout must clear its timer and surface a catchable halt.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  RuntimeHaltSignal,
  getStatus,
  toNative,
  type RillValue,
} from '@rcrsr/rill';
import { mockAsyncFn, run } from '../helpers/runtime.js';
import { expectHaltMessage } from '../helpers/halt.js';

/**
 * Asserts `exec` halts with a message matching `pattern`, accepting either a
 * `RuntimeHaltSignal` (unmapped atom) or a `RuntimeError` (a catchable halt
 * whose atom is mapped to a host-facing error id at the execute() boundary).
 */
async function expectHalts(
  exec: () => Promise<unknown>,
  pattern: RegExp
): Promise<void> {
  let caught: unknown;
  try {
    await exec();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  const message =
    caught instanceof RuntimeHaltSignal
      ? getStatus(caught.value).message
      : (caught as Error).message;
  expect(message).toMatch(pattern);
}

describe('#263: dict access does not reach Object.prototype', () => {
  it('bracket access of an inherited member halts as a missing key', async () => {
    await expectHalts(
      () => run('dict[a: 1] => $d  $d["constructor"]'),
      /Undefined dict key/
    );
  });

  it('bracket access of __proto__ halts as a missing key', async () => {
    await expectHalts(
      () => run('dict[a: 1] => $d  $d["__proto__"]'),
      /Undefined dict key/
    );
  });

  it('computed access of an inherited member halts as a missing field', async () => {
    // An inherited JS member resolves as absent, so bare computed access
    // halts exactly like any missing field (never the JS function).
    await expectHalts(
      () => run('dict[a: 1] => $d  $d.("constructor")'),
      /no field/
    );
  });

  it('variable-key access of an inherited member halts as a missing field', async () => {
    await expectHalts(
      () => run('"constructor" => $k  dict[a: 1] => $d  $d.$k'),
      /no field/
    );
  });

  it('computed access of an inherited member coalesces as vacant', async () => {
    // With a default, the absent inherited member is vacant, not the JS value.
    const result = await run('dict[a: 1] => $d  $d.("constructor") ?? "gone"');
    expect(result).toBe('gone');
  });

  it('existence check of an inherited member via variable key is false', async () => {
    const result = await run('"constructor" => $k  dict[a: 1] => $d  $d.?$k');
    expect(result).toBe(false);
  });

  it('existence check of an inherited member via computed key is false', async () => {
    const result = await run('dict[a: 1] => $d  $d.?("__proto__")');
    expect(result).toBe(false);
  });

  it('an explicitly-set __proto__ key is stored as an ordinary own field', async () => {
    // The data key must be readable back...
    const readBack = await run(
      'dict[("__proto__"): dict[x: 1]] => $p  $p.("__proto__").x'
    );
    expect(readBack).toBe(1);
  });

  it('setting __proto__ as data does not reparent the dict', async () => {
    // ...and must NOT install a field `x` on the dict itself: $p.x halts.
    await expectHalts(
      () => run('dict[("__proto__"): dict[x: 1]] => $p  $p.x'),
      /no field/
    );
  });
});

describe('.at() fractional index guard', () => {
  it('a fractional list index halts with an integer-index error', async () => {
    await expectHaltMessage(
      () => run('list[1, 2, 3] -> .at(1.5)'),
      /must be an integer/
    );
  });

  it('a fractional string index halts with an integer-index error', async () => {
    await expectHaltMessage(
      () => run('"abc" -> .at(1.5)'),
      /must be an integer/
    );
  });

  it('guard recovers a fractional list index', async () => {
    const result = await run(
      'guard { list[1, 2, 3] -> .at(1.5) } => $r  $r.! ? "recovered" ! "no-halt"'
    );
    expect(result).toBe('recovered');
  });

  it('guard recovers a fractional string index', async () => {
    const result = await run(
      'guard { "abc" -> .at(1.5) } => $r  $r.! ? "recovered" ! "no-halt"'
    );
    expect(result).toBe('recovered');
  });
});

describe('setDictField rebuild sites: toNative() and JSON serialization', () => {
  it('toNative() on an own __proto__-keyed dict does not reparent the native object', async () => {
    const result = await run('dict[("__proto__"): dict[x: 1]]');
    const native = toNative(result as RillValue);
    const value = native.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value['__proto__']).toEqual({ x: 1 });
  });

  it('serializing a dict with an own __proto__ key nested inside a list preserves the field instead of reparenting', async () => {
    const jsonStr = (await run(
      'list[dict[("__proto__"): dict[x: 1]]] -> json'
    )) as string;
    const parsed = JSON.parse(jsonStr) as unknown[];
    const nested = parsed[0] as Record<string, unknown>;
    expect(Object.getPrototypeOf(nested)).toBe(Object.prototype);
    expect(Object.hasOwn(nested, '__proto__')).toBe(true);
    expect(nested['__proto__']).toEqual({ x: 1 });
  });
});

describe('#268: fractional slice bounds halt', () => {
  it('a fractional step halts with an integer-bound error', async () => {
    await expectHaltMessage(
      () => run('list[1, 2, 3, 4] -> slice<::0.5>'),
      /must be an integer/
    );
  });

  it('a fractional start halts', async () => {
    await expectHaltMessage(
      () => run('list[1, 2, 3, 4] -> slice<0.5:>'),
      /must be an integer/
    );
  });

  it('a fractional stop halts', async () => {
    await expectHaltMessage(
      () => run('list[1, 2, 3, 4] -> slice<:2.5>'),
      /must be an integer/
    );
  });

  it('integer slice bounds still work', async () => {
    const result = await run('list[1, 2, 3, 4] -> slice<0:4:2>');
    expect(result).toEqual([1, 3]);
  });
});

describe('#270: timeout timer + catchability', () => {
  it('a timeout surfaces as a catchable RuntimeHaltSignal', async () => {
    const slowFn = mockAsyncFn(200, 'done');
    let caught: unknown;
    try {
      await run('slowFn()', { functions: { slowFn }, timeout: 20 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RuntimeHaltSignal);
    expect((caught as RuntimeHaltSignal).catchable).toBe(true);
    expect(getStatus((caught as RuntimeHaltSignal).value).message).toContain(
      'timed out'
    );
  });

  it('guard recovers a timeout', async () => {
    const slowFn = mockAsyncFn(200, 'done');
    const result = await run(
      'guard { slowFn() } => $r  $r.! ? "recovered" ! "no-halt"',
      { functions: { slowFn }, timeout: 20 }
    );
    expect(result).toBe('recovered');
  });

  it('clears the timer when the wrapped call settles first (no dangling timer)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const fastFn = mockAsyncFn(1, 'done');
      const result = await run('fastFn()', {
        functions: { fastFn },
        timeout: 10_000,
      });
      expect(result).toBe('done');
      // The pending timeout timer must be cleared so a completed operation
      // does not hold the event loop open until the (large) timeout elapses.
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });
});
