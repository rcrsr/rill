/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: core built-in functions
 * Covers identity, log, json, enumerate, range, repeat, and now edges not
 * covered elsewhere in the locked suite.
 */

import { createRillStream, createVector } from '@rcrsr/rill';
import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { createLogCollector, run } from '../helpers/runtime.js';

describe('Rill Language: identity', () => {
  rule('identity.value').it(
    'yields an atom, a type value, a function, and an iterator unchanged',
    async () => {
      expect(await run('identity(#x) == #x')).toBe(true);
      expect(await run('identity(number) == number')).toBe(true);
      expect(await run('fn(x) { $x * 2 } => $f\nidentity($f)(3)')).toBe(6);
      expect(await run('identity(range(0, 3)) -> seq({ $ })')).toEqual([
        0, 1, 2,
      ]);
    }
  );
});

describe('Rill Language: log', () => {
  rule('log.text').it(
    'passes the text an interpolation inserts for each value kind',
    async () => {
      const { logs, callbacks } = createLogCollector();
      const source =
        'list["a"] => $l\n' +
        'list[log("s"), log($l), log(dict[b: 1, a: 2]), log(tuple[1, 2]), ' +
        'log(ordered[b: 1, a: 2]), log(map[#a: 1]), log(#x), log(true), ' +
        'log(number), log(datetime("2026-03-13")), ' +
        'log(duration(...dict[ms: 1500]))] => $all\n' +
        'list["s", "{$l}", "{dict[b: 1, a: 2]}", "{tuple[1, 2]}", ' +
        '"{ordered[b: 1, a: 2]}", "{map[#a: 1]}", "{#x}", "{true}", ' +
        '"{number}", "{datetime("2026-03-13")}", ' +
        '"{duration(...dict[ms: 1500])}"]';
      const texts = await run(source, { callbacks });
      expect(logs).toEqual(texts);
      expect(logs).toEqual([
        's',
        'list["a"]',
        'dict[a: 2, b: 1]',
        'tuple[1, 2]',
        'ordered[b: 1, a: 2]',
        'map[#a: 1]',
        '#x',
        'true',
        'number',
        '2026-03-13T00:00:00.000Z',
        '1s500ms',
      ]);
    }
  );

  rule('log.immediate').it(
    'writes once per call in evaluation order, and a later halt keeps the text',
    async () => {
      const { logs, callbacks } = createLogCollector();
      expect(
        await run('log(1) => $a\nlog(2) => $b\nlist[$b, $a] -> log', {
          callbacks,
        })
      ).toEqual([2, 1]);
      expect(logs).toEqual(['1', '2', 'list[2, 1]']);

      const second = createLogCollector();
      expect(
        await run('guard {\n  log(1)\n  1 / 0\n} => $r\n$r.!code', {
          callbacks: second.callbacks,
        })
      ).toEqual(await run('#RILL_R002'));
      expect(second.logs).toEqual(['1']);
    }
  );
});

describe('Rill Language: json', () => {
  rule('json.text', 'json.list', 'json.dict').it(
    'writes nested lists and dicts with no whitespace',
    async () => {
      expect(await run('json(list[1, "a", true, list[]])')).toBe(
        '[1,"a",true,[]]'
      );
      expect(await run('json(dict[a: list[1.5, dict[]]])')).toBe(
        '{"a":[1.5,{}]}'
      );
      expect(await run('json(dict[])')).toBe('{}');
      expect(await run('json(dict["a b": 1])')).toBe('{"a b":1}');
    }
  );

  rule('json.string').it(
    'escapes quotes, backslashes, and control characters only',
    async () => {
      expect(await run('json("a\\"b\\n")')).toBe('"a\\"b\\n"');
      expect(await run('json("a\\\\b\\t")')).toBe('"a\\\\b\\t"');
      expect(await run('json("é😀")')).toBe('"é😀"');
      expect(await run('json("")')).toBe('""');
    }
  );

  rule('json.number').it('writes a number in its printed form', async () => {
    expect(await run('json(1.0)')).toBe('1');
    expect(await run('json(0.0000001)')).toBe('1e-7');
    expect(await run('json(1000000000000000000000000)')).toBe('1e+24');
    expect(await run('json(0.1 + 0.2)')).toBe('0.30000000000000004');
  });

  rule('json.unsupported').it(
    'halts #INVALID_INPUT on kinds JSON does not carry, at any depth',
    async () => {
      for (const src of [
        'json(tuple[1])',
        'json(map["a": 1])',
        'json(fn(x) { $x })',
        'json(number)',
        'json(range(0, 2))',
        'json(dict[a: list[1, dict[b: tuple[1]]]])',
        'json(dict[a: ordered[x: 1]])',
        'json(list[map[#a: 1]])',
        'json(dict[a: number])',
        'json(list[range(0, 2)])',
      ]) {
        await expectHalt(() => run(src), { code: 'INVALID_INPUT' });
      }
      expect(await run('guard { json(tuple[1]) } => $r\n$r.!code')).toEqual(
        await run('#INVALID_INPUT')
      );
      const s = createRillStream({
        chunks: (async function* () {
          yield 1;
        })(),
        resolve: async () => 'done',
      });
      await expectHalt(() => run('json(list[$s])', { variables: { s } }), {
        code: 'INVALID_INPUT',
      });
      const v = createVector(new Float32Array([1, 2]), 'm');
      await expectHalt(() => run('json(list[$v])', { variables: { v } }), {
        code: 'INVALID_INPUT',
      });
    }
  );
});

