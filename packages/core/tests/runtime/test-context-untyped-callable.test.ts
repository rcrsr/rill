/**
 * Rill Runtime Tests: createTestContext with factory-built callables
 *
 * createTestContext must accept extension values containing a callable
 * produced by the public `callable()` factory, which declares `params: []`.
 */

import { describe, expect, it } from 'vitest';
import { callable, createTestContext, execute, parse } from '@rcrsr/rill';

describe('createTestContext accepts factory-built callables', () => {
  it('does not throw for a nested factory-built callable value', () => {
    expect(() =>
      createTestContext({
        ext: { value: { f: callable(() => 1) } },
      })
    ).not.toThrow();
  });

  it('does not throw for a top-level factory-built callable value', () => {
    expect(() =>
      createTestContext({
        f: { value: callable(() => 1) },
      })
    ).not.toThrow();
  });

  it('returns a usable runtime context', async () => {
    const ctx = createTestContext({
      ext: { value: { f: callable(() => 1) } },
    });
    const result = await execute(parse('use<ext:ext.f>()'), ctx);
    expect(result.result).toBe(1);
  });
});
