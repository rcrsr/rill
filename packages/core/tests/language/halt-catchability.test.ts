/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: halts
 *
 * A halt stops evaluation. Recovery catches a catchable halt and turns it
 * into an invalid value; non-catchable halts, parse errors, and control
 * signals pass through recovery unchanged.
 */

import { describe, expect } from 'vitest';
import {
  anyTypeValue,
  createRuntimeContext,
  execute,
  parse,
  type RillValue,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

/** A host function that records every value it receives. */
function recorder(received: RillValue[]) {
  return {
    see: {
      params: [
        {
          name: 'v',
          type: undefined,
          defaultValue: undefined,
          annotations: {},
        },
      ],
      returnType: anyTypeValue,
      fn: (args: Record<string, RillValue>): RillValue => {
        received.push(args['v'] ?? null);
        return '';
      },
    },
  };
}

describe('Rill Language: halts', () => {
  rule('halt.definition').it(
    'runs the statement after a guard that caught the halt',
    async () => {
      expect(await run('guard { 1 == "1" } => $r\n"after"')).toBe('after');
    }
  );

  rule('halt.no-exceptions', 'halt.catchable').it(
    'turns a caught halt into an invalid value at the guard',
    async () => {
      expect(await run('guard { 1 == "1" } => $r\n$r.!')).toBe(true);
    }
  );

  rule('halt.error-code').it(
    'exposes the error code of a caught halt as an atom',
    async () => {
      expect(
        await run('guard { 1 == "1" } => $r\n$r.!code == #TYPE_MISMATCH')
      ).toBe(true);
    }
  );

  describe('non-catchable halts escape guard', () => {
    rule('halt.catchable', 'halt.non-catchable').it.each([
      ['an error statement', 'guard { error "boom" }', 'RILL-R016'],
      ['a failed assert', 'guard { assert false "nope" }', 'RILL-R015'],
      [
        'a parameter type mismatch',
        'fn(x: number) { $x } => $f\nguard { $f("a") }',
        'RILL-R001',
      ],
      [
        'a missing argument',
        'fn(x: number) { $x } => $f\nguard { $f() }',
        'RILL-R044',
      ],
      [
        'an excess argument',
        'fn(x: number) { $x } => $f\nguard { $f(1, 2) }',
        'RILL-R045',
      ],
      [
        'the loop iteration limit',
        'guard { 0 -> while ($ < 20000) do { $ + 1 } }',
        'RILL-R010',
      ],
      [
        'the call depth limit',
        'fn(n) { $self($n + 1) } => $self\nguard { $self(0) }',
        'RILL-R010',
      ],
    ])('%s', async (_name, source, id) => {
      await expect(run(source)).rejects.toMatchObject({ errorId: id });
    });

    rule('halt.non-catchable').it(
      'lets a call made after the runtime is disposed escape guard',
      async () => {
        const received: RillValue[] = [];
        const ctx = createRuntimeContext({ functions: recorder(received) });
        await ctx.dispose();
        await expectHalt(
          () => execute(parse('guard { see(1) } => $r\n$r.!code'), ctx),
          { code: 'DISPOSED' }
        );
        expect(received).toEqual([]);
      }
    );
  });

  rule('halt.parse').it(
    'reports a parse error before any statement runs, even inside guard',
    async () => {
      const received: RillValue[] = [];
      await expect(
        run('see(1)\nguard { 1 + ) }', { functions: recorder(received) })
      ).rejects.toMatchObject({ errorId: 'RILL-P001' });
      expect(received).toEqual([]);
    }
  );

  describe('control signals pass through guard', () => {
    rule('halt.signals').it('lets break leave the loop', async () => {
      expect(
        await run('list[1, 2, 3] -> seq({ ($ == 2) ? guard { break } ! $ })')
      ).toEqual([1]);
    });

    rule('halt.signals').it('lets return leave the function', async () => {
      expect(
        await run('fn(x) { guard { $x -> return }\n8 } => $g\n$g(7)')
      ).toBe(7);
    });
  });
});
