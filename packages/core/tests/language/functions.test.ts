/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Runtime Tests: Built-in Methods (formerly functions)
 * Tests for identity, str, num, len, join, split, trim, first, last, at
 */

import { describe, expect, it } from 'vitest';

import { expectRuntimeError } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

describe('Rill Runtime: Built-in Functions', () => {
  describe('identity', () => {
    rule('identity.value').it('returns string unchanged', async () => {
      expect(await run('identity("x")')).toBe('x');
    });

    rule('identity.value').it('returns number unchanged', async () => {
      expect(await run('identity(42)')).toBe(42);
    });

    rule('identity.value').it('returns tuple unchanged', async () => {
      expect(await run('identity(list[1, 2, 3])')).toEqual([1, 2, 3]);
    });

    it('works with pipe', async () => {
      expect(await run('"test" -> identity')).toBe('test');
    });
  });
});

describe('Rill Runtime: Built-in Methods', () => {
  describe('-> string on an undefined variable', () => {
    it('errors for undefined variable (no null in rill)', async () => {
      await expect(run('$undefined -> string')).rejects.toThrow(
        'Undefined variable'
      );
    });
  });

  describe('.len', () => {
    it('returns string length', async () => {
      expect(await run('"hello" -> .len')).toBe(5);
    });

    it('returns empty string length as 0', async () => {
      expect(await run('"" -> .len')).toBe(0);
    });

    it('returns tuple length', async () => {
      expect(await run('list[1, 2, 3] -> .len')).toBe(3);
    });

    it('returns empty tuple length as 0', async () => {
      expect(await run('list[] -> .len')).toBe(0);
    });

    it('returns dict entry count', async () => {
      expect(await run('dict[a: 1, b: 2] -> .len')).toBe(2);
    });

    it('returns empty dict length as 0', async () => {
      expect(await run('dict[] -> .len')).toBe(0);
    });

    it('works with method chain', async () => {
      expect(await run('"test" -> .len')).toBe(4);
    });
  });

  describe('.join', () => {
    rule('list.join.default').it(
      'joins with default separator (comma)',
      async () => {
        expect(await run('list["a", "b", "c"] -> .join')).toBe('a,b,c');
      }
    );

    rule('list.join.separator').it('joins with custom separator', async () => {
      expect(await run('list["a", "b", "c"] -> .join("-")')).toBe('a-b-c');
    });

    rule('list.join.separator').it('joins with empty separator', async () => {
      expect(await run('list["a", "b", "c"] -> .join("")')).toBe('abc');
    });

    it('joins single element', async () => {
      expect(await run('list["only"] -> .join')).toBe('only');
    });

    rule('list.join.separator').it(
      'returns empty string for empty tuple',
      async () => {
        expect(await run('list[] -> .join')).toBe('');
      }
    );

    rule('list.join.separator').it('converts non-string elements', async () => {
      expect(await run('list[1, 2, 3] -> .join(":")')).toBe('1:2:3');
    });
  });

  describe('.split', () => {
    it('splits with default separator (newline)', async () => {
      expect(await run('"a\\nb\\nc" -> .split')).toEqual(['a', 'b', 'c']);
    });

    it('splits with custom separator', async () => {
      expect(await run('"a-b-c" -> .split("-")')).toEqual(['a', 'b', 'c']);
    });

    it('returns single element for no matches', async () => {
      expect(await run('"abc" -> .split("-")')).toEqual(['abc']);
    });

    it('handles empty string', async () => {
      expect(await run('"" -> .split("-")')).toEqual(['']);
    });

    it('works with method chain', async () => {
      expect(await run('"a:b:c" -> .split(":")')).toEqual(['a', 'b', 'c']);
    });
  });

  describe('.trim', () => {
    it('trims leading whitespace', async () => {
      expect(await run('"  hello" -> .trim')).toBe('hello');
    });

    it('trims trailing whitespace', async () => {
      expect(await run('"hello  " -> .trim')).toBe('hello');
    });

    it('trims both ends', async () => {
      expect(await run('"  hello  " -> .trim')).toBe('hello');
    });

    it('trims tabs and newlines', async () => {
      expect(await run('"\\t\\nhello\\n\\t" -> .trim')).toBe('hello');
    });

    it('returns empty for whitespace only', async () => {
      expect(await run('"   " -> .trim')).toBe('');
    });

    it('returns unchanged if no whitespace', async () => {
      expect(await run('"hello" -> .trim')).toBe('hello');
    });

    it('works with method chain', async () => {
      expect(await run('"  test  " -> .trim')).toBe('test');
    });
  });

  describe('.head', () => {
    it('returns first list element', async () => {
      expect(await run('list["a", "b", "c"] -> .head')).toBe('a');
    });

    it('returns first string character', async () => {
      expect(await run('"abc" -> .head')).toBe('a');
    });

    it('errors on empty list', async () => {
      await expect(run('list[] -> .head')).rejects.toThrow(
        'Cannot get head of empty list'
      );
    });

    it('errors on empty string', async () => {
      await expect(run('"" -> .head')).rejects.toThrow(
        'Cannot get head of empty string'
      );
    });

    it('works with method chain', async () => {
      expect(await run('list[1, 2, 3] -> .head')).toBe(1);
    });
  });

  describe('.tail', () => {
    it('returns last list element', async () => {
      expect(await run('list["a", "b", "c"] -> .tail')).toBe('c');
    });

    it('returns last string character', async () => {
      expect(await run('"abc" -> .tail')).toBe('c');
    });

    it('errors on empty list', async () => {
      await expect(run('list[] -> .tail')).rejects.toThrow(
        'Cannot get tail of empty list'
      );
    });

    it('errors on empty string', async () => {
      await expect(run('"" -> .tail')).rejects.toThrow(
        'Cannot get tail of empty string'
      );
    });

    it('works with method chain', async () => {
      expect(await run('list[1, 2, 3] -> .tail')).toBe(3);
    });
  });

  describe('.at', () => {
    it('returns tuple element at index', async () => {
      expect(await run('list["a", "b", "c"] -> .at(1)')).toBe('b');
    });

    it('returns first element at index 0', async () => {
      expect(await run('list["a", "b", "c"] -> .at(0)')).toBe('a');
    });

    it('returns string character at index', async () => {
      expect(await run('"abc" -> .at(2)')).toBe('c');
    });

    it('errors for out of bounds', async () => {
      await expect(run('list["a"] -> .at(5)')).rejects.toThrow(
        'List index out of bounds'
      );
    });

    it('wraps a negative index from the end', async () => {
      expect(await run('list["a", "b"] -> .at(-1)')).toBe('b');
    });
  });
});

