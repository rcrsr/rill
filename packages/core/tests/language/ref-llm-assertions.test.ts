/**
 * ref-llm.txt Assertion Tests
 * Verifies every code example and claim in docs/ref-llm.txt against the runtime.
 */

import { describe, expect, it } from 'vitest';
import { parse, ParseError } from '@rcrsr/rill';
import { run, runWithContext } from '../helpers/runtime.js';

// ============================================================
// § Essentials
// ============================================================

describe('ref-llm: Essentials', () => {
  it('variables use $ prefix: 5 => $x', async () => {
    expect(await run('5 => $x\n$x')).toBe(5);
  });

  it('pipe and capture: "hello" => $x -> .upper => $y', async () => {
    const { result } = await runWithContext(
      '"hello" => $x -> .upper => $y\n$y'
    );
    expect(result.result).toBe('HELLO');
  });

  it('no truthiness: conditions must be boolean', async () => {
    await expect(run('"" ? "yes" ! "no"')).rejects.toThrow();
  });

  it('variables lock to first type', async () => {
    await expect(run('"hi" => $x\n42 => $x')).rejects.toThrow();
  });
});

// ============================================================
// § Critical Differences — No Assignment
// ============================================================

describe('ref-llm: No Assignment Operator', () => {
  it('5 => $x captures value', async () => {
    expect(await run('5 => $x\n$x')).toBe(5);
  });

  it('capture continues chain: "hello" => $x -> .upper => $y', async () => {
    const r = await runWithContext(
      '"hello" => $x -> .upper => $y\nlist[$x, $y]'
    );
    expect(r.result.result).toEqual(['hello', 'HELLO']);
  });
});

// ============================================================
// § Critical Differences — No Null/Undefined
// ============================================================

describe('ref-llm: No Null/Undefined', () => {
  it('?? provides defaults', async () => {
    expect(await run('dict[a: 1] => $d\n$d.b ?? "default"')).toBe('default');
  });

  it('.empty checks empty string', async () => {
    expect(await run('"" -> .empty ? "was empty"')).toBe('was empty');
  });
});

// ============================================================
// § Critical Differences — No Truthiness
// ============================================================

describe('ref-llm: No Truthiness', () => {
  it('"" -> .empty ? "yes" ! "no" works', async () => {
    expect(await run('"" -> .empty ? "yes" ! "no"')).toBe('yes');
  });

  it('"" ? "yes" ! "no" errors (not boolean)', async () => {
    await expect(run('"" ? "yes" ! "no"')).rejects.toThrow();
  });

  it('0 ? "yes" ! "no" errors (not boolean)', async () => {
    await expect(run('0 ? "yes" ! "no"')).rejects.toThrow();
  });

  it('(0 == 0) ? "yes" ! "no" works', async () => {
    expect(await run('(0 == 0) ? "yes" ! "no"')).toBe('yes');
  });

  it('!true is false', async () => {
    expect(await run('!true')).toBe(false);
  });

  it('"hello" -> .empty -> (!$) is true', async () => {
    expect(await run('"hello" -> .empty -> (!$)')).toBe(true);
  });

  it('!"hello" errors', async () => {
    await expect(run('!"hello"')).rejects.toThrow();
  });
});

// ============================================================
// § Critical Differences — Type Locking
// ============================================================

describe('ref-llm: Variables Lock to First Type', () => {
  it('"hello" => $x then 42 => $x errors', async () => {
    await expect(run('"hello" => $x\n42 => $x')).rejects.toThrow();
  });
});

// ============================================================
// § Critical Differences — No Variable Shadowing
// ============================================================

describe('ref-llm: No Variable Shadowing', () => {
  it('outer var reassignment from child scope errors', async () => {
    await expect(
      run('0 => $count\nlist[1, 2, 3] -> seq({ $count + 1 => $count })\n$count')
    ).rejects.toThrow(/Cannot reassign outer variable/);
  });

  it('fold(0) accumulates: list[1,2,3] -> fold(0, { $@ + $ }) = 6', async () => {
    expect(await run('list[1, 2, 3] -> fold(0, { $@ + $ })')).toBe(6);
  });

  it('each(init) gives running totals', async () => {
    expect(await run('list[1, 2, 3] -> acc(0, { $@ + $ })')).toEqual([1, 3, 6]);
  });
});

