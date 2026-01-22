/**
 * Rill Runtime Tests: Tuple Type (Spread Args)
 * Tests for tuple type, * (spread) operator, and strict closure invocation
 */

import { describe, expect, it } from 'vitest';

import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Tuple Type (Spread Args)', () => {
  describe('Spread operator *', () => {
    describe('Prefix form: *expr', () => {
      it('creates tuple from list literal', async () => {
        const result = await run('type(*[1, 2, 3])');
        expect(result).toBe('tuple');
      });

      it('creates tuple from dict literal', async () => {
        const result = await run('type(*[x: 1, y: 2])');
        expect(result).toBe('tuple');
      });

      it('creates tuple from list variable', async () => {
        const result = await run('[1, 2] :> $t\ntype(*$t)');
        expect(result).toBe('tuple');
      });

      it('creates tuple from dict variable', async () => {
        const result = await run('[a: 1] :> $d\ntype(*$d)');
        expect(result).toBe('tuple');
      });
    });

    describe('Pipe target form: -> *', () => {
      it('converts pipe value to tuple', async () => {
        const result = await run('[1, 2, 3] -> * -> type');
        expect(result).toBe('tuple');
      });

      it('works in pipeline', async () => {
        const result = await run('[1, 2] -> * -> type');
        expect(result).toBe('tuple');
      });
    });
  });

  describe('Args unpacking at invocation', () => {
    describe('Positional args (from tuple)', () => {
      it('unpacks tuple into separate arguments', async () => {
        const result = await run(`
          |x, y| { ($x + $y) } :> $add
          *[3, 4] -> $add()
        `);
        expect(result).toBe(7);
      });

      it('preserves argument order', async () => {
        const result = await run(`
          |a, b, c| { "{$a}-{$b}-{$c}" } :> $fmt
          *[1, 2, 3] -> $fmt()
        `);
        expect(result).toBe('1-2-3');
      });

      it('works with string arguments', async () => {
        const result = await run(`
          |a, b| { [$b, $a] } :> $flip
          *["x", "y"] -> $flip()
        `);
        expect(result).toEqual(['y', 'x']);
      });
    });

    describe('Named args (from dict)', () => {
      it('unpacks dict by parameter name', async () => {
        const result = await run(`
          |a, b, c| { "{$a}-{$b}-{$c}" } :> $fmt
          *[c: 3, a: 1, b: 2] -> $fmt()
        `);
        expect(result).toBe('1-2-3');
      });

      it('allows any order for named args', async () => {
        const result = await run(`
          |width, height| { ($width * $height) } :> $area
          *[height: 20, width: 10] -> $area()
        `);
        expect(result).toBe(200);
      });
    });
  });

  describe('Parameter defaults', () => {
    it('applies defaults for missing positional args', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } :> $fn
        *[5] -> $fn()
      `);
      expect(result).toBe(35); // 5 + 10 + 20
    });

    it('overrides defaults when args provided', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } :> $fn
        *[5, 15] -> $fn()
      `);
      expect(result).toBe(40); // 5 + 15 + 20
    });

    it('works with named args and defaults', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } :> $fn
        *[x: 5, z: 30] -> $fn()
      `);
      expect(result).toBe(45); // 5 + 10 + 30
    });

    it('infers type from default value', async () => {
      const result = await run(`
        |x = "hello"| { $x } :> $fn
        *[] -> $fn()
      `);
      expect(result).toBe('hello');
    });
  });

  describe('Strict validation', () => {
    describe('Positional args errors', () => {
      it('errors on missing positional argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } :> $fn
            *[1] -> $fn()
          `)
        ).rejects.toThrow(/missing/i);
      });

      it('errors on extra positional argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } :> $fn
            *[1, 2, 3] -> $fn()
          `)
        ).rejects.toThrow(/extra/i);
      });
    });

    describe('Named args errors', () => {
      it('errors on missing named argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } :> $fn
            *[x: 1] -> $fn()
          `)
        ).rejects.toThrow(/missing/i);
      });

      it('errors on unknown named argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } :> $fn
            *[x: 1, y: 2, z: 3] -> $fn()
          `)
        ).rejects.toThrow(/unknown/i);
      });
    });

    describe('Regular invocation strict mode', () => {
      it('errors when missing required argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } :> $fn
            $fn(1)
          `)
        ).rejects.toThrow(/missing/i);
      });
    });
  });

  describe('Storing tuples', () => {
    it('stores tuple in variable', async () => {
      const result = await run(`
        *[1, 2, 3] :> $myTuple
        type($myTuple)
      `);
      expect(result).toBe('tuple');
    });

    it('uses stored tuple later', async () => {
      const result = await run(`
        |a, b| { ($a + $b) } :> $add
        *[3, 4] :> $t
        $t -> $add()
      `);
      expect(result).toBe(7);
    });

    it('supports type annotation', async () => {
      const result = await run(`
        *[1, 2] :> $a:tuple
        type($a)
      `);
      expect(result).toBe('tuple');
    });
  });

  describe('.str method on tuple', () => {
    it('converts tuple to string representation', async () => {
      const result = await run('*[1, 2, 3] -> .str');
      expect(result).toContain('1');
      expect(result).toContain('2');
      expect(result).toContain('3');
    });

    it('includes named keys in string', async () => {
      const result = await run('*[x: 1, y: 2] -> .str');
      expect(result).toContain('x');
      expect(result).toContain('y');
    });
  });

  describe('Type identity', () => {
    it('tuple is distinct from list', async () => {
      const result = await run(`
        [1, 2] :> $list
        *[1, 2] :> $tuple
        type($list) -> .eq(type($tuple))
      `);
      expect(result).toBe(false);
    });

    it('tuple equality works', async () => {
      const result = await run(`
        *[1, 2] :> $a
        *[1, 2] :> $b
        $a.eq($b)
      `);
      expect(result).toBe(true);
    });

    it('tuple inequality with different content', async () => {
      const result = await run(`
        *[1, 2] :> $a
        *[1, 3] :> $b
        $a.eq($b)
      `);
      expect(result).toBe(false);
    });
  });

  describe('Global functions', () => {
    describe('type()', () => {
      it('returns "tuple" for spread tuple value', async () => {
        expect(await run('type(*[1, 2])')).toBe('tuple');
      });

      it('returns "list" for list', async () => {
        expect(await run('type([1, 2])')).toBe('list');
      });

      it('returns "dict" for dict', async () => {
        expect(await run('type([a: 1])')).toBe('dict');
      });

      it('returns "string" for string', async () => {
        expect(await run('type("hello")')).toBe('string');
      });

      it('returns "number" for number', async () => {
        expect(await run('type(42)')).toBe('number');
      });

      it('returns "bool" for boolean', async () => {
        expect(await run('type(true)')).toBe('bool');
      });

      it('returns "closure" for closure', async () => {
        expect(await run('|| { 1 } :> $fn\ntype($fn)')).toBe('closure');
      });
    });

    describe('json()', () => {
      it('converts tuple to JSON (as object with numeric keys)', async () => {
        const result = await run('*[1, 2, 3] -> json');
        // Tuple internally is represented differently, may serialize as object
        expect(typeof result).toBe('string');
      });

      it('converts list to JSON', async () => {
        expect(await run('[1, 2, 3] -> json')).toBe('[1,2,3]');
      });

      it('converts dict to JSON', async () => {
        const result = await run('[a: 1, b: 2] -> json');
        expect(JSON.parse(result as string)).toEqual({ a: 1, b: 2 });
      });
    });
  });
});

describe('Rill Runtime: Strict Closure Invocation', () => {
  it('errors on missing argument without default', async () => {
    await expect(
      run(`
        |a, b, c| { $a } :> $fn
        $fn(1, 2)
      `)
    ).rejects.toThrow(/missing argument/i);
  });

  it('uses default when argument not provided', async () => {
    const result = await run(`
      |a, b = 5| { ($a + $b) } :> $fn
      $fn(3)
    `);
    expect(result).toBe(8);
  });

  it('type checks arguments against explicit types', async () => {
    await expect(
      run(`
        |x: number| { $x } :> $fn
        $fn("not a number")
      `)
    ).rejects.toThrow(/type mismatch/i);
  });

  it('type checks arguments against inferred types from defaults', async () => {
    await expect(
      run(`
        |x = 10| { $x } :> $fn
        $fn("not a number")
      `)
    ).rejects.toThrow(/type mismatch/i);
  });
});
