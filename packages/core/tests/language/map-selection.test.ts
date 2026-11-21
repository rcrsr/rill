/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: selection, dispatch and existence on a map
 *
 * A map selects by the key itself: `.$k`, `[sel]`, and a pipe into the map all
 * take a scalar of the kind the map's keys hold. The selector is validated
 * once, ahead of the lookup, so `??` recovers only a missing key.
 */

import { describe, expect } from 'vitest';

import { anyTypeValue } from '../../src/index.js';
import type { ApplicationCallable, RillValue } from '../../src/index.js';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

const NUMBERS = 'map[1: "one", 2: "two", -1: "minus"] => $m\n';
const ATOMS = 'map[#a: 1, #b: 2] => $m\n';

describe('map selection', () => {
  const { it: formsIt } = rule('selection.map-forms');
  const { it: nameIt } = rule('selection.map-name');
  const { it: typeIt } = rule('selection.map-type');
  const { it: noMaskIt } = rule('selection.map-no-mask');
  const { it: negativeIt } = rule('selection.map-negative');
  const { it: missingIt } = rule('selection.map-missing');
  const { it: defaultIt } = rule('selection.map-default');

  formsIt.each([
    ['a variable key', `${ATOMS}#b => $k\n$m.$k`],
    ['a pipe-variable key', `${ATOMS}#b -> { $m.$ }`],
    ['a bracket', `${ATOMS}$m[#b]`],
    ['a pipe into a variable', `${ATOMS}#b -> $m`],
    ['a pipe into a literal map', '#b -> map[#a: 1, #b: 2]'],
    [
      'a pipe into a literal map with a default',
      '#b -> map[#a: 1, #b: 2] ?? 9',
    ],
  ])('selects the value through %s', async (_label, source) => {
    expect(await run(source)).toBe(2);
  });

  formsIt('selects through a map held as an intermediate step', async () => {
    expect(
      await run('map[#a: dict[x: 1], #b: dict[x: 2]] => $m\n$m[#b].x')
    ).toBe(2);
    expect(await run('map["a": list[5, 6]] => $m\n$m["a"][1]')).toBe(6);
  });

  formsIt('descends through a map as a hierarchical step', async () => {
    expect(await run('dict[a: map[1: "deep"]] => $d\nlist["a", 1] -> $d')).toBe(
      'deep'
    );
  });

  formsIt(
    'selects by string, bool, number, atom and duration keys',
    async () => {
      expect(await run('map["x": 1]["x"]')).toBe(1);
      expect(await run('map[true: 1, false: 2][false]')).toBe(2);
      expect(await run('map[1.5: "f"][1.5]')).toBe('f');
      expect(await run('map[#k: 1][#k]')).toBe(1);
    }
  );

  formsIt('does not run a host property callable held in a map', async () => {
    let calls = 0;
    const property: ApplicationCallable = {
      __type: 'callable',
      kind: 'application',
      isProperty: true,
      params: [],
      returnType: anyTypeValue,
      annotations: {},
      fn: (): RillValue => {
        calls += 1;
        return 'ran';
      },
    };
    const result = await run('map["a": $p] => $m\n$m["a"]', {
      variables: { p: property },
    });
    expect(calls).toBe(0);
    expect(result).not.toBe('ran');
  });

  nameIt('halts RILL-R003 for a named field', async () => {
    await expectHalt(() => run(`${ATOMS}$m.a`), { code: 'RILL_R003' });
  });

  nameIt(
    'halts RILL-R003 for a named field on a string-keyed map',
    async () => {
      await expectHalt(() => run('map["a": 1] => $m\n$m.a'), {
        code: 'RILL_R003',
      });
    }
  );

  typeIt.each([
    ['a string on a number-keyed map', `${NUMBERS}$m["1"]`],
    ['a number on an atom-keyed map', `${ATOMS}$m[1]`],
    ['a number on a string-keyed map', 'map["a": 1]["a" -> .len]'],
    ['a list', `${ATOMS}$m[list[#a]]`],
    ['a dict', `${ATOMS}$m[dict[a: 1]]`],
  ])('halts #TYPE_MISMATCH for %s', async (_label, source) => {
    await expectHalt(() => run(source), { code: 'TYPE_MISMATCH' });
  });

  typeIt('halts #TYPE_MISMATCH for a wrong selector through .$k', async () => {
    await expectHalt(() => run(`${ATOMS}"a" => $k\n$m.$k`), {
      code: 'TYPE_MISMATCH',
    });
  });

  typeIt('halts #TYPE_MISMATCH for a wrong selector piped in', async () => {
    await expectHalt(() => run(`${ATOMS}"a" -> $m`), {
      code: 'TYPE_MISMATCH',
    });
  });

  typeIt(
    'halts #TYPE_MISMATCH for a list piped into a map variable',
    async () => {
      await expectHalt(() => run(`${ATOMS}list[#a] -> $m`), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  typeIt('accepts any scalar on an empty map and misses', async () => {
    await expectHalt(() => run('map[] => $m\n$m[1]'), { code: 'RILL_R009' });
    await expectHalt(() => run('map[] => $m\n$m["a"]'), { code: 'RILL_R009' });
    await expectHalt(() => run('map[] => $m\n$m[list[1]]'), {
      code: 'TYPE_MISMATCH',
    });
  });

  noMaskIt.each([
    ['a bracket', `${ATOMS}$m["a"] ?? 0`],
    ['a variable key', `${ATOMS}"a" => $k\n$m.$k ?? 0`],
    ['a pipe into a variable', `${ATOMS}"a" -> $m ?? 0`],
    ['a pipe into a literal map', '"a" -> map[#a: 1] ?? 0'],
  ])('does not mask a wrong selector through %s', async (_label, source) => {
    await expectHalt(() => run(source), { code: 'TYPE_MISMATCH' });
  });

  negativeIt('selects the key -1 and not the last entry', async () => {
    expect(await run(`${NUMBERS}$m[-1]`)).toBe('minus');
    expect(await run(`${NUMBERS}-1 -> $m`)).toBe('minus');
  });

  negativeIt('misses a negative key the map lacks', async () => {
    await expectHalt(() => run('map[1: "a", 2: "b"] => $m\n$m[-1]'), {
      code: 'RILL_R009',
    });
  });

  missingIt('halts RILL-R009 naming the key', async () => {
    await expectHalt(() => run(`${ATOMS}$m[#z]`), {
      code: 'RILL_R009',
      messagePattern: 'Undefined map key: #z',
    });
    await expectHalt(() => run(`${NUMBERS}$m[7]`), {
      code: 'RILL_R009',
      messagePattern: 'Undefined map key: 7',
    });
  });

  missingIt(
    'halts RILL-R009 for a missing key through every form',
    async () => {
      await expectHalt(() => run(`${ATOMS}#z => $k\n$m.$k`), {
        code: 'RILL_R009',
      });
      await expectHalt(() => run(`${ATOMS}#z -> $m`), { code: 'RILL_R009' });
      await expectHalt(() => run('#z -> map[#a: 1]'), { code: 'RILL_R009' });
    }
  );

  defaultIt.each([
    ['a bracket', `${ATOMS}$m[#z] ?? 9`],
    ['a variable key', `${ATOMS}#z => $k\n$m.$k ?? 9`],
    ['a pipe into a variable', `${ATOMS}#z -> $m ?? 9`],
    ['a pipe into a literal map', '#z -> map[#a: 1] ?? 9'],
  ])('replaces a missing key through %s', async (_label, source) => {
    expect(await run(source)).toBe(9);
  });

  defaultIt('yields the value when the key is present', async () => {
    expect(await run(`${ATOMS}$m[#a] ?? 9`)).toBe(1);
  });
});

describe('map dispatch', () => {
  const { it: blockIt } = rule('dispatch.map-block');

  blockIt('runs a held block with $ bound to the key', async () => {
    expect(await run('#a -> map[#a: { "got {$}" }]')).toBe('got #a');
    expect(await run('map[2: { $ * 10 }] => $m\n2 -> $m')).toBe(20);
  });

  blockIt('returns a held fn uncalled', async () => {
    expect(
      await run('map[#a: fn(x) { "k{$x}" }] => $m\n#a -> $m => $f\n$f("z")')
    ).toBe('kz');
  });
});

describe('map existence', () => {
  const { it: existenceIt } = rule('existence.map');
  const { it: typeIt } = rule('existence.map-type');

  existenceIt(
    'answers true for a held key and false for a missing one',
    async () => {
      expect(await run(`${ATOMS}$m.?[#a]`)).toBe(true);
      expect(await run(`${ATOMS}$m.?[#z]`)).toBe(false);
      expect(await run(`${NUMBERS}$m.?[-1]`)).toBe(true);
      expect(await run(`${ATOMS}#b => $k\n$m.?$k`)).toBe(true);
      expect(await run(`${ATOMS}#z => $k\n$m.?$k`)).toBe(false);
    }
  );

  existenceIt('answers false for a spelled name', async () => {
    expect(await run(`${ATOMS}$m.?a`)).toBe(false);
  });

  existenceIt('answers false on an empty map', async () => {
    expect(await run('map[] => $m\n$m.?[1]')).toBe(false);
  });

  existenceIt('does not run a held block', async () => {
    expect(await run('map[#a: { 1 / 0 }] => $m\n$m.?[#a]')).toBe(true);
  });

  typeIt.each([
    ['a string on a number-keyed map', `${NUMBERS}$m.?["1"]`],
    ['a number on an atom-keyed map', `${ATOMS}$m.?[1]`],
    ['a list', `${ATOMS}$m.?[list[#a]]`],
    ['a wrong variable key', `${ATOMS}"a" => $k\n$m.?$k`],
  ])('halts #TYPE_MISMATCH for %s', async (_label, source) => {
    await expectHalt(() => run(source), { code: 'TYPE_MISMATCH' });
  });

  typeIt('does not mask a wrong key with a default', async () => {
    await expectHalt(() => run(`${ATOMS}$m.?[1] ?? false`), {
      code: 'TYPE_MISMATCH',
    });
  });
});
