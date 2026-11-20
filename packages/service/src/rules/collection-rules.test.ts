import { describe, expect, it } from 'vitest';
import { runRules } from './run-rules.js';
import { breakInParallel } from './break-in-parallel.js';
import { blockCapture } from './block-capture.js';
import { collectionArity } from './collection-arity.js';
import { preferMap } from './prefer-map.js';
import { filterNegation } from './filter-negation.js';
import { methodShorthand } from './method-shorthand.js';
import { bareCallableBody } from './bare-callable-body.js';
import { makeConfig, toParseResult } from './test-support.js';

describe('BREAK_IN_PARALLEL', () => {
  it('fires when a break appears inside a fan body', () => {
    const source = 'list[1, 2] -> fan({ $ -> break })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [breakInParallel]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'BREAK_IN_PARALLEL',
      severity: 'error',
      message:
        "Break not allowed in 'fan' (parallel operator). Use 'seq' for sequential iteration with break.",
      fix: null,
    });
  });

  it('does not fire when break appears inside a seq body', () => {
    const source = 'list[1, 2] -> seq({ $ -> break })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [breakInParallel])).toEqual(
      []
    );
  });

  it('does not fire when break appears inside a seq nested within a fan body', () => {
    // `seq` catches `break` locally; the outer `fan` never sees it.
    const source = 'list[1, 2] -> fan({ $ -> seq({ ($ > 5) ? break ! $ }) })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [breakInParallel])).toEqual(
      []
    );
  });

  it('does not fire when break appears inside a fn nested within a fan body', () => {
    // A closure body has its own scope; a `break` defined inside one is
    // not a `break` of the enclosing `fan` body.
    const source = 'list[1, 2] -> fan({ fn(x) { $x -> break } => $f })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [breakInParallel])).toEqual(
      []
    );
  });
});

describe('PREFER_MAP', () => {
  it('fires on a seq body with no side effects', () => {
    const source = 'list[1, 2] -> seq({ $ * 2 })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [preferMap]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'PREFER_MAP',
      severity: 'info',
      message:
        "Consider using 'fan' instead of 'seq' for pure transformations (no side effects)",
      fix: null,
    });
  });

  it('does not fire on a seq body containing a host call', () => {
    const source = 'list[1, 2] -> seq({ log($) })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [preferMap])).toEqual([]);
  });

  it('fires on a seq body whose only host call is inside a nested fn definition', () => {
    // Defining `fn(x) { log($x) }` as a value has no side effect at the outer
    // seq body's level until the closure is invoked; the host call lives
    // in the closure's own scope, so PREFER_MAP should still fire here.
    const source = 'list[1, 2] -> seq({ fn(x) { log($x) } => $f })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [preferMap]);

    expect(result).toHaveLength(1);
    expect(result[0]?.code).toBe('PREFER_MAP');
  });
});

describe('FILTER_NEGATION', () => {
  it('fires when the filter body is the bare .empty shorthand', () => {
    const source = 'list["", "a"] -> filter({.empty})\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [filterNegation]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'FILTER_NEGATION',
      severity: 'warning',
      message:
        "Filter with '.empty' likely unintended. Use grouped negation: 'filter({ !.empty })' to filter non-empty elements",
      fix: null,
    });
  });

  it('does not fire when the filter body negates .empty', () => {
    const source = 'list["", "a"] -> filter({!.empty})\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [filterNegation])).toEqual(
      []
    );
  });
});

describe('METHOD_SHORTHAND', () => {
  it('fires when a collection-op body block-wraps a single method call on $', () => {
    const source = 'list["a", "b"] -> fan({ $.upper() })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [methodShorthand]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'METHOD_SHORTHAND',
      severity: 'info',
      message:
        "Prefer method shorthand '.upper' over block form '{ $.upper() }'",
      fix: null,
    });
  });

  it('does not fire when the body already uses method shorthand', () => {
    const source = 'list["a", "b"] -> fan({ $ -> .upper })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [methodShorthand])).toEqual(
      []
    );
  });
});

