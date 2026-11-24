/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Capture Type Assertions
 * Tests for type-asserted variable capture ($var:type)
 */

import { describe, expect, it } from 'vitest';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run, runWithContext } from '../helpers/runtime.js';

describe('Rill Runtime: Capture Type Assertions', () => {
  describe('String Type', () => {
    it('captures string with string type', async () => {
      expect(await run('"hello" => $s:string\n$s')).toBe('hello');
    });

    it('rejects number captured as string', async () => {
      await expectHalt(() => run('42 => $s:string'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('rejects bool captured as string', async () => {
      await expectHalt(() => run('true => $s:string'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Number Type', () => {
    it('captures number with number type', async () => {
      expect(await run('42 => $n:number\n$n')).toBe(42);
    });

    it('captures decimal with number type', async () => {
      expect(await run('3.14 => $n:number\n$n')).toBe(3.14);
    });

    it('captures negative number', async () => {
      expect(await run('-5 => $n:number\n$n')).toBe(-5);
    });

    it('rejects string captured as number', async () => {
      await expectHalt(() => run('"42" => $n:number'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Bool Type', () => {
    it('captures true with bool type', async () => {
      expect(await run('true => $b:bool\n$b')).toBe(true);
    });

    it('captures false with bool type', async () => {
      expect(await run('false => $b:bool\n$b')).toBe(false);
    });

    it('rejects string captured as bool', async () => {
      await expectHalt(() => run('"true" => $b:bool'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('rejects number captured as bool', async () => {
      await expectHalt(() => run('1 => $b:bool'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('List Type', () => {
    it('captures list with list type', async () => {
      expect(await run('list[1, 2, 3] => $t:list\n$t')).toEqual([1, 2, 3]);
    });

    it('captures empty list', async () => {
      expect(await run('list[] => $t:list\n$t')).toEqual([]);
    });

    it('rejects dict captured as list', async () => {
      await expectHalt(() => run('dict[a: 1] => $t:list'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('rejects string captured as list', async () => {
      await expectHalt(() => run('"abc" => $t:list'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Dict Type', () => {
    it('captures dict with dict type', async () => {
      expect(await run('dict[a: 1, b: 2] => $d:dict\n$d')).toEqual({
        a: 1,
        b: 2,
      });
    });

    it('captures empty dict', async () => {
      expect(await run('dict[] => $d:dict\n$d')).toEqual({});
    });

    it('rejects tuple captured as dict', async () => {
      await expectHalt(() => run('list[1, 2] => $d:dict'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Closure Type', () => {
    it('captures closure with closure type', async () => {
      expect(await run('fn() { "x" } => $fn:fn\n$fn()')).toBe('x');
    });

    it('captures parameterized closure', async () => {
      expect(await run('fn(x) { $x } => $fn:fn\n$fn("test")')).toBe('test');
    });

    it('rejects string captured as closure', async () => {
      await expectHalt(() => run('"fn" => $fn:fn'), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Type Validation in Context', () => {
    it('validates type in for loop capture', async () => {
      // Each iteration captures as number
      const script = `list[1, 2, 3] -> seq({ $ => $n:number\n$n })`;
      expect(await run(script)).toEqual([1, 2, 3]);
    });

    it('rejects wrong type in for loop', async () => {
      const script = `list["a", "b"] -> seq({ $ => $n:number })`;
      await expectHalt(() => run(script), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('validates type in conditional branch', async () => {
      const script = `true -> ? { 42 => $n:number\n$n } ! { 0 }`;
      expect(await run(script)).toBe(42);
    });

    it('validates type after function call', async () => {
      const script = `"hello" -> .len => $n:number\n$n`;
      expect(await run(script)).toBe(5);
    });
  });

  describe('Type Annotation with Inline Capture', () => {
    it('validates type in middle of pipe chain', async () => {
      const script = `"hello" => $s:string -> .len`;
      expect(await run(script)).toBe(5);
    });

    it('rejects wrong type in middle of chain', async () => {
      const script = `42 => $s:string -> string`;
      await expectHalt(() => run(script), {
        code: 'TYPE_MISMATCH',
      });
    });
  });

  describe('Untyped Capture', () => {
    it('accepts any type without annotation', async () => {
      expect(await run('"string" => $v\n$v')).toBe('string');
      expect(await run('42 => $v\n$v')).toBe(42);
      expect(await run('true => $v\n$v')).toBe(true);
      expect(await run('list[1, 2] => $v\n$v')).toEqual([1, 2]);
    });

    rule('capture.assert', 'capture.mismatch').it(
      'runs the type assertion before the lock check',
      async () => {
        await expectHalt(() => run('"a" => $x\n5 => $x:string'), {
          code: 'TYPE_MISMATCH',
        });
        await expectHalt(() => run('"a" => $x\n5 => $x:number'), {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
        });
      }
    );

    it('halts #TYPE_MISMATCH for a typed destructure element mismatch', async () => {
      await expectHalt(() => run('list["a"] -> destruct<$n:number>'), {
        code: 'TYPE_MISMATCH',
      });
      await expectHalt(() => run('dict[a: "x"] -> destruct<a: $q:number>'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('keeps RILL-R001 for a destructure into a type-locked variable', async () => {
      await expectHalt(() => run('"a" => $n\nlist[5] -> destruct<$n>'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
    });

    it('keeps RILL-R001 for a dict destructure into a type-locked variable', async () => {
      await expectHalt(() => run('"a" => $n\ndict[a: 5] -> destruct<a: $n>'), {
        code: 'RILL_R001',
        hostErrorId: 'RILL-R001',
      });
    });

    rule('type-lock.first').it(
      'type-locks variable after first assignment',
      async () => {
        // Variables are type-locked after first assignment
        const script = `"string" => $v
42 => $v`;
        await expect(run(script)).rejects.toThrow('Type mismatch');
      }
    );

    it('allows reassignment of same type', async () => {
      const script = `"first" => $v
"second" => $v
$v`;
      expect(await run(script)).toBe('second');
    });
  });

  describe('Variables in Result', () => {
    it('captures typed variable in result', async () => {
      const { context } = await runWithContext('"hello" => $msg:string');
      expect(context.variables.get('msg')).toBe('hello');
    });

    it('captures multiple typed variables', async () => {
      // Mixed-type list [$s, $n] not allowed; verify variables directly via runWithContext
      const { context } = await runWithContext(`"a" => $s:string
42 => $n:number
$s`);
      expect(context.variables.get('s')).toBe('a');
      expect(context.variables.get('n')).toBe(42);
    });
  });

  describe('Dynamic Type Reference (AC-13)', () => {
    it('AC-13 success: $t = string, capture accepts string value', async () => {
      expect(await run('string => $t\n"hello" => $x:$t\n$x')).toBe('hello');
    });

    it('AC-13 rejection: $t = number, capture rejects string value', async () => {
      await expectHalt(() => run('number => $t\n"hello" => $x:$t'), {
        code: 'TYPE_MISMATCH',
      });
    });

    it('AC-13 capture-time resolution: $t reassigned after capture executes', async () => {
      // $x:$t is resolved when the capture runs; reassigning $t afterward has no effect
      expect(
        await run('string => $t\n"hello" => $x:$t\nnumber => $t\n$x')
      ).toBe('hello');
    });
  });

  describe('Inferred structure lock', () => {
    rule('type-lock.halt').it(
      'halts RILL-R001 at the capture, naming the variable and the locked type',
      async () => {
        await expectHalt(() => run('"hi" => $name\n42 => $name'), {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
          messagePattern: 'cannot assign number to $name (locked as string)',
        });
      }
    );

    rule('type-lock.list', 'type-lock.narrowest').it(
      'locks a list to its element type',
      async () => {
        await expectHalt(() => run('list[1] => $x\nlist["a"] => $x'), {
          code: 'RILL_R001',
          messagePattern: /locked as list\(number\)/,
        });
      }
    );

    rule('type-lock.list', 'type-lock.same').it(
      'admits a list of the locked element type on a later capture',
      async () => {
        expect(await run('list[1] => $x\nlist[1, 2] => $x\n$x')).toEqual([
          1, 2,
        ]);
      }
    );

    rule('type-lock.annotation', 'type-lock.same').it(
      'admits a later capture of any union member',
      async () => {
        expect(await run('"a" => $x:union(string, number)\n1 => $x\n$x')).toBe(
          1
        );
      }
    );

    rule('type-lock.dict', 'type-lock.narrowest').it(
      'locks a dict to its field types',
      async () => {
        await expectHalt(() => run('dict[a: 1] => $x\ndict[a: "x"] => $x'), {
          code: 'RILL_R001',
          messagePattern: /locked as dict\(a: number\)/,
        });
      }
    );

    rule('type-lock.tuple', 'type-lock.narrowest').it(
      'locks a tuple to its position types',
      async () => {
        await expectHalt(() => run('tuple[1] => $x\ntuple["a"] => $x'), {
          code: 'RILL_R001',
          messagePattern: /locked as tuple\(number\)/,
        });
      }
    );

    rule('type-lock.empty').it(
      'admits any list after an empty list capture',
      async () => {
        expect(await run('list[] => $x\nlist["a"] => $x\n$x')).toEqual(['a']);
      }
    );

    rule('type-lock.narrowest').it(
      'keeps a mixed list usable but not comparable to a mismatched element',
      async () => {
        await expectHalt(
          () => run('list[1, "a"] => $l\n$l -> seq({ $ == "a" })'),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('type-lock.narrowest').it(
      'carries the inferred structure as the captured type',
      async () => {
        expect(await run('list[1] => $x\n($x.^type == list[1].^type)')).toBe(
          true
        );
        // A kind-only lock would type this list as plain list.
        expect(await run('list[1, 2] => $x\n($x.^type == list[3].^type)')).toBe(
          true
        );
      }
    );

    rule('type-lock.narrowest').it(
      'halts when a function is recaptured with a different signature',
      async () => {
        await expectHalt(
          () =>
            run(
              'fn(a: number):number { $a } => $f\nfn(a: string):string { $a } => $f'
            ),
          {
            code: 'RILL_R001',
            messagePattern: /locked as fn\(a: number\)/,
          }
        );
      }
    );

    rule('type-lock.any').it(
      'locks an any annotation to the inferred structure',
      async () => {
        await expectHalt(() => run('list[1] => $x:any\nlist["a"] => $x'), {
          code: 'RILL_R001',
        });
      }
    );

    rule('type-lock.asserted').it(
      'locks to the asserted union a captured value carries',
      async () => {
        expect(
          await run('1 -> :union(number, string) => $x\n"a" => $x\n$x')
        ).toBe('a');
        await expectHalt(
          () => run('1 -> :union(number, string) => $x\ntrue => $x'),
          {
            code: 'RILL_R001',
            messagePattern: /locked as union\(number, string\)/,
          }
        );
      }
    );

    rule('type-lock.annotation-after').it(
      'halts a later annotation that disagrees with the lock',
      async () => {
        await expectHalt(() => run('1 => $x\n"a" => $x:string'), {
          code: 'RILL_R001',
        });
      }
    );
  });

  describe('Declaration locks', () => {
    rule('type-lock.declaration').it(
      'locks a variable to the declared type of an empty literal',
      async () => {
        await expectHalt(() => run('list(number)[] => $x\nlist["a"] => $x'), {
          code: 'RILL_R001',
          hostErrorId: 'RILL-R001',
        });
      }
    );
  });
});
