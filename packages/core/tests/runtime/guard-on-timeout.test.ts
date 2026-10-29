/**
 * `guard<on: ...>` filtering of timeout halts.
 *
 * `timeout<total:>` expires with RILL-R082. A guard whose `on:` list omits
 * that code must re-raise the halt; a bare outer guard then recovers it.
 * Uses an injected scheduler whose timers fire after a few milliseconds. The
 * rejection is issued before the body resolves, so the outcome does not
 * depend on timing.
 */

import { describe, expect, it } from 'vitest';
import type { RillFunction, TimeoutScheduler } from '@rcrsr/rill';
import { anyTypeValue } from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';

interface ExpiringScheduler {
  readonly scheduler: TimeoutScheduler;
  readonly expired: Promise<void>;
}

// A scheduler whose timers fire fast; `expired` settles once a timer has fired.
function makeExpiringScheduler(): ExpiringScheduler {
  let markExpired: () => void = () => undefined;
  const expired = new Promise<void>((resolve) => {
    markExpired = resolve;
  });
  return {
    expired,
    scheduler: {
      setTimeout: (fn) =>
        setTimeout(() => {
          fn();
          markExpired();
        }, 5),
      clearTimeout: (handle) => clearTimeout(handle),
    },
  };
}

// A host body that stays pending until the scheduler's timer has fired.
function makeWaitForExpiry(expired: Promise<void>): RillFunction {
  return {
    params: [],
    returnType: anyTypeValue,
    fn: async () => {
      await expired;
      return 'finished';
    },
  };
}

function expiringOptions(): {
  functions: Record<string, RillFunction>;
  scheduler: TimeoutScheduler;
} {
  const { scheduler, expired } = makeExpiringScheduler();
  return { functions: { wait: makeWaitForExpiry(expired) }, scheduler };
}

const TIMEOUT = 'timeout<total: duration(0,0,1)> { wait() }';

describe('guard<on:> around a timeout', () => {
  it('re-raises the timeout halt when the filter omits its code', async () => {
    await expectHalt(
      () =>
        run(`guard<on: list[#RILL_R083]> { ${TIMEOUT} }`, expiringOptions()),
      { code: 'RILL_R082' }
    );
  });

  it('lets an outer bare guard recover the re-raised timeout halt', async () => {
    const source = `guard { guard<on: list[#RILL_R083]> { ${TIMEOUT} } } => $r\n($r.!code == #RILL_R082)`;
    expect(await run(source, expiringOptions())).toBe(true);
  });

  it('recovers the timeout halt when the filter lists its code', async () => {
    const source = `guard<on: list[#RILL_R082]> { ${TIMEOUT} } => $r\n($r.!code == #RILL_R082)`;
    expect(await run(source, expiringOptions())).toBe(true);
  });
});
