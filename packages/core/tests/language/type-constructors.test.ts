/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Type constructors: the list, dict, ordered, tuple, stream, union, fn, and
 * map rules no other locked test proves, including dict literal keys and the
 * ordering operators on collections.
 */

import { describe, expect } from 'vitest';
import { run } from '../helpers/runtime.js';
import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';

const STREAM =
  'fn(x):stream(string):number { $x -> yield\n  1 } => $f\n$f("a")';

describe('Rill Language: list types', () => {
  rule('list.form').it('writes a list type bare or with one type', async () => {
    expect(await run('list.name')).toBe('list');
    expect(await run('list(number).signature')).toBe('list(number)');
  });

  rule('list.argument').it(
    'takes a name, a parameterized type, a union, or a type variable',
    async () => {
      expect(await run('list(list(number)).signature')).toBe(
        'list(list(number))'
      );
      expect(await run('list(union(number, string)).signature')).toBe(
        'list(union(number, string))'
      );
      expect(await run('number => $t\nlist($t).signature')).toBe(
        'list(number)'
      );
    }
  );

  rule('list.membership').it(
    'has list(T) when every element has T, and the empty list has every list(T)',
    async () => {
      expect(await run('list[1, 2] -> :?list(number)')).toBe(true);
      expect(await run('list[1, "a"] -> :?list(number)')).toBe(false);
      expect(await run('list[] -> :?list(dict(a: number))')).toBe(true);
    }
  );

  rule('list.element-union').it(
    'admits each member of a union element type',
    async () => {
      expect(await run('list[1, "a"] -> :?list(union(number, string))')).toBe(
        true
      );
      expect(await run('list[1, true] -> :?list(union(number, string))')).toBe(
        false
      );
    }
  );

  rule('list.no-order').it('halts RILL-R002 ordering two lists', async () => {
    await expectHalt(() => run('list[1] < list[2]'), { code: 'RILL_R002' });
    await expectHalt(() => run('list[1] >= list[2]'), { code: 'RILL_R002' });
  });
});

describe('Rill Language: dict literals', () => {
  rule('dict-literal.key-computed').it(
    'uses a string variable or computed key as the key',
    async () => {
      expect(
        await run(
          '"k" => $k\ndict[$k: 1, ("x" -> .upper): 2] == dict[k: 1, X: 2]'
        )
      ).toBe(true);
      expect(await run('"k" => $k\nordered[$k: 1].keys')).toEqual(['k']);
    }
  );

  rule('dict-literal.key-computed').it(
    'halts RILL-R002 for a variable or computed key that is not a string',
    async () => {
      await expectHalt(() => run('1 => $k\ndict[$k: 1]'), {
        code: 'RILL_R002',
      });
      await expectHalt(() => run('dict[(1): 1]'), { code: 'RILL_R002' });
      await expectHalt(() => run('1 => $k\nordered[$k: 1]'), {
        code: 'RILL_R002',
      });
      await expectHalt(() => run('number => $x\n[$x:number]'), {
        code: 'RILL_R002',
      });
    }
  );

  rule('dict-literal.key-multi').it(
    'binds each element of a multi-key list to the value',
    async () => {
      expect(await run('dict[["a", "b"]: 1] == dict[a: 1, b: 1]')).toBe(true);
      expect(await run('[["a", "b"]: 1] == dict[a: 1, b: 1]')).toBe(true);
      expect(await run('ordered[["a", "b"]: 1] == ordered[a: 1, b: 1]')).toBe(
        true
      );
    }
  );

  rule('dict-literal.key-multi').it(
    'halts RILL-R002 for a non-string element or an empty multi-key list',
    async () => {
      await expectHalt(() => run('dict[[1, "b"]: 1]'), { code: 'RILL_R002' });
      await expectHalt(() => run('dict[[]: 1]'), { code: 'RILL_R002' });
    }
  );

  rule('dict.no-order').it('halts RILL-R002 ordering two dicts', async () => {
    await expectHalt(() => run('dict[a: 1] < dict[a: 2]'), {
      code: 'RILL_R002',
    });
    await expectHalt(() => run('dict[a: 1] <= dict[a: 1]'), {
      code: 'RILL_R002',
    });
  });
});

describe('Rill Language: ordered types', () => {
  rule('ordered.not-dict').it(
    'keeps ordered values and dict types apart in both directions',
    async () => {
      expect(await run('ordered[a: 1] -> :?dict(a: number)')).toBe(false);
      expect(await run('dict[a: 1] -> :?ordered(a: number)')).toBe(false);
      expect(await run('dict[a: 1] -> :?ordered')).toBe(false);
    }
  );

  rule('ordered.no-order').it(
    'halts RILL-R002 ordering two ordered values',
    async () => {
      await expectHalt(() => run('ordered[a: 1] < ordered[a: 2]'), {
        code: 'RILL_R002',
      });
    }
  );
});

