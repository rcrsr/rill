/**
 * Rill Runtime Tests: Tuple Type (Spread Args)
 * Tests for tuple type, * (spread) operator, and strict closure invocation
 */

import { describe, expect, it } from 'vitest';
import { callable, isTuple, parse, ParseError } from '@rcrsr/rill';

import { run } from '../helpers/runtime.js';

// ============================================================
// EXPLICIT SPREAD CALL SYNTAX TESTS (AC-1 through AC-27)
// ============================================================

describe('explicit spread call syntax', () => {
  // ----------------------------------------------------------
  // Success cases: AC-1 through AC-10, AC-23, AC-24, AC-25
  // ----------------------------------------------------------

  it('AC-1: tuple pipe spread binds positional params', async () => {
    const result = await run(`
      |a, b| { ($a + $b) } => $fn
      tuple[1, 2] -> $fn(...)
    `);
    expect(result).toBe(3);
  });

  it('AC-2: ordered pipe spread binds by name', async () => {
    const result = await run(`
      |a, b| { ($a + $b) } => $fn
      ordered[a: 1, b: 2] -> $fn(...)
    `);
    expect(result).toBe(3);
  });

  it('AC-3: dict pipe spread binds by name regardless of order', async () => {
    const result = await run(`
      |a, b, c| { ($a + $b + $c) } => $fn
      dict[c: 3, a: 1, b: 2] -> $fn(...)
    `);
    expect(result).toBe(6);
  });

  it('AC-4: stored tuple spread via explicit ...expr', async () => {
    const result = await run(`
      |a, b| { ($a + $b) } => $fn
      tuple[1, 2] => $t
      $fn(...$t)
    `);
    expect(result).toBe(3);
  });

  it('AC-5: positional arg followed by ordered inline spread', async () => {
    const result = await run(`
      |a, b, c| { ($a + $b + $c) } => $fn
      $fn(1, ...ordered[b: 2, c: 3])
    `);
    expect(result).toBe(6);
  });

  it('AC-6: positional args followed by tuple inline spread', async () => {
    const result = await run(`
      |a, b, c| { ($a + $b + $c) } => $fn
      $fn(1, 2, ...tuple[3])
    `);
    expect(result).toBe(6);
  });

  it('AC-7: bare ... is identical to ...$', async () => {
    const withBare = await run(`
      |a, b| { ($a + $b) } => $fn
      tuple[3, 4] -> $fn(...)
    `);
    const withExplicit = await run(`
      |a, b| { ($a + $b) } => $fn
      tuple[3, 4] -> $fn(...$)
    `);
    expect(withBare).toBe(withExplicit);
  });

  it('AC-8: no spread — tuple passed as single arg to host function', async () => {
    let received: unknown = undefined;
    await run('tuple[3, 4] -> captureArg()', {
      functions: {
        captureArg: {
          params: [{ name: 'x', type: 'any' }],
          fn: (args) => {
            received = args[0];
            return null;
          },
        },
      },
    });
    expect(isTuple(received)).toBe(true);
  });

  it('AC-9: no spread — ordered value passed as single arg to host function', async () => {
    let received: unknown = undefined;
    await run('ordered[a: 1] -> captureArg()', {
      functions: {
        captureArg: {
          params: [{ name: 'x', type: 'any' }],
          fn: (args) => {
            received = args[0];
            return null;
          },
        },
      },
    });
    expect(received).not.toBeNull();
    expect(typeof received).toBe('object');
    // ordered values carry the __rill_ordered marker
    expect((received as Record<string, unknown>).__rill_ordered).toBe(true);
  });

  it('AC-10: dict-bound closure invoked with spread', async () => {
    // $obj.method(...$args) is a parse error (AC-21), so extract the closure first
    const result = await run(`
      |a, b| { ($a + $b) } => $process
      dict[process: $process] => $obj
      $obj.process => $fn
      tuple[3, 4] -> $fn(...)
    `);
    expect(result).toBe(7);
  });

  it('AC-23: spread of empty dict with zero params — no error', async () => {
    const result = await run(`
      || { 42 } => $fn
      dict[] -> $fn(...)
    `);
    expect(result).toBe(42);
  });

  it('AC-24: spread of single-element tuple binds single param', async () => {
    const result = await run(`
      |a| { $a } => $fn
      $fn(...tuple[1])
    `);
    expect(result).toBe(1);
  });

  it('AC-25: ordered dispatch takes priority over dict dispatch (isOrdered before isDict)', async () => {
    // ordered[a: 1, b: 2] must succeed via ordered path (key+position check)
    // and must NOT take the dict-by-name path (which ignores order)
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        ordered[b: 2, a: 1] -> $fn(...)
      `)
    ).rejects.toThrow(/does not match expected parameter/i);
  });

  // ----------------------------------------------------------
  // Error cases: AC-11 through AC-19, AC-22, AC-26, AC-27
  // ----------------------------------------------------------

  it('AC-11 (EC-3): bare ... with no active pipe value errors', async () => {
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        $fn(...)
      `)
    ).rejects.toThrow(/\$/);
  });

  it('AC-12 (EC-4): string pipe to spread errors naming the type', async () => {
    await expect(
      run(`
        |a| { $a } => $fn
        "hello" -> $fn(...)
      `)
    ).rejects.toThrow(/string/i);
  });

  it('AC-13 (EC-5): dict spread with unknown key errors', async () => {
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        dict[a: 1, z: 2] -> $fn(...)
      `)
    ).rejects.toThrow(/z/);
  });

  it('AC-14 (EC-6): ordered spread key order mismatch errors', async () => {
    await expect(
      run(`
        |a, b, c| { 1 } => $fn
        ordered[c: 3, a: 1, b: 2] -> $fn(...)
      `)
    ).rejects.toThrow(/does not match expected parameter/i);
  });

  it('AC-15 (EC-7): duplicate param binding via positional + ordered spread errors', async () => {
    await expect(
      run(`
        |a, b, c| { 1 } => $fn
        $fn(1, ...ordered[a: 2, b: 3])
      `)
    ).rejects.toThrow(/does not match expected parameter/i);
  });

  it('AC-16 (EC-9): tuple spread with more values than remaining params errors', async () => {
    await expect(
      run(`
        |a| { $a } => $fn
        $fn(...tuple[1, 2])
      `)
    ).rejects.toThrow(/2 values/i);
  });

  it('AC-17 (EC-8): dict spread missing required param errors', async () => {
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        dict[a: 1] -> $fn(...)
      `)
    ).rejects.toThrow(/missing required parameter/i);
  });

  it('AC-18 (EC-10): spread on built-in log() errors', async () => {
    await expect(run('42 -> log(...)')).rejects.toThrow(
      /spread not supported for built-in/i
    );
  });

  it('AC-19 (EC-11): spread on host function without params metadata errors', async () => {
    await expect(
      run('tuple[1, 2] -> $myFn(...)', {
        variables: {
          myFn: callable((args) => args[0]),
        },
      })
    ).rejects.toThrow(/parameter metadata required/i);
  });

  it('AC-22 (Boundary): spread of empty tuple with required params errors', async () => {
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        $fn(...tuple[])
      `)
    ).rejects.toThrow(/missing required parameter/i);
  });

  it('AC-26 (Boundary): spread of closure type errors', async () => {
    await expect(
      run(`
        || { 1 } => $t
        |a| { $a } => $fn
        $fn(...$t)
      `)
    ).rejects.toThrow(/closure/i);
  });

  it('AC-27 (Boundary): spread with zero remaining params after positional binding errors', async () => {
    await expect(
      run(`
        |a, b| { ($a + $b) } => $fn
        $fn(1, 2, ...tuple[3])
      `)
    ).rejects.toThrow(/only 0 parameter/i);
  });

  // ----------------------------------------------------------
  // Parse error cases: AC-20, AC-21
  // ----------------------------------------------------------

  it('AC-20 (EC-1): multiple spreads per call is a parse error', () => {
    expect(() => parse('$fn(...$a, ...$b)')).toThrow(ParseError);
  });

  it('AC-21 (EC-2): spread in method call argument list is a parse error', () => {
    expect(() => parse('$obj.method(...$args)')).toThrow();
  });
});

describe('Rill Runtime: Tuple Type (Spread Args)', () => {
  describe('Spread operator *', () => {
    describe('Prefix form: *expr', () => {
      it('creates tuple from list literal', async () => {
        const result = await run('tuple[1, 2, 3] => $t\n$t.^type.^name');
        expect(result).toBe('tuple');
      });

      it('creates ordered from dict literal', async () => {
        const result = await run('ordered[x: 1, y: 2] => $t\n$t.^type.^name');
        expect(result).toBe('ordered');
      });

      it('creates tuple from list variable', async () => {
        const result = await run(
          'list[1, 2] => $t\n$t -> :>tuple => $u\n$u.^type.^name'
        );
        expect(result).toBe('tuple');
      });

      it('creates ordered from dict variable', async () => {
        const result = await run(
          'dict[a: 1] => $d\n$d -> :>ordered(a: number) => $u\n$u.^type.^name'
        );
        expect(result).toBe('ordered');
      });
    });

    describe('Pipe target form: -> :>type', () => {
      it('list pipe to :>tuple creates tuple', async () => {
        const result = await run(
          'list[1, 2, 3] -> :>tuple => $t\n$t.^type.^name'
        );
        expect(result).toBe('tuple');
      });

      it('ordered pipe to :>dict creates dict', async () => {
        const result = await run(
          'ordered[a: 1, b: 2] -> :>dict => $t\n$t.^type.^name'
        );
        expect(result).toBe('dict');
      });
    });
  });

  describe('Args unpacking at invocation', () => {
    describe('Positional args (from list spread)', () => {
      it('unpacks list as positional args via tuple', async () => {
        const result = await run(`
          |x, y| { ($x + $y) } => $add
          tuple[3, 4] -> $add(...)
        `);
        expect(result).toBe(7);
      });
    });

    describe('Named args (from dict)', () => {
      it('unpacks dict by parameter name', async () => {
        const result = await run(`
          |a, b, c| { "{$a}-{$b}-{$c}" } => $fmt
          ordered[a: 1, b: 2, c: 3] -> $fmt(...)
        `);
        expect(result).toBe('1-2-3');
      });

      it('allows any order for named args', async () => {
        const result = await run(`
          |width, height| { ($width * $height) } => $area
          ordered[width: 10, height: 20] -> $area(...)
        `);
        expect(result).toBe(200);
      });
    });
  });

  describe('Parameter defaults', () => {
    it('applies defaults for missing named args', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        ordered[x: 5] -> $fn(...)
      `);
      expect(result).toBe(35); // 5 + 10 + 20
    });

    it('overrides defaults when named args provided', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        ordered[x: 5, y: 15] -> $fn(...)
      `);
      expect(result).toBe(40); // 5 + 15 + 20
    });

    it('works with named args and defaults', async () => {
      const result = await run(`
        |x, y = 10, z = 20| { ($x + $y + $z) } => $fn
        dict[x: 5, z: 30] -> $fn(...)
      `);
      expect(result).toBe(45); // 5 + 10 + 30
    });

    it('infers type from default value', async () => {
      const result = await run(`
        |x = "hello"| { $x } => $fn
        ordered[x: "world"] -> $fn(...)
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
            ordered[x: 1] -> $fn(...)
          `)
        ).rejects.toThrow(/missing/i);
      });

      it('errors on unknown named argument', async () => {
        await expect(
          run(`
            |x, y| { ($x + $y) } => $fn
            dict[x: 1, y: 2, z: 3] -> $fn(...)
          `)
        ).rejects.toThrow(/does not match any parameter/i);
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
        ordered[x: 1, y: 2] => $myOrdered
        $myOrdered.^type.^name
      `);
      expect(result).toBe('ordered');
    });

    it('uses stored ordered spread for named arg call', async () => {
      const result = await run(`
        |a, b| { ($a + $b) } => $add
        ordered[a: 3, b: 4] => $t
        $t -> $add(...)
      `);
      expect(result).toBe(7);
    });

    it('supports type annotation with ordered', async () => {
      const result = await run(`
        ordered[x: 1, y: 2] => $a:ordered
        $a.^type.^name
      `);
      expect(result).toBe('ordered');
    });
  });

  describe('.str method on ordered spread', () => {
    it('includes named keys in string', async () => {
      const result = await run('ordered[x: 1, y: 2] -> .str');
      expect(result).toContain('x');
      expect(result).toContain('y');
    });
  });

  describe('Type identity', () => {
    it('ordered is distinct from list', async () => {
      const result = await run(`
        list[1, 2] => $list
        ordered[a: 1, b: 2] => $ordered
        $list.^type.^name -> .eq($ordered.^type.^name)
      `);
      expect(result).toBe(false);
    });

    it('ordered equality works', async () => {
      const result = await run(`
        ordered[a: 1, b: 2] => $a
        ordered[a: 1, b: 2] => $b
        $a.eq($b)
      `);
      expect(result).toBe(true);
    });

    it('ordered inequality with different content', async () => {
      const result = await run(`
        ordered[a: 1, b: 2] => $a
        ordered[a: 1, b: 3] => $b
        $a.eq($b)
      `);
      expect(result).toBe(false);
    });
  });

  describe('Global functions', () => {
    describe('.^type.^name operator', () => {
      it('returns "ordered" for dict spread value', async () => {
        expect(await run('ordered[a: 1, b: 2] => $t\n$t.^type.^name')).toBe(
          'ordered'
        );
      });

      it('returns "list" for list', async () => {
        expect(await run('list[1, 2] => $v\n$v.^type.^name')).toBe('list');
      });

      it('returns "dict" for dict', async () => {
        expect(await run('dict[a: 1] => $v\n$v.^type.^name')).toBe('dict');
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
        await expect(run('ordered[a: 1, b: 2] -> json')).rejects.toThrow(
          'ordered values are not JSON-serializable'
        );
      });

      it('converts list to JSON', async () => {
        expect(await run('list[1, 2, 3] -> json')).toBe('[1,2,3]');
      });

      it('converts dict to JSON', async () => {
        const result = await run('dict[a: 1, b: 2] -> json');
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
