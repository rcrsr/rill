/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: duration and vector methods
 * Covers duration parts, duration arithmetic halts, and vector method
 * edges not covered in duration.test.ts and vectors.test.ts.
 */

import { createVector, type RillValue } from '@rcrsr/rill';
import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

/** Runs `src` inside guard and yields the caught error code. */
async function guardCode(
  src: string,
  variables: Record<string, RillValue> = {}
): Promise<RillValue> {
  return run(`guard { ${src} } => $r\n$r.!code`, { variables });
}

describe('Rill Language: duration methods', () => {
  rule('duration-split.order', 'duration.ms.part').it(
    'splits the millisecond count largest unit first, keeping a fraction in .ms',
    async () => {
      expect(
        await run(
          'duration("3d4h5m6s7ms") => $d\nlist[$d.days, $d.hours, $d.minutes, $d.seconds, $d.ms]'
        )
      ).toEqual([3, 4, 5, 6, 7]);
      expect(
        await run('duration("49h") => $d\nlist[$d.days, $d.hours]')
      ).toEqual([2, 1]);
      expect(
        await run('duration("1s0.5ms") => $d\nlist[$d.seconds, $d.ms]')
      ).toEqual([1, 0.5]);
      expect(await run('duration("23h59m59s999ms").days')).toBe(0);
    }
  );

  rule('duration-split.no-months', 'duration.months.count').it(
    'keeps the month count out of every part, and .months reads it alone',
    async () => {
      expect(
        await run(
          'duration("1y2mo") => $d\nlist[$d.months, $d.days, $d.hours, $d.ms]'
        )
      ).toEqual([14, 0, 0, 0]);
      expect(await run('duration("1mo1d").days')).toBe(1);
      expect(await run('duration("40d").months')).toBe(0);
    }
  );

  rule('duration.total_ms.count').it(
    '.total_ms yields the millisecond count with its fraction',
    async () => {
      expect(await run('duration("1s0.5ms").total_ms')).toBe(1000.5);
      expect(await run('duration().total_ms')).toBe(0);
    }
  );

  rule('duration.total_ms.calendar').it(
    '.total_ms on a duration with months halts INVALID_INPUT, and guard catches it',
    async () => {
      await expectHalt(() => run('duration("1mo1d").total_ms'), {
        code: 'INVALID_INPUT',
      });
      expect(await guardCode('duration("1mo").total_ms')).toEqual(
        await run('#INVALID_INPUT')
      );
    }
  );

  rule('duration.display.print').it(
    '.display yields the printed form',
    async () => {
      for (const text of ['0ms', '1d1h', '1y2mo', '1s0.3ms']) {
        expect(
          await run(
            `duration("${text}") => $d\nlist[$d.display, $d.display == "{$d}"]`
          )
        ).toEqual([text, true]);
      }
    }
  );

  rule('duration.zero.value').it(
    '.zero yields the zero duration whatever the receiver',
    async () => {
      expect(await run('duration("1y3d4h").zero == duration()')).toBe(true);
    }
  );

  rule('duration.add.type').it(
    '.add with a non-duration argument halts TYPE_MISMATCH, and guard catches it',
    async () => {
      await expectHalt(() => run('duration("1d").add(1)'), {
        code: 'TYPE_MISMATCH',
      });
      expect(await guardCode('duration("1d").add("1h")')).toEqual(
        await run('#TYPE_MISMATCH')
      );
    }
  );

  rule('duration.subtract.difference').it(
    '.subtract subtracts months and milliseconds apart',
    async () => {
      expect(
        await run(
          'duration("1mo1d").subtract(duration("1mo")) == duration("1d")'
        )
      ).toBe(true);
      expect(
        await run('duration("1d").subtract(duration("1d")) == duration()')
      ).toBe(true);
    }
  );

  rule('duration.subtract.negative').it(
    '.subtract halts INVALID_INPUT when either difference is negative, with no borrowing',
    async () => {
      await expectHalt(() => run('duration("1h").subtract(duration("2h"))'), {
        code: 'INVALID_INPUT',
      });
      await expectHalt(() => run('duration("1mo").subtract(duration("1d"))'), {
        code: 'INVALID_INPUT',
      });
      expect(
        await guardCode('duration("1d").subtract(duration("1mo"))')
      ).toEqual(await run('#INVALID_INPUT'));
    }
  );

  rule('duration.subtract.type').it(
    '.subtract with a non-duration argument halts TYPE_MISMATCH, and guard catches it',
    async () => {
      expect(await guardCode('duration("1d").subtract(5)')).toEqual(
        await run('#TYPE_MISMATCH')
      );
    }
  );

  rule('duration.multiply.scale').it(
    '.multiply scales each component by a fractional factor',
    async () => {
      expect(
        await run('duration("1h").multiply(1.5) == duration("1h30m")')
      ).toBe(true);
      expect(await run('duration("1h1ms").multiply(0.5).display')).toBe(
        '30m0.5ms'
      );
      expect(await run('duration("2mo").multiply(1.5).months')).toBe(3);
    }
  );

  rule('duration.multiply.negative').it(
    '.multiply by a negative factor halts INVALID_INPUT, and guard catches it',
    async () => {
      await expectHalt(() => run('duration("1h").multiply(-1)'), {
        code: 'INVALID_INPUT',
      });
      expect(await guardCode('duration("1h").multiply(-1)')).toEqual(
        await run('#INVALID_INPUT')
      );
    }
  );

  rule('duration.multiply.fractional-months').it(
    '.multiply halts INVALID_INPUT on a fractional month count, and guard catches it',
    async () => {
      await expectHalt(() => run('duration("1mo").multiply(1.5)'), {
        code: 'INVALID_INPUT',
      });
      expect(await guardCode('duration("1mo").multiply(0.5)')).toEqual(
        await run('#INVALID_INPUT')
      );
    }
  );

  rule('duration.multiply.type').it(
    '.multiply by a non-number halts TYPE_MISMATCH, and guard catches it',
    async () => {
      await expectHalt(() => run('duration("1h").multiply("2")'), {
        code: 'TYPE_MISMATCH',
      });
      expect(await guardCode('duration("1h").multiply(true)')).toEqual(
        await run('#TYPE_MISMATCH')
      );
    }
  );
});