describe('Rill Runtime: Closures', () => {
  describe('Function Literals', () => {
    it('creates and invokes a closure', async () => {
      expect(await run('fn(x) { $x } => $fn\n$fn("hello")')).toBe('hello');
    });

    it('invokes closure with pipe-style', async () => {
      expect(await run('fn(x) { $x } => $fn\n"hello" -> $fn()')).toBe('hello');
    });

    it('uses default parameter value', async () => {
      expect(await run('fn(x: string = "default") { $x } => $fn\n$fn()')).toBe(
        'default'
      );
    });

    it('overrides default parameter', async () => {
      expect(
        await run('fn(x: string = "default") { $x } => $fn\n$fn("custom")')
      ).toBe('custom');
    });

    it('captures outer scope variables', async () => {
      expect(
        await run(
          '"outer" => $ctx\nfn(x) { "{$ctx}: {$x}" } => $fn\n$fn("inner")'
        )
      ).toBe('outer: inner');
    });
  });

  describe('No Implied $ for Closures', () => {
    it('$fn() receives $ implicitly when closure has params', async () => {
      expect(await run('fn(x) { $x } => $fn\n"hello" -> $fn()')).toBe('hello');
    });

    it('$fn() in for loop receives no loop value', async () => {
      await expectRuntimeError(
        () =>
          run('fn(x) { $x } => $echo\nlist[1, 2, 3] -> seq(fn(n) { $echo() })'),
        { code: 'RILL-R044', messagePattern: /Missing argument for parameter/ }
      );
    });

    it('$fn() does not receive $ when args are explicit', async () => {
      expect(
        await run('fn(x) { $x } => $fn\n"ignored" -> { $\n$fn("explicit") }')
      ).toBe('explicit');
    });
  });

  describe('Parameter Type Checking', () => {
    it('accepts correct type for string parameter', async () => {
      expect(await run('fn(x: string) { $x } => $fn\n$fn("hello")')).toBe(
        'hello'
      );
    });

    it('accepts correct type for number parameter', async () => {
      expect(await run('fn(x: number) { $x } => $fn\n$fn(42)')).toBe(42);
    });

    it('accepts correct type for bool parameter', async () => {
      expect(await run('fn(x: bool) { $x } => $fn\n$fn(true)')).toBe(true);
    });

    rule('invocation.type').it(
      'rejects number for string parameter',
      async () => {
        await expect(
          run('fn(x: string) { $x } => $fn\n$fn(42)')
        ).rejects.toThrow(
          'Parameter type mismatch: x expects string, got number'
        );
      }
    );

    rule('invocation.type').it(
      'rejects string for number parameter',
      async () => {
        await expect(
          run('fn(x: number) { $x } => $fn\n$fn("hello")')
        ).rejects.toThrow(
          'Parameter type mismatch: x expects number, got string'
        );
      }
    );

    rule('invocation.type').it(
      'rejects string for bool parameter',
      async () => {
        await expect(
          run('fn(x: bool) { $x } => $fn\n$fn("true")')
        ).rejects.toThrow(
          'Parameter type mismatch: x expects bool, got string'
        );
      }
    );

    it('rejects number in for loop with string param', async () => {
      await expect(
        run('fn(r: string) { $r } => $fn\nlist[1, 2, 3] -> seq({ $fn($) })')
      ).rejects.toThrow(
        'Parameter type mismatch: r expects string, got number'
      );
    });

    it('accepts string in for loop with string param', async () => {
      expect(
        await run(
          'fn(r: string) { $r } => $fn\nlist["a", "b"] -> seq({ $fn($) })'
        )
      ).toEqual(['a', 'b']);
    });

    it('validates type with typed default', async () => {
      expect(await run('fn(x: string = "default") { $x } => $fn\n$fn()')).toBe(
        'default'
      );
    });

    it('validates type when overriding default', async () => {
      await expect(
        run('fn(x: string = "default") { $x } => $fn\n$fn(123)')
      ).rejects.toThrow(
        'Parameter type mismatch: x expects string, got number'
      );
    });
  });
});

