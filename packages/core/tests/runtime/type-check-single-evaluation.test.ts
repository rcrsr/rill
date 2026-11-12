/**
 * Rill Runtime Tests: a type check evaluates its operand once
 *
 * `expr:?type` reads the operand a single time, so a call with a side
 * effect runs once.
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  type RillFunctionDefinition,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

function counter(): {
  calls: () => number;
  functions: Record<string, RillFunctionDefinition>;
} {
  let calls = 0;
  return {
    calls: () => calls,
    functions: {
      count: {
        params: [],
        returnType: anyTypeValue,
        fn: (): RillValue => ++calls,
      },
    },
  };
}

describe('Rill Runtime: type check evaluates its operand once', () => {
  it('calls the operand once for a postfix check', async () => {
    const c = counter();
    expect(await run('count():?number', { functions: c.functions })).toBe(true);
    expect(c.calls()).toBe(1);
  });

  it('calls the operand once for a postfix check that fails', async () => {
    const c = counter();
    expect(await run('count():?string', { functions: c.functions })).toBe(
      false
    );
    expect(c.calls()).toBe(1);
  });

  it('calls the operand once for a piped check', async () => {
    const c = counter();
    expect(await run('count() -> :?number', { functions: c.functions })).toBe(
      true
    );
    expect(c.calls()).toBe(1);
  });

  it('checks the piped value when no operand is written', async () => {
    expect(await run('"a" -> :?string')).toBe(true);
    expect(await run('"a" -> :?number')).toBe(false);
  });
});
