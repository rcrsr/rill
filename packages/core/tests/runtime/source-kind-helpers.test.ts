import { createTuple } from '@rcrsr/rill';
import type { RillValue, RillTypeName } from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';

import { throwSourceKindHalt } from '../../src/runtime/core/eval/shared.js';
import { positionalElements } from '../../src/runtime/core/types/guards.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/types/halt.js';
import { getStatus } from '../../src/runtime/core/types/status.js';

function capture(
  accepted: readonly RillTypeName[],
  value: RillValue
): RuntimeHaltSignal {
  try {
    throwSourceKindHalt({ fn: 'test' }, 'fan', accepted, value);
  } catch (e) {
    if (e instanceof RuntimeHaltSignal) return e;
    throw e;
  }
  throw new Error('expected a halt');
}

describe('throwSourceKindHalt', () => {
  it('names one kind alone', () => {
    const raw = getStatus(capture(['list'], 5).value).raw;
    expect(raw['message']).toBe('fan requires list, got number');
  });

  it('joins two kinds with or', () => {
    const raw = getStatus(capture(['list', 'tuple'], 'x').value).raw;
    expect(raw['message']).toBe('fan requires list or tuple, got string');
  });

  it('joins three kinds with a serial comma', () => {
    const raw = getStatus(capture(['list', 'tuple', 'ordered'], 5).value).raw;
    expect(raw['message']).toBe(
      'fan requires list, tuple, or ordered, got number'
    );
  });

  it('raises a catchable RILL-R002 carrying the inferred kind', () => {
    const halt = capture(['list'], 5);
    const status = getStatus(halt.value);
    expect(halt.catchable).toBe(true);
    expect(status.code.name).toBe('RILL_R002');
    expect(status.raw['got']).toBe('number');
  });
});

describe('positionalElements', () => {
  it('returns the list itself for a list', () => {
    const list: RillValue[] = [1, 2];
    expect(positionalElements(list)).toBe(list);
  });

  it('returns the entries for a tuple', () => {
    expect(positionalElements(createTuple([1, 2]))).toEqual([1, 2]);
  });

  it('returns undefined for other values', () => {
    expect(positionalElements({ a: 1 })).toBeUndefined();
    expect(positionalElements('x')).toBeUndefined();
    expect(positionalElements(5)).toBeUndefined();
  });
});