describe('Rill Language: enumerate', () => {
  rule('enumerate.dict').it(
    'orders dict entries by UTF-16 code unit, as iteration does',
    async () => {
      expect(await run('enumerate(dict[b: 1, B: 2, a: 3])')).toEqual([
        { index: 0, key: 'B', value: 2 },
        { index: 1, key: 'a', value: 3 },
        { index: 2, key: 'b', value: 1 },
      ]);
    }
  );

  rule('enumerate.list').it('pairs each element with its index', async () => {
    expect(await run('list["x", "y"] -> enumerate')).toEqual([
      { index: 0, value: 'x' },
      { index: 1, value: 'y' },
    ]);
  });
});

describe('Rill Language: range', () => {
  rule('range.stop').it(
    'ends before a fractional stop and yields nothing from a start at the stop',
    async () => {
      expect(await run('range(0, 2.5) -> seq({ $ })')).toEqual([0, 1, 2]);
      expect(await run('range(0.5, 3) -> seq({ $ })')).toEqual([0.5, 1.5, 2.5]);
      expect(await run('range(5, 0, -2) -> seq({ $ })')).toEqual([5, 3, 1]);
      expect(await run('range(3, 3) -> .done')).toBe(true);
    }
  );

  rule('range.zero-step').it(
    'halts at the call, and guard catches it',
    async () => {
      await expectHalt(() => run('range(0, 5, 0) => $r\n1'), {
        code: 'INVALID_INPUT',
      });
      expect(await run('guard { range(0, 5, 0) } => $r\n$r.!code')).toEqual(
        await run('#INVALID_INPUT')
      );
    }
  );

  rule('range.lazy').it('computes no value before it is read', async () => {
    expect(await run('range(0, 1000000000000) -> .value')).toBe(0);
  });
});

describe('Rill Language: repeat', () => {
  rule('repeat.count').it(
    'halts on a fractional count at the call, and guard catches it',
    async () => {
      await expectHalt(() => run('repeat("a", 1.5) => $r\n1'), {
        code: 'INVALID_INPUT',
      });
      expect(await run('guard { repeat("a", -1) } => $r\n$r.!code')).toEqual(
        await run('#INVALID_INPUT')
      );
      expect(await run('repeat("a", 2.0) -> seq({ $ })')).toEqual(['a', 'a']);
    }
  );

  rule('repeat.values').it(
    'yields a done iterator for a count of 0',
    async () => {
      expect(await run('repeat("a", 0) -> .done')).toBe(true);
      expect(await run('repeat(list[1], 2) -> seq({ $ })')).toEqual([[1], [1]]);
    }
  );

  rule('repeat.lazy').it('produces no value before it is read', async () => {
    expect(await run('repeat("a", 1000000000000) -> .value')).toBe('a');
  });
});

describe('Rill Language: now', () => {
  rule('now.instant').it('yields a datetime from the host clock', async () => {
    expect(await run('now() -> .^type.name')).toBe('datetime');
    const before = Date.now();
    const unix = (await run('now() -> .unix')) as number;
    expect(unix).toBeGreaterThanOrEqual(before);
    expect(unix).toBeLessThanOrEqual(Date.now());
    expect(await run('now() -> "{$}"', { nowMs: 0 })).toBe(
      '1970-01-01T00:00:00.000Z'
    );
  });

  rule('now.order').it(
    'never yields an earlier instant on a later call',
    async () => {
      expect(
        await run(
          'now() => $a\nnow() => $b\nnow() => $c\n($a <= $b) && ($b <= $c)'
        )
      ).toBe(true);
    }
  );
});