describe('Rill Language: tuple types', () => {
  rule('tuple.position-type').it('takes any type at a position', async () => {
    expect(
      await run(
        'tuple[list[1], tuple["a"]] -> :?tuple(list(number), tuple(string))'
      )
    ).toBe(true);
    expect(await run('tuple(list(number), tuple(string)).signature')).toBe(
      'tuple(list(number), tuple(string))'
    );
  });

  rule('tuple.omitted-default').it(
    'lets a defaulted position be absent and types a present one',
    async () => {
      expect(await run('tuple[1] -> :?tuple(number, string = "x")')).toBe(true);
      expect(await run('tuple[1, "y"] -> :?tuple(number, string = "x")')).toBe(
        true
      );
      expect(await run('tuple[1, 2] -> :?tuple(number, string = "x")')).toBe(
        false
      );
    }
  );

  rule('tuple.print').it('prints each position in order', async () => {
    expect(await run('tuple(number, string).signature')).toBe(
      'tuple(number, string)'
    );
    expect(await run('tuple(number).signature')).toBe('tuple(number)');
  });

  rule('tuple.order').it(
    'orders tuples of one length by their first unequal slot',
    async () => {
      expect(await run('tuple[1, 2] < tuple[1, 3]')).toBe(true);
      expect(await run('tuple[2, 0] > tuple[1, 9]')).toBe(true);
      expect(await run('tuple[1, 2] <= tuple[1, 2]')).toBe(true);
      expect(await run('tuple["b"] > tuple["a"]')).toBe(true);
    }
  );
});

describe('Rill Language: stream types', () => {
  rule('stream.chunk').it('names the type iteration yields', async () => {
    expect(await run(`${STREAM} -> seq({ $.^type.name })`)).toEqual(['string']);
  });

  rule('stream.resolution').it(
    'names the type invocation returns',
    async () => {
      expect(await run(`${STREAM} => $s\n$s() -> :number`)).toBe(1);
    }
  );

  rule('stream.unspecified-outer').it(
    'returns any for an omitted outer and for a bare stream',
    async () => {
      expect(await run('stream(number).outer == any')).toBe(true);
      expect(await run('stream.inner == any')).toBe(true);
      expect(await run('stream.outer == any')).toBe(true);
    }
  );

  rule('stream.equality').it(
    'compares both the chunk and the resolution type',
    async () => {
      expect(await run('stream(number):string == stream(number):string')).toBe(
        true
      );
      expect(await run('stream(number):string == stream(number):number')).toBe(
        false
      );
      expect(await run('stream(number):string == stream(number)')).toBe(false);
    }
  );

  rule('stream.no-conversion').it(
    'asserts a stream but halts RILL-R036 converting it to a collection',
    async () => {
      expect(await run(`${STREAM} -> :stream(string) -> :?stream`)).toBe(true);
      await expectHalt(() => run(`${STREAM} -> list(string)`), {
        code: 'RILL_R036',
      });
    }
  );
});

describe('Rill Language: union types', () => {
  rule('union.keep-default').it(
    'keeps a member whose default the broader member does not declare',
    async () => {
      expect(
        await run('union(dict(a: string, b: string = "x"), dict).inner.len')
      ).toBe(2);
      expect(
        await run(
          'union(dict(a: string = "x"), dict(a: string = "y")).inner.len'
        )
      ).toBe(2);
    }
  );
});

describe('Rill Language: fn types', () => {
  rule('fn.default-any').it(
    'leaves a parameter with only a default typed any',
    async () => {
      expect(await run('fn(x = "d") == fn(x: any = "d"):any')).toBe(true);
      expect(await run('fn(x = "d").signature')).toBe('fn(x: any = "d"):any');
    }
  );

  rule('fn.no-name').it('rejects a name after fn with RILL-P001', async () => {
    await expect(run('fn double(x) { $x * 2 }')).rejects.toMatchObject({
      errorId: 'RILL-P001',
    });
    await expect(run('guard { fn f(x) { $x } }')).rejects.toMatchObject({
      errorId: 'RILL-P001',
    });
  });
});

describe('Rill Language: map literals', () => {
  rule('map.key-multi-empty').it(
    'halts RILL-R002 for an empty multi-key list',
    async () => {
      await expectHalt(() => run('map[[]: 1]'), { code: 'RILL_R002' });
    }
  );
});