describe('Rill Runtime: Invocation', () => {
  rule('invocation.positional').it('binds arguments by position', async () => {
    expect(
      await run('fn(a: number, b: number) { $a - $b } => $f\n$f(5, 2)')
    ).toBe(3);
    expect(
      await run('fn(a: number, b: number) { $a - $b } => $f\n$f(2, 5)')
    ).toBe(-3);
  });

  rule('invocation.arguments-first').it(
    'evaluates every argument before checking the argument count',
    async () => {
      await expect(
        run(
          'fn() { error "argument ran" } => $g\nfn(a) { $a } => $f\n$f(1, $g())'
        )
      ).rejects.toThrow('argument ran');
    }
  );

  rule('invocation.arguments-first').it(
    'evaluates every argument before checking parameter types',
    async () => {
      await expect(
        run(
          'fn() { error "argument ran" } => $g\nfn(a: number, b: number) { $a } => $f\n$f("s", $g())'
        )
      ).rejects.toThrow('argument ran');
    }
  );

  rule('invocation.arguments-first').it(
    'evaluates arguments left to right',
    async () => {
      await expect(
        run(
          'fn() { error "first" } => $g1\nfn() { error "second" } => $g2\nfn(a, b) { $a } => $f\n$f($g1(), $g2())'
        )
      ).rejects.toThrow('first');
    }
  );

  rule('invocation.type').it(
    'reports the first failing parameter in order',
    async () => {
      await expect(
        run('fn(a: number, b: string) { $a } => $f\n$f("x", 1)')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
        message: expect.stringContaining('a expects number, got string'),
      });
      await expect(
        run('fn(a: number, b: string) { $a } => $f\n$f(1, 1)')
      ).rejects.toMatchObject({
        errorId: 'RILL-R001',
        message: expect.stringContaining('b expects string, got number'),
      });
    }
  );

  rule('invocation.before-body').it(
    'does not run the body when a parameter fails its type',
    async () => {
      await expect(
        run('fn(a: number) { error "body ran" } => $f\n$f("x")')
      ).rejects.toMatchObject({ errorId: 'RILL-R001' });
    }
  );

  rule('invocation.before-body').it(
    'does not run the body when an argument is missing',
    async () => {
      await expect(
        run('fn(a, b) { error "body ran" } => $f\n$f(1)')
      ).rejects.toMatchObject({ errorId: 'RILL-R044' });
    }
  );

  rule('invocation.no-named').it(
    'rejects a name: value argument in every call form',
    async () => {
      for (const source of [
        'fn(a) { $a } => $f\n$f(a: 1)',
        'fn(a) { $a } => $f\n1 -> $f(a: 1)',
        'log(message: 1)',
        'list[1, 2] -> .join(sep: ",")',
      ]) {
        await expect(run(source)).rejects.toMatchObject({
          errorId: 'RILL-P001',
        });
      }
    }
  );

  rule('invocation.bare-name').it(
    'calls a bare built-in name with no arguments',
    async () => {
      expect(await run('now => $t\n$t.^type.signature')).toBe('datetime');
      expect(await run('fn(x) { $x.^type.signature } => $f\n$f(now)')).toBe(
        'datetime'
      );
      await expect(run('log')).rejects.toMatchObject({
        errorId: 'RILL-R044',
      });
    }
  );
});
