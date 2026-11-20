/**
 * Rill Runtime Tests: held-block gate
 *
 * Covers the held-block brand, the entry gate that rejects held blocks in
 * collections, and the unnamed-param display names in marshalArgs messages.
 */

import { describe, expect, it } from 'vitest';
import {
  createRuntimeContext,
  type RillParam,
  type RillValue,
  type ScriptCallable,
} from '@rcrsr/rill';
import { marshalArgs } from '../../src/runtime/core/callable.js';
import { anyTypeValue } from '../../src/runtime/core/types/any-type.js';
import {
  createOrdered,
  createTuple,
} from '../../src/runtime/core/types/constructors.js';
import {
  isHeldBlock,
  rejectHeldEntries,
} from '../../src/runtime/core/types/held-block.js';
import { RuntimeHaltSignal } from '../../src/runtime/core/types/halt.js';
import { getStatus } from '../../src/runtime/core/types/status.js';
import { atomName } from '../../src/runtime/core/types/atom-registry.js';
import { hostFn } from '../helpers/host.js';
import { run } from '../helpers/runtime.js';

const SITE = { fn: 'test' };

function makeCallable(held: boolean): ScriptCallable {
  const base: ScriptCallable = {
    __type: 'callable',
    kind: 'script',
    params: [],
    body: { type: 'Block', statements: [], span: {} } as never,
    definingScope: createRuntimeContext(),
    isProperty: false,
    annotations: {},
    returnType: anyTypeValue,
  };
  return held ? { ...base, held: true } : base;
}

function captureHalt(fn: () => void): RuntimeHaltSignal {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuntimeHaltSignal) return e;
    throw e;
  }
  throw new Error('expected a halt');
}

function param(name: string): RillParam {
  return { name, type: undefined, defaultValue: undefined, annotations: {} };
}

describe('isHeldBlock', () => {
  it('returns true for a held callable', () => {
    expect(isHeldBlock(makeCallable(true))).toBe(true);
  });

  it('returns false for a non-held callable', () => {
    expect(isHeldBlock(makeCallable(false))).toBe(false);
  });

  it('returns false for non-callable values', () => {
    expect(isHeldBlock(1)).toBe(false);
  });
});

describe('rejectHeldEntries', () => {
  it('direct halts on a top-level held dict entry', () => {
    const value: RillValue = { a: 1, b: makeCallable(true) };
    const halt = captureHalt(() =>
      rejectHeldEntries(value, 'seq', SITE, 'direct')
    );
    const status = getStatus(halt.value);
    expect(atomName(status.code)).toBe('TYPE_MISMATCH');
    expect(String(status.raw['message'])).toContain('seq');
    expect(String(status.raw['message'])).toContain("'b'");
    expect(halt.catchable).toBe(true);
  });

  it('direct halts on a held list entry naming the index', () => {
    const halt = captureHalt(() =>
      rejectHeldEntries([1, makeCallable(true)], 'fan', SITE, 'direct')
    );
    expect(String(getStatus(halt.value).raw['message'])).toContain('index 1');
  });

  it('direct halts on held tuple and ordered entries', () => {
    expect(() =>
      rejectHeldEntries(createTuple([makeCallable(true)]), 'op', SITE, 'direct')
    ).toThrow(RuntimeHaltSignal);
    expect(() =>
      rejectHeldEntries(
        createOrdered([['k', makeCallable(true)]]),
        'op',
        SITE,
        'direct'
      )
    ).toThrow(RuntimeHaltSignal);
  });

  it('direct ignores a nested held entry', () => {
    const value: RillValue = { inner: [makeCallable(true)] };
    expect(() => rejectHeldEntries(value, 'op', SITE, 'direct')).not.toThrow();
  });

  it('direct ignores a non-held callable entry', () => {
    expect(() =>
      rejectHeldEntries({ f: makeCallable(false) }, 'op', SITE, 'direct')
    ).not.toThrow();
  });

  it('deep halts on a nested held entry', () => {
    const value: RillValue = { inner: [1, { f: makeCallable(true) }] };
    const halt = captureHalt(() =>
      rejectHeldEntries(value, 'op', SITE, 'deep')
    );
    expect(String(getStatus(halt.value).raw['message'])).toContain("'f'");
  });

  it('halts catchably so guard can recover it', () => {
    const halt = captureHalt(() =>
      rejectHeldEntries({ a: makeCallable(true) }, 'op', SITE, 'direct')
    );
    expect(halt.catchable).toBe(true);
  });

  it('is recoverable through guard as #TYPE_MISMATCH naming op and entry', async () => {
    const result = await run(
      'guard { reject() } => $r\nlist[($r.!code == #TYPE_MISMATCH), $r.!message]',
      {
        functions: {
          reject: hostFn({
            params: [],
            fn: () => {
              rejectHeldEntries(
                { slot: makeCallable(true) },
                'probe_op',
                SITE,
                'direct'
              );
              return '';
            },
            returnType: anyTypeValue,
          }),
        },
      }
    );
    expect(Array.isArray(result)).toBe(true);
    const [isMismatch, message] = result as RillValue[];
    expect(isMismatch).toBe(true);
    expect(String(message)).toContain('probe_op');
    expect(String(message)).toContain("'slot'");
  });
});

describe('marshalArgs unnamed param display', () => {
  it('names the unnamed $ param in a missing-argument message', () => {
    expect(() => marshalArgs([], [param('$')])).toThrow(
      "Missing argument for parameter '$'"
    );
  });

  it('names the unnamed accumulator param as $@', () => {
    expect(() => marshalArgs([1], [param('$'), param('@')])).toThrow(
      "Missing argument for parameter '$@'"
    );
  });

  it('names the unnamed $ param in a type-mismatch message', () => {
    const typed: RillParam = {
      ...param('$'),
      type: { kind: 'number' },
    };
    expect(() => marshalArgs(['x'], [typed])).toThrow(
      'Parameter type mismatch: $ expects number'
    );
  });

  it('names an unnamed param in a type-mismatch message', () => {
    const typed: RillParam = {
      ...param('@'),
      type: { kind: 'number' },
    };
    expect(() => marshalArgs(['x'], [typed])).toThrow(
      'Parameter type mismatch: $@ expects number'
    );
  });
});
