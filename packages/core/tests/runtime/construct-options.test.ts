/**
 * Runtime tests: control statement options are evaluated once per run, and
 * `timeout` stays an ordinary name outside a timeout block.
 */

import { describe, expect, it } from 'vitest';
import type { RillFunction, RillValue } from '@rcrsr/rill';
import { hostFn, hostParam } from '../helpers/host.js';
import { run } from '../helpers/runtime.js';

/** A host function that returns its argument and counts its calls. */
function countingIdentity(): { def: RillFunction; count: () => number } {
  let calls = 0;
  return {
    def: hostFn({
      params: [hostParam('value', { kind: 'any' })],
      fn: (args: Record<string, RillValue>): RillValue => {
        calls++;
        return args['value'] ?? '';
      },
    }),
    count: () => calls,
  };
}

describe('options run once per statement run', () => {
  it('evaluates retry options once across every attempt', async () => {
    const codes = countingIdentity();
    const result = await run(
      'retry(attempts: 3, on: codes(#RILL_R002)) { 1 / 0 } => $r\n$r.!',
      { functions: { codes: codes.def } }
    );
    expect(result).toBe(true);
    expect(codes.count()).toBe(1);
  });

  it('evaluates guard options once', async () => {
    const codes = countingIdentity();
    await run('guard(on: codes(#RILL_R002)) { 1 / 0 } => $r\n$r.!', {
      functions: { codes: codes.def },
    });
    expect(codes.count()).toBe(1);
  });

  it('evaluates pass options before the body', async () => {
    const flag = countingIdentity();
    const result = await run(
      '"x" -> pass(ignore_halts: flag(true)) { 1 / 0 }',
      { functions: { flag: flag.def } }
    );
    expect(result).toBe('x');
    expect(flag.count()).toBe(1);
  });
});

describe('timeout as an ordinary name', () => {
  const timeoutFn = hostFn({
    params: [hostParam('ms', { kind: 'any' })],
    fn: (args: Record<string, RillValue>): RillValue =>
      `waited ${String(args['ms'])}`,
  });

  it('stays callable as a host function without a body', async () => {
    expect(await run('timeout(5)', { functions: { timeout: timeoutFn } })).toBe(
      'waited 5'
    );
  });

  it('stays callable as a bare pipe target', async () => {
    expect(
      await run('7 -> timeout', { functions: { timeout: timeoutFn } })
    ).toBe('waited 7');
  });
});
