/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: A call with no arguments receives no `$`
 *
 * A call written with no arguments neither reads nor receives the piped
 * value. Only a call written as the pipe target receives it. A callable that
 * declares a required parameter therefore halts with a missing-argument error
 * in every body and branch position, and its body never runs.
 */

import { describe, expect } from 'vitest';
import { anyTypeValue } from '@rcrsr/rill';
import type { RillFunction, RillValue } from '@rcrsr/rill';

import { expectRuntimeError } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

interface Counter {
  readonly fn: RillFunction;
  count(): number;
}

/** A host function with one required parameter that counts its invocations. */
function createCounter(): Counter {
  let calls = 0;
  const fn: RillFunction = {
    returnType: anyTypeValue,
    params: [
      {
        name: 'v',
        type: { kind: 'any' },
        defaultValue: undefined,
        annotations: {},
      },
    ],
    fn: (): RillValue => {
      calls++;
      return 0;
    },
  };
  return { fn, count: () => calls };
}

/** Preamble binding `$f` and `$d` to callables that route into `tick`. */
const PREAMBLE = `fn(x) { tick($x) } => $f
dict[m: fn(x) { tick($x) }] => $d
`;

const CALL_FORMS: ReadonlyArray<readonly [string, string]> = [
  ['a host function', 'f()'],
  ['a script closure', '$f()'],
  ['a dict member', '$d.m()'],
  ['a method target', '$d -> .m()'],
];

/** Each context wraps `{CALL}` in a body that runs while `$` is bound. */
const CONTEXTS: ReadonlyArray<readonly [string, string]> = [
  ['seq body', 'list[1] -> seq({ {CALL} })'],
  ['fan body', 'list[1] -> fan({ {CALL} })'],
  ['filter body', 'list[1] -> filter({ {CALL} })'],
  ['fold body', 'list[1] -> fold(0, { {CALL} })'],
  ['sort body', 'list[2, 1] -> sort({ {CALL} })'],
  ['conditional then-branch', '5 -> (true) ? {CALL} ! 0'],
  ['conditional else-branch', '5 -> (false) ? 0 ! {CALL}'],
  ['guard body', '5 -> { $\nguard { {CALL} } }'],
  ['retry body', '5 -> { $\nretry<limit: 2> { {CALL} } }'],
  ['timeout body', '5 -> { $\ntimeout<total: duration("5s")> { {CALL} } }'],
  ['pass body', '5 -> pass { {CALL} }'],
  ['do-while body', '0 -> do { {CALL} } while ($ < 15)'],
  ['dispatch-selected block', '"a" -> dict[a: { {CALL} }]'],
];

describe('Rill Language: no implied $ for a call with no arguments', () => {
  for (const [callLabel, call] of CALL_FORMS) {
    for (const [contextLabel, template] of CONTEXTS) {
      const source = PREAMBLE + template.replace('{CALL}', call);
      rule('defaults.param-required').it(
        `halts RILL-R044 for ${callLabel} in a ${contextLabel} and never runs the callee`,
        async () => {
          const counter = createCounter();
          await expectRuntimeError(
            () =>
              run(source, { functions: { f: counter.fn, tick: counter.fn } }),
            {
              code: 'RILL-R044',
              messagePattern: /Missing argument for parameter/,
            }
          );
          expect(counter.count()).toBe(0);
        }
      );
    }
  }

  rule('defaults.param').it(
    'uses the declared default when a call with no arguments runs while $ is bound',
    async () => {
      const result = await run(
        `fn(x: number = 99) { $x } => $f
5 -> (true) ? $f() ! 0`
      );
      expect(result).toBe(99);
    }
  );
});