describe('Rill Language: vector methods', () => {
  const v = (data: number[], model = 'm'): RillValue =>
    createVector(new Float32Array(data), model);
  const variables = {
    a: v([3, 4]),
    b: v([6, 8]),
    c: v([1, 0, 0]),
    x: v([3, 4], 'other'),
    z: v([0, 0]),
  };

  rule('vector-operand.type').it(
    'a non-vector argument to .similarity, .dot, or .distance halts TYPE_MISMATCH, and guard catches it',
    async () => {
      for (const m of ['similarity', 'dot', 'distance']) {
        await expectHalt(() => run(`$a.${m}("s")`, { variables }), {
          code: 'TYPE_MISMATCH',
        });
        expect(await guardCode(`$a.${m}(list[3, 4])`, variables)).toEqual(
          await run('#TYPE_MISMATCH')
        );
      }
    }
  );

  rule('vector-operand.dimensions').it(
    'operands of different dimensions halt INVALID_INPUT, and guard catches it',
    async () => {
      for (const m of ['similarity', 'dot', 'distance']) {
        await expectHalt(() => run(`$a.${m}($c)`, { variables }), {
          code: 'INVALID_INPUT',
        });
        expect(await guardCode(`$c.${m}($a)`, variables)).toEqual(
          await run('#INVALID_INPUT')
        );
      }
    }
  );

  rule('vector-operand.model').it(
    'the model name does not affect .similarity, .dot, or .distance',
    async () => {
      expect(
        await run(
          'list[$a.similarity($x), $a.dot($x), $a.distance($x)] == list[$a.similarity($a), $a.dot($a), $a.distance($a)]',
          { variables }
        )
      ).toBe(true);
      expect(await run('$a.dot($x)', { variables })).toBe(25);
    }
  );

  rule('vector.similarity.zero').it(
    '.similarity yields 0 when either vector is all zeros',
    async () => {
      expect(
        await run(
          'list[$a.similarity($z), $z.similarity($a), $z.similarity($z)]',
          {
            variables,
          }
        )
      ).toEqual([0, 0, 0]);
    }
  );

  rule('vector.norm.length').it(
    '.norm of an all-zero vector is 0',
    async () => {
      expect(await run('$z.norm', { variables })).toBe(0);
    }
  );

  rule('vector.normalize.zero').it(
    '.normalize of an all-zero vector yields the receiver',
    async () => {
      expect(await run('$z.normalize == $z', { variables })).toBe(true);
    }
  );

  rule('vector.normalize.unit').it(
    '.normalize keeps the component count and model',
    async () => {
      expect(
        await run(
          'list[$x.normalize.dimensions, $x.normalize.model, $a.normalize == $b.normalize]',
          { variables }
        )
      ).toEqual([2, 'other', true]);
    }
  );
});
