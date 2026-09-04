/**
 * Rill Runtime Tests: createTestContext with untyped callables
 *
 * Bug #279: createTestContext threw an internal TypeError
 * ("Cannot read properties of undefined (reading 'map')") when an extension
 * value contained a callable produced by the public `callable()` factory, whose
 * `params` field is `undefined` (untyped). buildNestedSource now treats an
 * undefined param list as an untyped binding instead of dereferencing it.
 */

import { describe, expect, it } from 'vitest';
import { callable, createTestContext } from '@rcrsr/rill';

describe('Bug #279: createTestContext accepts untyped callables', () => {
  it('does not throw for a nested untyped callable value', () => {
    expect(() =>
      createTestContext({
        ext: { value: { f: callable(() => 1) } },
      })
    ).not.toThrow();
  });

  it('does not throw for a top-level untyped callable value', () => {
    expect(() =>
      createTestContext({
        f: { value: callable(() => 1) },
      })
    ).not.toThrow();
  });

  it('returns a usable runtime context', () => {
    const ctx = createTestContext({
      ext: { value: { f: callable(() => 1) } },
    });
    expect(ctx).toBeDefined();
    expect(ctx.functions).toBeDefined();
  });
});
