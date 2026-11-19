/**
 * Runtime tests: collection operators call their function with exact arity.
 *
 * seq, fan, filter, and sort pass one argument; fold and acc pass two. The
 * callee's declared parameters decide whether the call binds: an excess
 * argument halts RILL-R045 and a missing required one halts RILL-R044. A
 * non-function argument halts with the operator-family code.
 */

import { describe, expect, it } from 'vitest';

import {
  expectHalt,
  expectHaltMessage,
  expectRuntimeError,
} from '../helpers/halt.js';
import { run } from '../helpers/runtime.js';

const EAGER_OPS: ReadonlyArray<readonly [string, string]> = [
  ['seq', 'list[1, 2] -> seq(BODY)'],
  ['fan', 'list[1, 2] -> fan(BODY)'],
  ['filter', 'list[1, 2] -> filter(BODY)'],
  ['sort', 'list[2, 1] -> sort(BODY)'],
];

describe('Rill Runtime: collection operator exact arity', () => {
  describe('eager path', () => {
    for (const [op, template] of EAGER_OPS) {
      it(`halts RILL-R045 when ${op} gets a block that reads no $`, async () => {
        await expectRuntimeError(() => run(template.replace('BODY', '{ 5 }')), {
          code: 'RILL-R045',
        });
      });

      it(`halts RILL-R044 when ${op} gets a block that reads $@`, async () => {
        await expectRuntimeError(
          () => run(template.replace('BODY', '{ $@ }')),
          { code: 'RILL-R044' }
        );
      });

      it(`halts RILL-R044 when ${op} gets a two-param function`, async () => {
        await expectRuntimeError(
          () => run(template.replace('BODY', 'fn(a, b) { $a }')),
          { code: 'RILL-R044' }
        );
      });
    }
  });

  describe('lazy path', () => {
    it('halts RILL-R045 when seq over an iterator gets a block that reads no $', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> seq({ 5 })'), {
        code: 'RILL-R045',
      });
    });

    it('halts RILL-R044 when seq over an iterator gets a block that reads $@', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> seq({ $@ })'), {
        code: 'RILL-R044',
      });
    });

    it('halts RILL-R045 when acc over an iterator gets a one-param function', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> acc(0, { $ * 2 })'), {
        code: 'RILL-R045',
      });
    });

    it('accumulates over an iterator when acc gets a block that reads $@ and $', async () => {
      expect(await run('range(0, 3) -> acc(0, { $@ + $ })')).toEqual([0, 1, 3]);
    });

    it('halts RILL-R045 when start_when gets a block that reads no $', async () => {
      await expectRuntimeError(
        () => run('list[1, 2] -> start_when({ true })'),
        { code: 'RILL-R045' }
      );
    });

    it('halts RILL-R045 when stop_when gets a block that reads no $', async () => {
      await expectRuntimeError(() => run('list[1, 2] -> stop_when({ true })'), {
        code: 'RILL-R045',
      });
    });

    it('calls start_when and stop_when with the element', async () => {
      expect(await run('list[1, 2, 3] -> start_when({ $ > 1 })')).toEqual([
        2, 3,
      ]);
      expect(await run('list[1, 2, 3] -> stop_when({ $ > 1 })')).toEqual([
        1, 2,
      ]);
    });
  });

  describe('fold and acc', () => {
    const FOLD_OPS: ReadonlyArray<readonly [string, string]> = [
      ['fold', 'list[1, 2] -> fold(0, BODY)'],
      ['acc', 'list[1, 2] -> acc(0, BODY)'],
    ];

    for (const [op, template] of FOLD_OPS) {
      it(`halts RILL-R045 when ${op} gets a one-param named function`, async () => {
        await expectRuntimeError(
          () => run(template.replace('BODY', 'fn(item) { $item }')),
          { code: 'RILL-R045' }
        );
      });

      it(`halts RILL-R045 when ${op} gets a block that reads $ without $@`, async () => {
        await expectRuntimeError(
          () => run(template.replace('BODY', '{ $ * 2 }')),
          { code: 'RILL-R045' }
        );
      });

      it(`halts RILL-R045 when ${op} gets a block that reads no $`, async () => {
        await expectRuntimeError(() => run(template.replace('BODY', '{ 5 }')), {
          code: 'RILL-R045',
        });
      });

      it(`halts RILL-R044 when ${op} gets a function with a third required param`, async () => {
        await expectRuntimeError(
          () => run(template.replace('BODY', 'fn(a, b, c) { $a }')),
          { code: 'RILL-R044' }
        );
      });

      it(`calls ${op} with element and accumulator`, async () => {
        expect(await run(template.replace('BODY', '{ $@ + $ }'))).toEqual(
          op === 'fold' ? 3 : [1, 3]
        );
      });
    }

    it('halts RILL-R045 when fold over an iterator gets a one-param function', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> fold(0, { $ * 2 })'), {
        code: 'RILL-R045',
      });
    });
  });

  describe('fan and filter on a lazy source', () => {
    it('halts RILL-R045 when fan over an iterator gets a block that reads no $', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> fan({ 5 })'), {
        code: 'RILL-R045',
      });
    });

    it('halts RILL-R045 when filter over an iterator gets a block that reads no $', async () => {
      await expectRuntimeError(() => run('range(0, 3) -> filter({ true })'), {
        code: 'RILL-R045',
      });
    });
  });

  describe('accepted shapes', () => {
    it('calls seq with a named one-param function', async () => {
      expect(await run('list[1, 2] -> seq(fn(x) { $x * 2 })')).toEqual([2, 4]);
    });
  });

  describe('function argument halts', () => {
    const TYPE_MISMATCH_CASES: ReadonlyArray<readonly [string, string]> = [
      ['seq', 'list[1] -> seq(42)'],
      ['fan', 'list[1] -> fan(42)'],
      ['filter', 'list[1] -> filter(42)'],
      ['sort', 'list[1] -> sort(42)'],
      ['fold', 'list[1] -> fold(0, 42)'],
      ['acc', 'list[1] -> acc(0, 42)'],
    ];

    for (const [op, source] of TYPE_MISMATCH_CASES) {
      it(`halts ${op} with #TYPE_MISMATCH for a non-function argument`, async () => {
        await expectHalt(() => run(source), {
          code: 'TYPE_MISMATCH',
          messagePattern: new RegExp(
            `${op}: \\w+ must be a function, got number`
          ),
        });
      });
    }

    const R040_CASES: ReadonlyArray<readonly [string, string]> = [
      ['chain', 'chain(5, 42)'],
      ['start_when', 'list[1] -> start_when(42)'],
      ['stop_when', 'list[1] -> stop_when(42)'],
    ];

    for (const [op, source] of R040_CASES) {
      it(`halts ${op} with RILL-R040 for a non-function argument`, async () => {
        await expectHalt(() => run(source), {
          code: 'RILL_R040',
          hostErrorId: 'RILL-R040',
          messagePattern: new RegExp(
            `${op}: .+ must be a function, got number`
          ),
        });
      });
    }

    it('halts iterate with RILL-R006 for a non-function body', async () => {
      await expectHalt(() => run('iterate(0, 42)'), {
        code: 'RILL_R006',
        hostErrorId: 'RILL-R006',
        messagePattern: /iterate: body must be a function, got number/,
      });
    });

    it('names the list element role for a chain list entry', async () => {
      await expectHaltMessage(
        () => run('chain(5, list[42])'),
        /chain: list element must be a function, got number/
      );
    });
  });
});