describe('BARE_CALLABLE_BODY', () => {
  it('fires when a bare host function name is used as a seq body', () => {
    const source = 'list[1,2] -> seq(log)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [bareCallableBody]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'BARE_CALLABLE_BODY',
      severity: 'warning',
    });
  });

  it('fires when a bare host function name is used as a fan body', () => {
    const source = 'list[1,2] -> fan(identity)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [bareCallableBody]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'BARE_CALLABLE_BODY',
      severity: 'warning',
    });
  });

  it('fires on the body arg of fold, not the seed arg', () => {
    const source = 'list[1,2] -> fold(get_seed, log)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [bareCallableBody]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'BARE_CALLABLE_BODY',
      severity: 'warning',
    });
  });

  it('does not fire when the body is a block', () => {
    const source = 'seq({ $ -> log })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [bareCallableBody])).toEqual(
      []
    );
  });

  it('does not fire when the body is a fn', () => {
    const source = 'seq(fn(x) { log($x) })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [bareCallableBody])).toEqual(
      []
    );
  });

  it('does not fire when the body is a variable reference', () => {
    const source = 'seq($fn)\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [bareCallableBody])).toEqual(
      []
    );
  });

  it('does not fire when the body is an extension member reference', () => {
    const source = 'fan($tools.helper)\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [bareCallableBody])).toEqual(
      []
    );
  });

  it('does not fire on a bare zero-arg call in the init arg of fold when the body is a fn', () => {
    const source = 'fold(get_seed, { $@ + $ })\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [bareCallableBody])).toEqual(
      []
    );
  });
});

describe('with all collection rules on', () => {
  it('emits zero diagnostics on a clean, idiomatic script', () => {
    const source =
      'list[1, 2] -> seq({ log($) })\nlist[1, 2] -> seq({ log($) -> break })\nlist["", "a"] -> filter({!.empty})\nlist["a", "b"] -> fan({ $ -> .upper })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      breakInParallel,
      preferMap,
      filterNegation,
      methodShorthand,
      bareCallableBody,
    ]);

    expect(result).toEqual([]);
  });
});

describe('COLLECTION_ARITY', () => {
  function check(source: string) {
    return runRules(toParseResult(source), source, makeConfig(), [
      collectionArity,
    ]);
  }

  it.each([
    [
      'seq with a block that reads no param',
      'list[1, 2] -> seq({ 5 })\n',
      'seq',
      'RILL-R045',
    ],
    [
      'fan with a block that reads no param',
      'list[1, 2] -> fan({ 5 })\n',
      'fan',
      'RILL-R045',
    ],
    [
      'filter with a block that reads the accumulator',
      'list[1, 2] -> filter({ $@ })\n',
      'filter',
      'RILL-R044',
    ],
    [
      'sort with a zero-param fn',
      'list[1, 2] -> sort(fn() { 1 })\n',
      'sort',
      'RILL-R045',
    ],
    [
      'seq with a two-param fn',
      'list[1, 2] -> seq(fn(a, b) { $a })\n',
      'seq',
      'RILL-R044',
    ],
    [
      'fold with a block that reads one param',
      'list[1, 2] -> fold(0, { $ })\n',
      'fold',
      'RILL-R045',
    ],
    [
      'acc with a one-param fn',
      'list[1, 2] -> acc(0, fn(a) { $a })\n',
      'acc',
      'RILL-R045',
    ],
    [
      'fold with a third required param',
      'list[1, 2] -> fold(0, fn(a, b, c) { $a })\n',
      'fold',
      'RILL-R044',
    ],
    [
      'seq with an outer block whose only reads sit in a nested block',
      'list[1] -> seq({ list[2] -> seq({ $ }) })\n',
      'seq',
      'RILL-R045',
    ],
    [
      'start_when with a block that reads no param',
      'list[1, 2] -> start_when({ true })\n',
      'start_when',
      'RILL-R045',
    ],
    [
      'stop_when with a block that reads the accumulator',
      'list[1, 2] -> stop_when({ $@ })\n',
      'stop_when',
      'RILL-R044',
    ],
    [
      'iterate with a block that reads no param',
      'iterate(1, { 5 })\n',
      'iterate',
      'RILL-R045',
    ],
    [
      'chain with a two-param fn',
      'chain(1, fn(a, b) { $a })\n',
      'chain',
      'RILL-R044',
    ],
    [
      'chain in pipe form with a block that reads no param',
      '1 -> chain({ 5 })\n',
      'chain',
      'RILL-R045',
    ],
    [
      'acc with a block that reads no param',
      'list[1, 2] -> acc(0, { 5 })\n',
      'acc',
      'RILL-R045',
    ],
    [
      'seq with a bare fn literal of arity 0',
      'list[1, 2] -> seq(fn { 5 })\n',
      'seq',
      'RILL-R045',
    ],
  ])('fires on %s', (_name, source, op, id) => {
    const result = check(source);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'COLLECTION_ARITY',
      severity: 'error',
      fix: null,
    });
    expect(result[0]?.message).toContain(`${op} passes its function`);
    expect(result[0]?.message).toContain(id);
  });

  it.each([
    ['seq with a block that reads $', 'list[1, 2] -> seq({ $ * 2 })\n'],
    ['seq with a one-param fn', 'list[1, 2] -> seq(fn(x) { $x })\n'],
    ['sort without a function', 'list[1, 2] -> sort\n'],
    ['sort with a keyed block', 'list[1, 2] -> sort({ $ })\n'],
    [
      'fold with a block that reads both',
      'list[1, 2] -> fold(0, { $@ + $ })\n',
    ],
    [
      'fold with a two-param fn',
      'list[1, 2] -> fold(0, fn(a, b) { $a + $b })\n',
    ],
    [
      'seq with a variable function',
      'fn(x) { $x } => $f\nlist[1, 2] -> seq($f)\n',
    ],
    [
      'seq with a defaulted second param',
      'list[1, 2] -> seq(fn(a, b = 1) { $a })\n',
    ],
    [
      'seq with a bare fn literal reading $',
      'list[1, 2] -> seq(fn { $ * 2 })\n',
    ],
    [
      'fold with a bare fn literal reading both',
      'list[1, 2] -> fold(0, fn { $@ + $ })\n',
    ],
    [
      'seq with a block carrying a type assertion',
      'list[1, 2] -> seq({ $ }:number)\n',
    ],
    [
      'fold with a defaulted third param',
      'list[1, 2] -> fold(0, fn(a, b, c = 1) { $a })\n',
    ],
    [
      'start_when with a block that reads $',
      'list[1] -> start_when({ $ > 0 })\n',
    ],
    ['iterate with a block that reads $', 'iterate(1, { $ + 1 })\n'],
    ['chain with a block that reads $', 'chain(1, { $ + 1 })\n'],
    ['chain with a list of functions', 'chain(1, list[{ 5 }, { 6 }])\n'],
  ])('stays silent on %s', (_name, source) => {
    expect(check(source)).toEqual([]);
  });
});

