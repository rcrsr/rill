/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: Block Arguments
 * A block passed as a whole argument converts to a function typed by the
 * unnamed parameters its body reads.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

const IDENTITY = 'fn(f: fn) { $f } => $id\n';

describe('Rill Language: Block Arguments', () => {
  describe('block that reads no unnamed parameter', () => {
    rule('fn.block-reads-none').it('passes as fn():any', async () => {
      expect(await run(`${IDENTITY}$id({ 5 }) -> :fn():any`)).toBeDefined();
    });

    rule('fn.block-reads-none').it(
      'does not satisfy a fn(any) type',
      async () => {
        await expectHalt(() => run(`${IDENTITY}$id({ 5 }) -> :fn(any):any`), {
          code: 'TYPE_MISMATCH',
        });
      }
    );

    rule('fn.block-reads-none').it(
      'runs when called with no arguments',
      async () => {
        expect(await run(`${IDENTITY}$id({ 5 }) => $g\n$g()`)).toBe(5);
      }
    );
  });

  describe('block that reads the pipe value', () => {
    rule('fn.block-reads-pipe').it('passes as fn(any):any', async () => {
      expect(
        await run(`${IDENTITY}$id({ $ + 1 }) -> :fn(any):any`)
      ).toBeDefined();
    });

    rule('fn.block-reads-pipe').it(
      'does not satisfy a fn(any, any) type',
      async () => {
        await expectHalt(
          () => run(`${IDENTITY}$id({ $ + 1 }) -> :fn(any, any):any`),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('fn.block-reads-pipe').it(
      'receives each element when a collection operator runs it',
      async () => {
        expect(await run('list[1, 2, 3] -> seq({ $ + 1 })')).toEqual([2, 3, 4]);
      }
    );
  });

  describe('block that reads the accumulator', () => {
    rule('fn.block-reads-acc').it(
      'passes as fn(any, any):any when it reads both',
      async () => {
        expect(
          await run(`${IDENTITY}$id({ $@ + $ }) -> :fn(any, any):any`)
        ).toBeDefined();
      }
    );

    rule('fn.block-reads-acc').it(
      'passes as fn(any, any):any when it reads only the accumulator',
      async () => {
        expect(
          await run(`${IDENTITY}$id({ $@ }) -> :fn(any, any):any`)
        ).toBeDefined();
      }
    );

    rule('fn.block-reads-acc').it(
      'does not satisfy a fn(any) type',
      async () => {
        await expectHalt(
          () => run(`${IDENTITY}$id({ $@ + $ }) -> :fn(any):any`),
          {
            code: 'TYPE_MISMATCH',
          }
        );
      }
    );
  });

  describe('assertion after a block', () => {
    rule('fn.block-outer').it(
      'takes the asserted type as the outer',
      async () => {
        expect(
          await run(`${IDENTITY}$id({ $ + 1 }:number) -> :fn(any):number`)
        ).toBeDefined();
      }
    );

    rule('fn.block-outer').it(
      'does not satisfy a different outer',
      async () => {
        await expectHalt(
          () => run(`${IDENTITY}$id({ $ + 1 }:number) -> :fn(any):string`),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('fn.block-outer').it(
      'asserts each call result against the outer',
      async () => {
        expect(await run('list[1, 2] -> seq({ $ + 1 }:number)')).toEqual([
          2, 3,
        ]);
      }
    );

    rule('fn.block-outer').it(
      'halts TYPE_MISMATCH when a call result fails the outer',
      async () => {
        await expectHalt(() => run('list[1, 2] -> seq({ $ + 1 }:string)'), {
          code: 'TYPE_MISMATCH',
        });
      }
    );
  });

  describe('type of a converted block', () => {
    rule('fn.block-type').it(
      'reports the read parameters through .^type',
      async () => {
        const type = await run(
          `${IDENTITY}$id({ $ + 1 }:number) => $g\n$g.^type`
        );
        expect(type).toMatchObject({
          typeName: 'fn',
          structure: {
            kind: 'fn',
            params: [{ type: { kind: 'any' } }],
            ret: { kind: 'number' },
          },
        });
      }
    );

    rule('fn.block-type').it(
      'carries an annotation written on the argument',
      async () => {
        expect(
          await run(`${IDENTITY}$id(^(label: "x") { $ + 1 }) => $g\n$g.^label`)
        ).toBe('x');
      }
    );
  });
  describe('block with a type check', () => {
    rule('fn.block-check').it(
      'converts to a function typed fn(any):bool through .^type',
      async () => {
        expect(
          await run(`${IDENTITY}$id({ $ }:?number) -> .^type -> string`)
        ).toBe('fn(any):bool');
      }
    );

    rule('fn.block-check').it(
      'yields whether the result has the type on each call',
      async () => {
        expect(await run('list[1, "a"] -> seq({ $ }:?number)')).toEqual([
          true,
          false,
        ]);
      }
    );

    rule('fn.block-check').it(
      'does not run the block where it is written',
      async () => {
        expect(await run(`${IDENTITY}$id({ $ }:?number) => $g\n5 -> $g`)).toBe(
          true
        );
      }
    );
  });
});
