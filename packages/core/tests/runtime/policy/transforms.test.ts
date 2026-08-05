import { describe, it, expect } from 'vitest';
import { applyTransforms } from '../../../src/runtime/core/policy/transforms.js';
import type { TransformInvoker } from '../../../src/runtime/core/policy/transforms.js';
import { brandExtensionValue } from '../../../src/runtime/core/policy/identity.js';
import { toCallable } from '../../../src/runtime/core/callable.js';
import { anyTypeValue } from '../../../src/runtime/core/values.js';
import type { RillCallable } from '../../../src/runtime/core/callable.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';
import { expectHalt } from '../../helpers/halt.js';

const SITE = { location: undefined, sourceId: undefined, fn: 'test' };

function tagger(tag: string): RillCallable {
  return toCallable({
    fn: (args) => `${tag}(${String(args['0'])})`,
    params: [
      { name: '0', type: undefined, defaultValue: undefined, annotations: {} },
    ],
    returnType: anyTypeValue,
  });
}

/** Invoker that actually runs the callable's fn against the value. */
const run: TransformInvoker = async (transform, value) =>
  (await (transform as { fn: (a: Record<string, RillValue>) => RillValue }).fn({
    '0': value,
  })) as RillValue;

describe('applyTransforms', () => {
  it('returns the value untouched for an empty chain', async () => {
    expect(await applyTransforms([], 'raw', run, new Set(), SITE)).toBe('raw');
  });

  it('chains transforms left to right', async () => {
    const result = await applyTransforms(
      [tagger('a'), tagger('b')],
      'x',
      run,
      new Set(),
      SITE
    );
    expect(result).toBe('b(a(x))');
  });

  it('clears the in-flight set after a chain completes', async () => {
    const inFlight = new Set<RillCallable>();
    await applyTransforms([tagger('a')], 'x', run, inFlight, SITE);
    expect(inFlight.size).toBe(0);
  });

  it('clears the in-flight set when a transform throws', async () => {
    const inFlight = new Set<RillCallable>();
    const boom = tagger('boom');
    await expect(
      applyTransforms(
        [boom],
        'x',
        () => Promise.reject(new Error('transform failed')),
        inFlight,
        SITE
      )
    ).rejects.toThrow(/transform failed/);
    expect(inFlight.has(boom)).toBe(false);
  });

  it('detects a transform that re-enters itself', async () => {
    // A transform whose body calls a policed method whose own chain
    // reaches back into this same transform.
    const looping = tagger('loop');
    const inFlight = new Set<RillCallable>();

    const reentrant: TransformInvoker = async (transform, value) =>
      applyTransforms([transform], value, reentrant, inFlight, SITE);

    await expectHalt(
      () => applyTransforms([looping], 'x', reentrant, inFlight, SITE),
      { code: 'RILL_R087', messagePattern: /cycle detected/ }
    );
  });

  it('names the offending transform using its extension brand', async () => {
    const redact = tagger('redact');
    brandExtensionValue({ redact } as unknown as RillValue, 'filter');

    const inFlight = new Set<RillCallable>();
    const reentrant: TransformInvoker = async (transform, value) =>
      applyTransforms([transform], value, reentrant, inFlight, SITE);

    await expectHalt(
      () => applyTransforms([redact], 'x', reentrant, inFlight, SITE),
      { code: 'RILL_R087', messagePattern: /filter\.redact/ }
    );
  });

  it('permits the same transform again once it has finished', async () => {
    const once = tagger('t');
    const inFlight = new Set<RillCallable>();
    await applyTransforms([once], 'x', run, inFlight, SITE);
    const second = await applyTransforms([once], 'y', run, inFlight, SITE);
    expect(second).toBe('t(y)');
  });
});