describe('BLOCK_CAPTURE', () => {
  function check(source: string) {
    return runRules(toParseResult(source), source, makeConfig(), [
      blockCapture,
    ]);
  }

  it.each([
    ['a naked block capture', '{ 5 } => $f\n'],
    ['a parenthesized block capture', '({ 5 }) => $f\n'],
    ['a block with an assertion', '{ 5 }:number => $f\n'],
    ['a call on a block-captured variable', '{ 5 } => $f\n$f()\n'],
  ])('fires on %s', (_name, source) => {
    const result = check(source);

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toMatchObject({
      code: 'BLOCK_CAPTURE',
      severity: 'warning',
      fix: null,
    });
    expect(result.at(-1)?.message).toContain('fn { ... }');
  });

  it('reports the capture and the call separately', () => {
    expect(check('{ 5 } => $f\n$f()\n')).toHaveLength(2);
  });

  it.each([
    ['an fn literal capture', 'fn { 5 } => $f\n$f()\n'],
    ['a block that continues the chain', '{ 5 } -> { $ + 1 } => $f\n'],
    ['an argument block', 'list[1] -> seq({ $ + 1 }) => $r\n'],
    ['conditional branch blocks', 'true ? { 5 } ! { 6 } => $r\n'],
    ['a held dict entry', 'dict[a: { 1 }] => $d\n'],
    ['a held list entry', 'list[{ 1 }] => $l\n'],
    ['a call on an fn-captured variable', 'fn(x) { $x } => $f\n$f(1)\n'],
  ])('stays silent on %s', (_name, source) => {
    expect(check(source)).toEqual([]);
  });

  it('names both fixes in the capture message', () => {
    expect(check('{ 5 } => $f\n')[0]?.message).toContain('drop the braces');
  });

  it.each([
    ['a host call', 'use<ext:app> => $app\n{ $app.make() } => $f\n$f()\n'],
    ['a variable', 'fn { 1 } => $g\n{ $g } => $f\n$f()\n'],
    ['a piped chain', '{ 1 -> $mk } => $f\n$f()\n'],
  ])(
    'reports only the capture when the block ends in %s that may yield a function',
    (_name, source) => {
      const result = check(source);
      expect(result).toHaveLength(1);
      expect(result[0]?.message).toContain('A code block is never a value');
    }
  );

  it.each([
    ['arithmetic', '{ 1 + 2 } => $f\n$f()\n'],
    ['an interpolated string', '{ "a{1}" } => $f\n$f()\n'],
    ['a list literal', '{ list[1] } => $f\n$f()\n'],
  ])('reports the call when the block ends in %s', (_name, source) => {
    expect(check(source)).toHaveLength(2);
  });

  it('does not report a call when the name is captured twice', () => {
    expect(check('{ 5 } => $f\nfn { 6 } => $f\n$f()\n')).toHaveLength(1);
  });
});
