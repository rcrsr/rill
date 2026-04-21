/**
 * Rill Runtime Tests: access-halt gate fast-path (Task 5.1)
 *
 * Specification Mapping:
 * - NFR-ERR-1: Zero-allocation valid path. `accessHaltGateFast` must
 *   return valid values (primitives and objects without the sidecar
 *   symbol) without constructing an AccessSite record or invoking the
 *   location producer.
 *
 * Scope: thin unit tests covering the fast-path branches. The existing
 * `access-halt.test.ts` language suite covers SM5 invalid-halt semantics.
 */

import { describe, expect, it } from 'vitest';
import {
  accessHaltGate,
  accessHaltGateFast,
  RuntimeHaltSignal,
} from '../../src/runtime/core/eval/mixins/access.js';
import { createRuntimeContext } from '@rcrsr/rill';

describe('accessHaltGateFast fast-path (NFR-ERR-1)', () => {
  it('returns a number primitive unchanged without invoking the location producer', () => {
    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };
    const result = accessHaltGateFast(42, '+', locFn, undefined);
    expect(result).toBe(42);
    expect(locCalls).toBe(0);
  });

  it('returns a string primitive unchanged without invoking the location producer', () => {
    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };
    const result = accessHaltGateFast('hi', 'arg', locFn, undefined);
    expect(result).toBe('hi');
    expect(locCalls).toBe(0);
  });

  it('returns null unchanged without invoking the location producer', () => {
    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };
    const result = accessHaltGateFast(null, '->', locFn, undefined);
    expect(result).toBe(null);
    expect(locCalls).toBe(0);
  });

  it('returns a plain object without sidecar symbol unchanged', () => {
    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };
    const obj: Record<string, unknown> = { a: 1, b: 2 };
    const result = accessHaltGateFast(obj, '.', locFn, undefined);
    expect(result).toBe(obj);
    expect(locCalls).toBe(0);
  });

  it('returns an array without sidecar symbol unchanged', () => {
    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };
    const arr = [1, 2, 3];
    const result = accessHaltGateFast(arr, '[]', locFn, undefined);
    expect(result).toBe(arr);
    expect(locCalls).toBe(0);
  });

  it('invokes the slow path when value carries an invalid sidecar', () => {
    const ctx = createRuntimeContext({});
    const invalid = ctx.invalidate(new Error('boom'), {
      code: 'R001',
      provider: 'test',
      raw: {},
    });

    let locCalls = 0;
    const locFn = (): undefined => {
      locCalls++;
      return undefined;
    };

    expect(() => accessHaltGateFast(invalid, '+', locFn, undefined)).toThrow(
      RuntimeHaltSignal
    );
    // Slow path must invoke the location producer exactly once.
    expect(locCalls).toBe(1);
  });

  it('produces the same halt behavior as the canonical accessHaltGate for invalid input', () => {
    const ctx = createRuntimeContext({});
    const invalid = ctx.invalidate(new Error('boom'), {
      code: 'R001',
      provider: 'test',
      raw: {},
    });

    let fastSignal: RuntimeHaltSignal | undefined;
    try {
      accessHaltGateFast(invalid, '+', () => undefined, undefined);
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) fastSignal = e;
    }

    let slowSignal: RuntimeHaltSignal | undefined;
    try {
      accessHaltGate(invalid, {
        location: undefined,
        sourceId: undefined,
        fn: '+',
      });
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) slowSignal = e;
    }

    expect(fastSignal).toBeInstanceOf(RuntimeHaltSignal);
    expect(slowSignal).toBeInstanceOf(RuntimeHaltSignal);
  });
});
