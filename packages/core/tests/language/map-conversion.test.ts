/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: conversion between dict and map
 *
 * Only a dict and a string-keyed map convert to each other. Every other pair
 * halts RILL-R036.
 */

import { describe, expect } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('map conversion', () => {
  rule('map.from-dict').it(
    'converts each dict value to the map value type',
    async () => {
      expect(
        await run('dict[a: "1", b: "2"] -> map(string, number) -> .values')
      ).toEqual([1, 2]);
    }
  );

  rule('map.from-dict').it(
    'names the key of a value that does not convert',
    async () => {
      await expectHalt(() => run('dict[a: "x"] -> map(string, list)'), {
        code: 'RILL_R036',
        messagePattern: /key "a"/,
      });
    }
  );

  rule('map.from-dict').it(
    'halts RILL-R036 for a key that misses the key type',
    async () => {
      await expectHalt(
        () => run('dict[a: 1] -> map(union("b", "c"), number)'),
        { code: 'RILL_R036', messagePattern: /key "a"/ }
      );
    }
  );

  rule('map.to-dict').it('converts a string-keyed map to a dict', async () => {
    expect(await run('map["a": 1, "b": 2] -> dict')).toEqual({ a: 1, b: 2 });
  });

  rule('map.to-dict').it(
    'halts RILL-R036 naming a dict-reserved key',
    async () => {
      await expectHalt(() => run('map["keys": 1] -> dict'), {
        code: 'RILL_R036',
        messagePattern: /"keys"/,
      });
    }
  );

  rule('map.to-dict-key').it(
    'halts RILL-R036 for an atom-keyed map',
    async () => {
      await expectHalt(() => run('map[#a: 1] -> dict'), { code: 'RILL_R036' });
    }
  );

  rule('map.to-dict-key').it(
    'halts RILL-R036 for a number-keyed map',
    async () => {
      await expectHalt(() => run('map[1: 1] -> dict'), { code: 'RILL_R036' });
    }
  );

  rule('map.from-list').it('halts RILL-R036 for a list', async () => {
    await expectHalt(() => run('list[1, 2] -> map'), { code: 'RILL_R036' });
  });

  rule('map.from-list').it(
    'halts RILL-R036 for a list to map(string, V)',
    async () => {
      await expectHalt(() => run('list[1, 2] -> map(string, number)'), {
        code: 'RILL_R036',
      });
    }
  );

  rule('map.from-dict').it(
    'halts RILL-R036 converting an atom-keyed map to map(string, V)',
    async () => {
      await expectHalt(() => run('map[#a: 1] -> map(string, number)'), {
        code: 'RILL_R036',
      });
    }
  );

  rule('map.from-dict').it(
    'converts a dict with no type arguments',
    async () => {
      expect(await run('dict[a: 1] -> map -> .keys')).toEqual(['a']);
    }
  );

  rule('map.from-list').it(
    'halts RILL-R036 for an ordered source',
    async () => {
      await expectHalt(() => run('ordered[a: 1] -> map(string, number)'), {
        code: 'RILL_R036',
      });
    }
  );

  rule('map.from-list').it('halts RILL-R036 for a tuple source', async () => {
    await expectHalt(() => run('tuple[1, 2] -> map(string, number)'), {
      code: 'RILL_R036',
    });
  });

  rule('map.to-dict').it('halts RILL-R036 naming a brand key', async () => {
    await expectHalt(() => run('map["__rill_atom": 1] -> dict'), {
      code: 'RILL_R036',
      messagePattern: /"__rill_atom"/,
    });
  });

  rule('map.from-dict').it(
    'halts #TYPE_MISMATCH for a dict holding a code block',
    async () => {
      await expectHalt(() => run('dict[a: { 1 }] -> map(string, number)'), {
        code: 'TYPE_MISMATCH',
      });
    }
  );

  rule('map.from-dict').it(
    'names the nested part of a value that does not convert',
    async () => {
      await expectHalt(
        () => run('dict[a: dict[b: "x"]] -> map(string, dict(b: list))'),
        { code: 'RILL_R036', messagePattern: /key "a", field/ }
      );
    }
  );

  rule('map.from-dict').it(
    'names a number key that misses the key type',
    async () => {
      await expectHalt(() => run('map[1: 1] -> map(string, number)'), {
        code: 'RILL_R036',
        messagePattern: /key 1/,
      });
    }
  );
});
