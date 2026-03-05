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
        const result = await run('*[1, 2, 3] => $t\n$t.^type.^name');
        expect(result).toBe('tuple');
      });

      it('creates ordered from dict literal', async () => {
        const result = await run('*[x: 1, y: 2] => $t\n$t.^type.^name');
        expect(result).toBe('ordered');
      });

      it('creates tuple from list variable', async () => {
        const result = await run('[1, 2] => $t\n*$t => $u\n$u.^type.^name');
        expect(result).toBe('tuple');
      });

      it('creates ordered from dict variable', async () => {
        const result = await run('[a: 1] => $d\n*$d => $u\n$u.^type.^name');
        expect(result).toBe('ordered');
      });
    });

    describe('Pipe target form: -> *', () => {
      it('list pipe to * creates tuple', async () => {
        const result = await run('[1, 2, 3] -> * => $t\n$t.^type.^name');
        expect(result).toBe('tuple');
      });

      it('dict pipe to * creates ordered', async () => {
        const result = await run('[a: 1, b: 2] -> * => $t\n$t.^type.^name');
        expect(result).toBe('ordered');
      });
    });
  });

  describe('Args unpacking at invocation', () => {
    describe('Positional args (from list spread)', () => {
      it('unpacks list as positional args via tuple', async () => {
        const result = await run(`
          |x, y| { ($x + $y) } => $add
          *[3, 4] -> $add()
        `);
        expect(result).toBe(7);
      });
    });

    describe('Named args (from dict)', () => {
      it('unpacks dict by parameter name', async () => {
        const result = await run(`
          |a, b, c| { "{$a}-{$b}-{$c}" } => $fmt
          *[c: 3, a: 1, b: 2] -> $fmt()
        `);
        expect(result).toBe('1-2-3');
      });

      it('allows any order for named args', async () => {
        const result = await run(`
          |width, height| { ($width * $height) } => $area
          *[height: 20, width: 10] -> $area()
        `);
        expect(result).toBe(200);
      });
    });
  });

  describe('Parameter defaults', () => {
    it('applies defaults for missing named args', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        *[x: 5] -> $fn()
      `);
      expect(result).toBe(35); // 5 + 10 + 20
    });

    it('overrides defaults when named args provided', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        *[x: 5, y: 15] -> $fn()
      `);
      expect(result).toBe(40); // 5 + 15 + 20
    });

    it('works with named args and defaults', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        *[x: 5, z: 30] -> $fn()
      `);
      expect(result).toBe(45); // 5 + 10 + 30
    });

    it('infers type from default value', async () => {
      const result = await run(`
        |x = "hello"| { $x } => $fn
        *[x: "world"] -> $fn()
      `);
      expect(result).toBe('world');
    });
  });

  describe('Strict validation', () => {
    describe('Named args errors', () => {
      it('errors on missing named argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } => $fn
            *[x: 1] -> $fn()
          `)
        ).rejects.toThrow(/missing/i);
      });

      it('errors on unknown named argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } => $fn
            *[x: 1, y: 2, z: 3] -> $fn()
          `)
        ).rejects.toThrow(/unknown/i);
      });
    });

    describe('Regular invocation strict mode', () => {
      it('errors when missing required argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } => $fn
            $fn(1)
          `)
        ).rejects.toThrow(/missing/i);
      });
    });
  });

  describe('Storing ordered spread values', () => {
    it('stores ordered value in variable', async () => {
      const result = await run(`
        *[x: 1, y: 2] => $myOrdered
        $myOrdered.^type.^name
      `);
      expect(result).toBe('ordered');
    });

    it('uses stored ordered spread for named arg call', async () => {
      const result = await run(`
        |a, b| { ($a + $b) } => $add
        *[a: 3, b: 4] => $t
        $t -> $add()
      `);
      expect(result).toBe(7);
    });

    it('supports type annotation with ordered', async () => {
      const result = await run(`
        *[x: 1, y: 2] => $a:ordered
        $a.^type.^name
      `);
      expect(result).toBe('ordered');
    });
  });

  describe('.str method on ordered spread', () => {
    it('includes named keys in string', async () => {
      const result = await run('*[x: 1, y: 2] -> .str');
      expect(result).toContain('x');
      expect(result).toContain('y');
    });
  });

  describe('Type identity', () => {
    it('ordered is distinct from list', async () => {
      const result = await run(`
        [1, 2] => $list
        *[a: 1, b: 2] => $ordered
        $list.^type.^name -> .eq($ordered.^type.^name)
      `);
      expect(result).toBe(false);
    });

    it('ordered equality works', async () => {
      const result = await run(`
        *[a: 1, b: 2] => $a
        *[a: 1, b: 2] => $b
        $a.eq($b)
      `);
      expect(result).toBe(true);
    });

    it('ordered inequality with different content', async () => {
      const result = await run(`
        *[a: 1, b: 2] => $a
        *[a: 1, b: 3] => $b
        $a.eq($b)
      `);
      expect(result).toBe(false);
    });
  });

  describe('Global functions', () => {
    describe('.^type.^name operator', () => {
      it('returns "ordered" for dict spread value', async () => {
        expect(await run('*[a: 1, b: 2] => $t\n$t.^type.^name')).toBe(
          'ordered'
        );
      });

      it('returns "list" for list', async () => {
        expect(await run('[1, 2] => $v\n$v.^type.^name')).toBe('list');
      });

      it('returns "dict" for dict', async () => {
        expect(await run('[a: 1] => $v\n$v.^type.^name')).toBe('dict');
      });

      it('returns "string" for string', async () => {
        expect(await run('"hello" => $v\n$v.^type.^name')).toBe('string');
      });

      it('returns "number" for number', async () => {
        expect(await run('42 => $v\n$v.^type.^name')).toBe('number');
      });

      it('returns "bool" for boolean', async () => {
        expect(await run('true => $v\n$v.^type.^name')).toBe('bool');
      });

      it('returns "closure" for closure', async () => {
        expect(await run('|| { 1 } => $fn\n$fn.^type.^name')).toBe('closure');
      });
    });

    describe('json()', () => {
      it('throws on ordered spread serialization to JSON', async () => {
        await expect(run('*[a: 1, b: 2] -> json')).rejects.toThrow(
          'ordered values are not JSON-serializable'
        );
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
        |a, b, c| { $a } => $fn
        $fn(1, 2)
      `)
    ).rejects.toThrow(/missing argument/i);
  });

  it('uses default when argument not provided', async () => {
    const result = await run(`
      |a, b = 5| { ($a + $b) } => $fn
      $fn(3)
    `);
    expect(result).toBe(8);
  });

  it('type checks arguments against explicit types', async () => {
    await expect(
      run(`
        |x: number| { $x } => $fn
        $fn("not a number")
      `)
    ).rejects.toThrow(/type mismatch/i);
  });

  it('type checks arguments against inferred types from defaults', async () => {
    await expect(
      run(`
        |x = 10| { $x } => $fn
        $fn("not a number")
      `)
    ).rejects.toThrow(/type mismatch/i);
  });
});