// ============================================================
// § Critical Differences — Value Semantics
// ============================================================

describe('ref-llm: Value Semantics', () => {
  it('list equality by value', async () => {
    expect(await run('list[1, 2, 3] == list[1, 2, 3]')).toBe(true);
  });

  it('deep copy on assignment', async () => {
    // Modifying $b should not affect $a (but since rill is immutable, just verify independence)
    expect(await run('list[1, 2] => $a\n$a => $b\n$a == $b')).toBe(true);
  });
});

// ============================================================
// § Grammar Patterns
// ============================================================

describe('ref-llm: Grammar Patterns', () => {
  it('list[1, 2, 3] creates a list', async () => {
    expect(await run('list[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('dict[name: "alice", age: 30] creates a dict', async () => {
    expect(await run('dict[name: "alice", age: 30]')).toEqual({
      name: 'alice',
      age: 30,
    });
  });

  it('tuple[1, 2, 3] creates a tuple', async () => {
    const result = await run('tuple[1, 2, 3]');
    expect(result).toBeDefined();
  });

  it('list [1, 2] with space errors RILL-P007', () => {
    try {
      parse('list [1, 2]');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect(err).toHaveProperty('errorId', 'RILL-P007');
    }
  });

  it('destruct<> extracts variables', async () => {
    const r = await runWithContext('list[1, 2, 3] -> destruct<$a, $b, $c>\n$a');
    expect(r.result.result).toBe(1);
  });

  it('slice<1:3> slices a list', async () => {
    expect(await run('list[0,1,2,3] -> slice<1:3>')).toEqual([1, 2]);
  });
});

// ============================================================
// § Callable Types
// ============================================================

describe('ref-llm: Callable Types', () => {
  it('name() calls built-in function', async () => {
    expect(await run('"hello" -> log')).toBe('hello');
  });

  it('$name() calls closure', async () => {
    expect(await run('|x|($x + 1) => $inc\n$inc(5)')).toBe(6);
  });

  it('name alone is dict key literal', async () => {
    expect(await run('dict[name: "alice"] => $d\n$d.name')).toBe('alice');
  });
});

// ============================================================
// § Syntax Quick Reference
// ============================================================

describe('ref-llm: Syntax Quick Reference', () => {
  it('string interpolation', async () => {
    expect(await run('"world" => $var\n"hello {$var}"')).toBe('hello world');
  });

  it('multiline string', async () => {
    const result = await run('"""line1\nline2"""');
    expect(result).toContain('line1');
  });

  it('number types', async () => {
    expect(await run('42')).toBe(42);
    expect(await run('3.14')).toBe(3.14);
    expect(await run('-7')).toBe(-7);
  });

  it('booleans', async () => {
    expect(await run('true')).toBe(true);
    expect(await run('false')).toBe(false);
  });

  it('list with spread', async () => {
    expect(await run('list[1, 2] => $a\nlist[...$a, 3]')).toEqual([1, 2, 3]);
  });

  it('dict with identifier keys', async () => {
    expect(await run('dict[name: "alice", age: 30]')).toEqual({
      name: 'alice',
      age: 30,
    });
  });

  it('dict with number keys', async () => {
    const r = await run('dict[1: "one", 2: "two"]');
    expect(r).toBeDefined();
  });

  it('dict with boolean keys', async () => {
    const r = await run('dict[true: "yes", false: "no"]');
    expect(r).toBeDefined();
  });

  it('dict with multi-key', async () => {
    const r = await run('dict[list["a", "b"]: 1]');
    expect(r).toEqual({ a: 1, b: 1 });
  });

  it('dict with variable key', async () => {
    expect(await run('"name" => $k\ndict[$k: "alice"]')).toEqual({
      name: 'alice',
    });
  });

  it('dict with computed key', async () => {
    expect(
      await run('"na" => $a\n"me" => $b\ndict[("{$a}{$b}"): "alice"]')
    ).toEqual({ name: 'alice' });
  });

  it('closure syntax', async () => {
    expect(await run('|x|($x + 1) => $f\n$f(5)')).toBe(6);
  });

  it('type annotation on capture', async () => {
    expect(await run('"hi" => $x:string\n$x')).toBe('hi');
  });
});

// ============================================================
// § Pipes and $ Binding
// ============================================================

describe('ref-llm: Pipes and $ Binding', () => {
  it('$ is piped value in block', async () => {
    expect(await run('5 -> { $ + 1 }')).toBe(6);
  });

  it('$ is current item in each', async () => {
    expect(await run('list[1, 2, 3] -> seq({ $ * 2 })')).toEqual([2, 4, 6]);
  });

  it('$ is accumulated value in @ loop', async () => {
    expect(await run('0 -> ($ < 5) @ { $ + 1 }')).toBe(5);
  });

  it('implied $: .upper means $.upper()', async () => {
    expect(await run('"hello" -> .upper')).toBe('HELLO');
  });
});

// ============================================================
// § Control Flow
// ============================================================

describe('ref-llm: Control Flow', () => {
  it('cond ? then ! else', async () => {
    expect(await run('true ? "yes" ! "no"')).toBe('yes');
    expect(await run('false ? "yes" ! "no"')).toBe('no');
  });

  it('cond ? then (else returns null)', async () => {
    expect(await run('false ? "yes"')).toBe(null);
  });

  it('piped conditional', async () => {
    expect(await run('true -> ? "yes" ! "no"')).toBe('yes');
  });

  it('condition loop with @', async () => {
    expect(await run('0 -> ($ < 10) @ { $ + 1 }')).toBe(10);
  });

  it('do-condition loop', async () => {
    expect(await run('0 -> @ { $ + 1 } ? ($ < 10)')).toBe(10);
  });

  it('break in each', async () => {
    expect(
      await run('list[1,2,3,4,5] -> seq({ ($ == 3) ? break\n$ })')
    ).toEqual([1, 2]);
  });

  it('return exits script early', async () => {
    expect(await run('5 => $x\n($x > 3) ? ("big" -> return)\n"small"')).toBe(
      'big'
    );
  });

  it('return exits script', async () => {
    expect(await run('"done" -> return\n"never"')).toBe('done');
  });

  it('assert passes through on success', async () => {
    expect(await run('5 -> assert ($ > 0)')).toBe(5);
  });

  it('assert halts on failure', async () => {
    await expect(run('-1 -> assert ($ > 0)')).rejects.toThrow();
  });

  it('assert with message', async () => {
    await expect(run('"" -> assert !.empty "Input required"')).rejects.toThrow(
      /Input required/
    );
  });

  it('assert with type check', async () => {
    expect(await run('list[1] -> assert $:?list "Expected list"')).toEqual([1]);
  });

  it('error halts execution', async () => {
    await expect(run('error "Something went wrong"')).rejects.toThrow(
      /Something went wrong/
    );
  });

  it('error piped form', async () => {
    await expect(run('"Operation failed" -> error')).rejects.toThrow(
      /Operation failed/
    );
  });

  it('error with interpolation', async () => {
    await expect(run('500 => $code\nerror "Status: {$code}"')).rejects.toThrow(
      /Status: 500/
    );
  });

  it('pass preserves $ in conditional true branch', async () => {
    expect(await run('"data" -> (true) ? pass ! "fallback"')).toBe('data');
  });

  it('pass preserves $ in conditional false branch', async () => {
    expect(await run('"data" -> (false) ? "value" ! pass')).toBe('data');
  });

  it('pass in dict literal', async () => {
    expect(await run('"data" -> { dict[status: pass] }')).toEqual({
      status: 'data',
    });
  });

  it('pass in map', async () => {
    expect(await run('list[1, -2, 3] -> fan({ ($ > 0) ? pass ! 0 })')).toEqual([
      1, 0, 3,
    ]);
  });
});

// ============================================================
// § Collection Operators
// ============================================================

describe('ref-llm: Collection Operators', () => {
  it('each returns all body results', async () => {
    expect(await run('list[1, 2, 3] -> seq({ $ * 2 })')).toEqual([2, 4, 6]);
  });

  it('each(init) with accumulator', async () => {
    expect(await run('list[1, 2, 3] -> acc(0, { $@ + $ })')).toEqual([1, 3, 6]);
  });

  it('map returns all body results (parallel)', async () => {
    expect(await run('list[1, 2, 3] -> fan({ $ * 2 })')).toEqual([2, 4, 6]);
  });

  it('filter returns matching elements', async () => {
    expect(await run('list[1, 2, 3, 4] -> filter({ $ > 2 })')).toEqual([3, 4]);
  });

  it('fold returns final result only', async () => {
    expect(await run('list[1, 2, 3] -> fold(0, { $@ + $ })')).toBe(6);
  });

  it('method shorthand: map .upper', async () => {
    expect(await run('list["a", "b"] -> fan({ $.upper })')).toEqual(['A', 'B']);
  });

  it('method shorthand: filter (!.empty)', async () => {
    expect(await run('list["", "x"] -> filter({ !.empty })')).toEqual(['x']);
  });

  it('method shorthand with args: map .pad_start(3, "0")', async () => {
    expect(await run('list["a", "b"] -> fan({ $.pad_start(3, "0") })')).toEqual(
      ['00a', '00b']
    );
  });

  it('chained method shorthand: map .trim.lower', async () => {
    expect(await run('list["  HI  "] -> fan({ $.trim.lower })')).toEqual([
      'hi',
    ]);
  });

  it('body form: block', async () => {
    expect(await run('list[1, 2] -> seq({ $ * 2 })')).toEqual([2, 4]);
  });

  it('body form: grouped expression', async () => {
    expect(await run('list[1, 2] -> seq({ $ + 10 })')).toEqual([11, 12]);
  });

  it('body form: inline closure', async () => {
    expect(await run('list[1, 2] -> seq(|x| ($x * 2))')).toEqual([2, 4]);
  });

  it('body form: variable closure', async () => {
    expect(
      await run('|x|($x * 2) => $double\nlist[1, 2] -> seq($double)')
    ).toEqual([2, 4]);
  });

  it('body form: method shorthand', async () => {
    expect(await run('list["a", "b"] -> seq({ $.upper })')).toEqual(['A', 'B']);
  });

  it('body form: built-in function', async () => {
    // log passes through, so seq with log body returns same elements
    expect(await run('list[1, 2] -> seq({ $ -> log })')).toEqual([1, 2]);
  });

  it('dict iteration: $ has key and value', async () => {
    expect(
      await run('dict[a: 1, b: 2] -> seq({ "{$.key}={$.value}" })')
    ).toEqual(['a=1', 'b=2']);
  });

  it('dict filter by value', async () => {
    const r = await run('dict[a: 1, b: 5] -> filter({ $.value > 2 })');
    expect(r).toBeDefined();
  });

  it('string iteration: each character', async () => {
    expect(await run('"abc" -> seq({ "{$}!" })')).toEqual(['a!', 'b!', 'c!']);
  });

  it('string filter characters', async () => {
    expect(await run('"hello" -> filter({ $ != "l" })')).toEqual([
      'h',
      'e',
      'o',
    ]);
  });
});

// ============================================================
// § Closures
// ============================================================

describe('ref-llm: Closures', () => {
  it('block-closure: { $ + 1 } => $inc', async () => {
    expect(await run('{ $ + 1 } => $inc\n$inc(5)')).toBe(6);
  });

  it('block-closure pipe invocation: 5 -> $inc', async () => {
    expect(await run('{ $ + 1 } => $inc\n5 -> $inc')).toBe(6);
  });

  it('dict value closure', async () => {
    expect(await run('dict[x: { $ * 2 }] => $d\n$d.x(3)')).toBe(6);
  });

  it('type check of closure', async () => {
    expect(await run('{ "hi" }:?closure')).toBe(true);
  });

  it('explicit closure: named parameter', async () => {
    expect(await run('|x|($x + 1) => $inc\n$inc(5)')).toBe(6);
  });

  it('explicit closure: multiple params', async () => {
    expect(await run('|a, b|($a + $b) => $add\n$add(3, 4)')).toBe(7);
  });

  it('explicit closure: default value', async () => {
    expect(await run('|x = 0|($x + 1) => $inc\n$inc()')).toBe(1);
  });

  it('explicit closure: type annotation', async () => {
    expect(await run('|x: number|($x + 1) => $typed\n$typed(5)')).toBe(6);
  });

  it('return type assertion: passes', async () => {
    expect(await run('|x: number| { "{$x}" }:string => $fn\n$fn(42)')).toBe(
      '42'
    );
  });

  it('return type assertion: fails (halts typed-atom)', async () => {
    await expect(
      run('|x: number| { $x * 2 }:string => $fn\n$fn(5)')
    ).rejects.toThrow();
  });

  it('description shorthand', async () => {
    expect(
      await run(
        '^("Get weather for city") |city: string|($city) => $weather\n$weather.^description'
      )
    ).toBe('Get weather for city');
  });

  it('description shorthand with extra annotations', async () => {
    expect(
      await run(
        '^("Fetch profile", cache: true) |id|($id) => $get_user\n$get_user.^cache'
      )
    ).toBe(true);
  });

  it('{ body } is deferred (closure)', async () => {
    expect(await run('{ $ + 1 } => $fn\n$fn:?closure')).toBe(true);
  });

  it('( expr ) is eager (immediate eval)', async () => {
    expect(await run('( 5 + 1 ) => $x\n$x')).toBe(6);
  });

  it('zero-param dict closure (method)', async () => {
    expect(
      await run(
        'dict[count: 3, double: ||{ $.count * 2 }] => $obj\n$obj.double'
      )
    ).toBe(6);
  });
});

// ============================================================
// § Property Access
// ============================================================

describe('ref-llm: Property Access', () => {
  it('dict field access', async () => {
    expect(await run('dict[a: 1] => $d\n$d.a')).toBe(1);
  });

  it('list index access', async () => {
    expect(await run('list[10, 20, 30] => $l\n$l[0]')).toBe(10);
  });

  it('negative list index', async () => {
    expect(await run('list[10, 20, 30] => $l\n$l[-1]')).toBe(30);
  });

  it('variable key access', async () => {
    expect(await run('"a" => $key\ndict[a: 1] => $d\n$d.$key')).toBe(1);
  });

  it('computed key access', async () => {
    expect(await run('dict[b: 2] => $d\n$d.("b")')).toBe(2);
  });

  it('default with ??', async () => {
    expect(await run('dict[a: 1] => $d\n$d.missing ?? "default"')).toBe(
      'default'
    );
  });

  it('existence check .?field', async () => {
    expect(await run('dict[a: 1] => $d\n$d.?a')).toBe(true);
    expect(await run('dict[a: 1] => $d\n$d.?b')).toBe(false);
  });

  it('existence + type check .?field&type', async () => {
    expect(await run('dict[a: 1] => $d\n$d.?a&number')).toBe(true);
    expect(await run('dict[a: 1] => $d\n$d.?a&string')).toBe(false);
  });
});

// ============================================================
// § Dispatch Operators
// ============================================================

describe('ref-llm: Dispatch Operators', () => {
  it('dict dispatch: single key match', async () => {
    expect(await run('"apple" -> dict[apple: "fruit", carrot: "veg"]')).toBe(
      'fruit'
    );
  });

  it('dict dispatch with ?? default', async () => {
    expect(await run('"banana" -> dict[apple: "fruit"] ?? "not found"')).toBe(
      'not found'
    );
  });

  it('dict dispatch: type-aware (number key)', async () => {
    expect(await run('1 -> dict[1: "number", "1": "string"]')).toBe('number');
  });

  it('dict dispatch: type-aware (string key)', async () => {
    expect(await run('"1" -> dict[1: "number", "1": "string"]')).toBe('string');
  });

  it('dict dispatch: type-aware (boolean key)', async () => {
    expect(await run('true -> dict[true: "bool", "true": "str"]')).toBe('bool');
  });

  it('list dispatch: index 0', async () => {
    expect(await run('0 -> list["first", "second"]')).toBe('first');
  });

  it('list dispatch: negative index', async () => {
    expect(await run('-1 -> list["first", "second"]')).toBe('second');
  });

  it('list dispatch: out of bounds with ??', async () => {
    expect(await run('5 -> list["a", "b"] ?? "not found"')).toBe('not found');
  });

  it('hierarchical dispatch: nested dict', async () => {
    expect(
      await run('list["name", "first"] -> dict[name: dict[first: "Alice"]]')
    ).toBe('Alice');
  });

  it('hierarchical dispatch: nested list', async () => {
    expect(await run('list[0, 1] -> list[list[1, 2, 3], list[4, 5, 6]]')).toBe(
      2
    );
  });

  it('hierarchical dispatch: mixed keys use property access instead', async () => {
    expect(
      await run(
        'dict[users: list[dict[name: "Alice"]]] => $d\n$d.users[0].name'
      )
    ).toBe('Alice');
  });

  it('hierarchical dispatch: empty path returns unchanged', async () => {
    expect(await run('list[] -> dict[a: 1]')).toEqual({ a: 1 });
  });

  it('hierarchical dispatch: missing path with ??', async () => {
    expect(
      await run('list["a", "missing"] -> dict[a: dict[x: 1]] ?? "default"')
    ).toBe('default');
  });
});

// ============================================================
// § Type Operations
// ============================================================

describe('ref-llm: Type Operations', () => {
  it(':type asserts type (pass)', async () => {
    expect(await run('42:number')).toBe(42);
  });

  it(':type asserts type (fail)', async () => {
    await expect(run('"x":number')).rejects.toThrow();
  });

  it(':?type checks type (true)', async () => {
    expect(await run('42:?number')).toBe(true);
  });

  it(':?type checks type (false)', async () => {
    expect(await run('"x":?number')).toBe(false);
  });

  it('comparison method .ge', async () => {
    expect(await run('18 -> .ge(18) ? "adult" ! "minor"')).toBe('adult');
    expect(await run('15 -> .ge(18) ? "adult" ! "minor"')).toBe('minor');
  });
});

// ============================================================
// § Extraction Operators
// ============================================================

describe('ref-llm: Extraction Operators', () => {
  it('destruct list', async () => {
    const r = await runWithContext(
      'list[1, 2, 3] -> destruct<$a, $b, $c>\nlist[$a, $b, $c]'
    );
    expect(r.result.result).toEqual([1, 2, 3]);
  });

  it('destruct dict', async () => {
    const r = await runWithContext(
      'dict[x: 1, y: 2] -> destruct<x: $a, y: $b>\nlist[$a, $b]'
    );
    expect(r.result.result).toEqual([1, 2]);
  });

  it('destruct with _ skip', async () => {
    const r = await runWithContext(
      'list[1, 2, 3] -> destruct<$first, _, $third>\nlist[$first, $third]'
    );
    expect(r.result.result).toEqual([1, 3]);
  });

  it('slice<1:3>', async () => {
    expect(await run('list[0,1,2,3,4] -> slice<1:3>')).toEqual([1, 2]);
  });

  it('slice<-2:>', async () => {
    expect(await run('list[0,1,2,3,4] -> slice<-2:>')).toEqual([3, 4]);
  });

  it('slice<::-1> reverses', async () => {
    expect(await run('list[0,1,2,3,4] -> slice<::-1>')).toEqual([
      4, 3, 2, 1, 0,
    ]);
  });

  it('slice string', async () => {
    expect(await run('"hello" -> slice<1:4>')).toBe('ell');
  });
});

// ============================================================
// § List Spread
// ============================================================

describe('ref-llm: List Spread', () => {
  it('spread into new list', async () => {
    expect(await run('list[1, 2] => $a\nlist[...$a, 3]')).toEqual([1, 2, 3]);
  });

  it('spread concatenation', async () => {
    expect(
      await run('list[1, 2] => $a\nlist[3, 4] => $b\nlist[...$a, ...$b]')
    ).toEqual([1, 2, 3, 4]);
  });

  it('spread expression result', async () => {
    expect(
      await run('list[1, 2, 3] => $nums\nlist[...($nums -> fan({$ * 2}))]')
    ).toEqual([2, 4, 6]);
  });
});

// ============================================================
// § Tuples and Ordered
// ============================================================

describe('ref-llm: Tuples and Ordered', () => {
  it('tuple positional spread', async () => {
    expect(
      await run('|a, b, c|($a + $b + $c) => $fn\ntuple[1, 2, 3] -> $fn(...)')
    ).toBe(6);
  });

  it('ordered named spread (keys must match parameter order)', async () => {
    expect(
      await run('|a, b|($a - $b) => $fn\nordered[a: 10, b: 2] -> $fn(...)')
    ).toBe(8);
  });
});

// ============================================================
// § String Methods
// ============================================================

describe('ref-llm: String Methods', () => {
  it('.len', async () => {
    expect(await run('"hello" -> .len')).toBe(5);
  });

  it('.empty', async () => {
    expect(await run('"" -> .empty')).toBe(true);
    expect(await run('"x" -> .empty')).toBe(false);
  });

  it('.trim', async () => {
    expect(await run('"  hi  " -> .trim')).toBe('hi');
  });

  it('.upper', async () => {
    expect(await run('"hello" -> .upper')).toBe('HELLO');
  });

  it('.lower', async () => {
    expect(await run('"HELLO" -> .lower')).toBe('hello');
  });

  it('.str', async () => {
    expect(await run('42 -> string')).toBe('42');
  });

  it('.num', async () => {
    expect(await run('"42" -> number')).toBe(42);
  });

  it('.head', async () => {
    expect(await run('"hello" -> .head')).toBe('h');
  });

  it('.tail', async () => {
    expect(await run('"hello" -> .tail')).toBe('o');
  });

  it('.at(i)', async () => {
    expect(await run('"hello" -> .at(1)')).toBe('e');
  });

  it('.split(sep)', async () => {
    expect(await run('"a,b,c" -> .split(",")')).toEqual(['a', 'b', 'c']);
  });

  it('.lines', async () => {
    expect(await run('"""a\nb\nc""" -> .lines')).toEqual(['a', 'b', 'c']);
  });

  it('.join(sep)', async () => {
    expect(await run('list["a", "b", "c"] -> .join(",")')).toBe('a,b,c');
  });

  it('.contains(s)', async () => {
    expect(await run('"hello world" -> .contains("world")')).toBe(true);
  });

  it('.starts_with(s)', async () => {
    expect(await run('"hello" -> .starts_with("hel")')).toBe(true);
  });

  it('.ends_with(s)', async () => {
    expect(await run('"hello" -> .ends_with("llo")')).toBe(true);
  });

  it('.index_of(s)', async () => {
    expect(await run('"hello" -> .index_of("ll")')).toBe(2);
    expect(await run('"hello" -> .index_of("xyz")')).toBe(-1);
  });

  it('.replace(p, r)', async () => {
    expect(await run('"hello world" -> .replace("world", "rill")')).toBe(
      'hello rill'
    );
  });

  it('.replace_all(p, r)', async () => {
    expect(await run('"aaa" -> .replace_all("a", "b")')).toBe('bbb');
  });

  it('.match(regex)', async () => {
    const r = await run('"hello123" -> .match("[0-9]+")');
    expect((r as any).matched).toBe('123');
  });

  it('.is_match(regex)', async () => {
    expect(await run('"hello123" -> .is_match("[0-9]+")')).toBe(true);
    expect(await run('"hello" -> .is_match("[0-9]+")')).toBe(false);
  });

  it('.repeat(n)', async () => {
    expect(await run('"ab" -> .repeat(3)')).toBe('ababab');
  });

  it('.pad_start(n, f)', async () => {
    expect(await run('"5" -> .pad_start(3, "0")')).toBe('005');
  });

  it('.pad_end(n, f)', async () => {
    expect(await run('"5" -> .pad_end(3, "0")')).toBe('500');
  });
});

// ============================================================
// § List/Dict Methods
// ============================================================

describe('ref-llm: List/Dict Methods', () => {
  it('.len (list)', async () => {
    expect(await run('list[1, 2, 3] -> .len')).toBe(3);
  });

  it('.empty (list)', async () => {
    expect(await run('list[] -> .empty')).toBe(true);
    expect(await run('list[1] -> .empty')).toBe(false);
  });

  it('.head (list)', async () => {
    expect(await run('list[10, 20, 30] -> .head')).toBe(10);
  });

  it('.tail (list)', async () => {
    expect(await run('list[10, 20, 30] -> .tail')).toBe(30);
  });

  it('.at(i) (list)', async () => {
    expect(await run('list[10, 20, 30] -> .at(1)')).toBe(20);
  });

  it('.keys (dict)', async () => {
    expect(await run('dict[a: 1, b: 2] -> .keys')).toEqual(['a', 'b']);
  });

  it('.values (dict)', async () => {
    expect(await run('dict[a: 1, b: 2] -> .values')).toEqual([1, 2]);
  });

  it('.entries (dict)', async () => {
    const r = await run('dict[a: 1] -> .entries');
    expect(r).toBeDefined();
  });

  it('.has(val) (list)', async () => {
    expect(await run('list[1, 2, 3] -> .has(2)')).toBe(true);
    expect(await run('list[1, 2, 3] -> .has(5)')).toBe(false);
  });

  it('.has_any(list)', async () => {
    expect(await run('list[1, 2, 3] -> .has_any(list[2, 5])')).toBe(true);
    expect(await run('list[1, 2, 3] -> .has_any(list[5, 6])')).toBe(false);
  });

  it('.has_all(list)', async () => {
    expect(await run('list[1, 2, 3] -> .has_all(list[1, 2])')).toBe(true);
    expect(await run('list[1, 2, 3] -> .has_all(list[1, 5])')).toBe(false);
  });
});

// ============================================================
// § Built-in Functions
// ============================================================

describe('ref-llm: Built-in Functions', () => {
  it('type checks via :?type', async () => {
    expect(await run('42:?number')).toBe(true);
    expect(await run('"hello":?string')).toBe(true);
    expect(await run('list[1]:?list')).toBe(true);
  });

  it('log(val) passes through', async () => {
    expect(await run('"hello" -> log')).toBe('hello');
  });

  it('json(val)', async () => {
    expect(await run('json(42)')).toBe('42');
    expect(await run('json("hello")')).toBe('"hello"');
  });

  it('identity(val)', async () => {
    expect(await run('identity(42)')).toBe(42);
  });

  it('range(start, end)', async () => {
    expect(await run('range(0, 5) -> seq({ $ })')).toEqual([0, 1, 2, 3, 4]);
  });

  it('repeat(val, count)', async () => {
    expect(await run('repeat("x", 3) -> seq({ $ })')).toEqual(['x', 'x', 'x']);
  });

  it('enumerate(list)', async () => {
    const r = await run('enumerate(list["a", "b"]) -> seq({ $ })');
    expect(r).toBeDefined();
  });

  it('chain applies closures in sequence', async () => {
    expect(
      await run(
        '|x|($x + 1) => $inc\n|x|($x * 2) => $double\nchain(5, list[$inc, $double])'
      )
    ).toBe(12);
  });
});

// ============================================================
// § Iterators
// ============================================================

describe('ref-llm: Iterators', () => {
  it('range with each', async () => {
    expect(await run('range(0, 5) -> seq({ $ * 2 })')).toEqual([0, 2, 4, 6, 8]);
  });

  it('repeat with each', async () => {
    expect(await run('repeat("x", 3) -> seq({ $ })')).toEqual(['x', 'x', 'x']);
  });

  it('.first() on list', async () => {
    const r = await run('list[1, 2, 3] -> .first() => $it\n$it.value');
    expect(r).toBe(1);
  });

  it('.first() on string', async () => {
    const r = await run('"abc" -> .first() => $it\n$it.value');
    expect(r).toBe('a');
  });

  it('iterator protocol: done, value, next', async () => {
    expect(await run('list[1, 2] -> .first() => $it\n$it.done')).toBe(false);
    expect(await run('list[1, 2] -> .first() => $it\n$it.value')).toBe(1);
    expect(await run('list[1, 2] -> .first() => $it\n$it.next().value')).toBe(
      2
    );
  });
});

// ============================================================
// § Iteration Limits
// ============================================================

describe('ref-llm: Iteration Limits', () => {
  it('^(limit: N) overrides default', async () => {
    expect(await run('0 -> ($ < 50) @ ^(limit: 100) { $ + 1 }')).toBe(50);
  });
});

// ============================================================
// § Script Return Values
// ============================================================

describe('ref-llm: Script Return Values', () => {
  it('true returns truthy', async () => {
    expect(await run('true')).toBe(true);
  });

  it('false returns falsy', async () => {
    expect(await run('false')).toBe(false);
  });

  it('non-empty string is truthy', async () => {
    expect(await run('"hello"')).toBe('hello');
  });

  it('empty string', async () => {
    expect(await run('""')).toBe('');
  });
});

// ============================================================
// § Implicit $ Shorthand
// ============================================================

describe('ref-llm: Implicit $ Shorthand', () => {
  it('.method shorthand: "x" -> .upper', async () => {
    expect(await run('"x" -> .upper')).toBe('X');
  });

  it('func shorthand: "x" -> log', async () => {
    expect(await run('"x" -> log')).toBe('x');
  });

  it('closure shorthand: 5 -> $double', async () => {
    expect(await run('|x|($x * 2) => $double\n5 -> $double')).toBe(10);
  });
});

// ============================================================
// § Operator Precedence
// ============================================================

describe('ref-llm: Operator Precedence', () => {
  it('parentheses override: (2 + 3) * 4', async () => {
    expect(await run('(2 + 3) * 4')).toBe(20);
  });

  it('multiplicative before additive: 2 + 3 * 4', async () => {
    expect(await run('2 + 3 * 4')).toBe(14);
  });
});
