import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { breakInParallel } from './break-in-parallel.js';
import { preferMap } from './prefer-map.js';
import { filterNegation } from './filter-negation.js';
import { methodShorthand } from './method-shorthand.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

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

  it('does not fire when break appears inside a closure nested within a fan body', () => {
    // A closure body has its own scope; a `break` defined inside one is
    // not a `break` of the enclosing `fan` body.
    const source = 'list[1, 2] -> fan({ |x|($x -> break) => $f })\n';
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

  it('fires on a seq body whose only host call is inside a nested closure definition', () => {
    // Defining `|x|(log($x))` as a value has no side effect at the outer
    // seq body's level until the closure is invoked; the host call lives
    // in the closure's own scope, so PREFER_MAP should still fire here.
    const source = 'list[1, 2] -> seq({ |x|(log($x)) => $f })\n';
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
    ]);

    expect(result).toEqual([]);
  });
});
