import { describe, expect, it } from 'vitest';
import { RULES } from './index.js';
import type { RuleCategory } from './index.js';

describe('RULES', () => {
  it('registers exactly 65 rules', () => {
    expect(RULES.length).toBe(65);
  });

  it('has unique rule codes', () => {
    const codes = RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(RULES)).toBe(true);
    expect(() => {
      (RULES as Array<(typeof RULES)[number]>).push(RULES[0] as never);
    }).toThrow();
  });
});

/**
 * Authoritative code -> category mapping, ported verbatim from the
 * rill-cli check engine. This table restates the rule categories in a
 * second location, so it is a change detector, not a behavioral test:
 * `category` is not read by any code in this repo. Its value is as a
 * review artifact - it concentrates the port into one block a reviewer
 * can diff against rill-cli's mapping instead of opening 36 files.
 */
const EXPECTED_CATEGORIES: Record<string, RuleCategory> = {
  ANY_CAPTURE_LOCK: 'types',
  ATOM_CASE_MISMATCH: 'errors',
  ATOM_DISCARDED: 'anti-patterns',
  ATOM_NOT_ERROR_CODE: 'errors',
  AVOID_REASSIGNMENT: 'anti-patterns',
  BARE_CALLABLE_BODY: 'collections',
  BREAK_IN_PARALLEL: 'collections',
  BLOCK_CAPTURE: 'closures',
  CAPTURE_BEFORE_BRANCH: 'flow',
  CAPTURE_INLINE_CHAIN: 'flow',
  CLOSURE_LATE_BINDING: 'closures',
  COLLECTION_ARITY: 'collections',
  COMPLEX_CONDITION: 'anti-patterns',
  CONDITION_TYPE: 'conditionals',
  FILTER_NEGATION: 'collections',
  FOLD_INTERMEDIATES: 'collections',
  DECLARED_TYPE_PROBE: 'types',
  DICT_KEY_SPELLING: 'types',
  DISPATCH_FN_ENTRY: 'conditionals',
  DISPATCH_MISSING_MEMBER: 'conditionals',
  DISPATCH_SELECTOR_NOT_STRING: 'types',
  ENTRIES_PAIR_AS_LIST: 'types',
  EQUALITY_NO_OVERLAP: 'types',
  GUARD_OVER_TRY_CATCH: 'errors',
  GUARD_BARE: 'errors',
  RETRY_TRIVIAL: 'errors',
  TIMEOUT_TRIVIAL: 'errors',
  IMPLICIT_DOLLAR_CLOSURE: 'formatting',
  IMPLICIT_DOLLAR_FUNCTION: 'formatting',
  IMPLICIT_DOLLAR_METHOD: 'formatting',
  INDENT_CONTINUATION: 'formatting',
  ON_LIST_SINGLE: 'errors',
  LOOP_OUTER_CAPTURE: 'anti-patterns',
  LOOP_ACCUMULATOR: 'loops',
  PREFER_DO_WHILE: 'loops',
  USE_EACH: 'loops',
  METHOD_SHORTHAND: 'collections',
  MAP_MISSING_KEY: 'types',
  MAP_NEGATIVE_INDEX: 'types',
  MIXED_ELEMENT_TYPE_READ: 'types',
  NAMING_SNAKE_CASE: 'naming',
  PIPE_CONVERTS_INNER: 'types',
  PIPE_ZERO_PARAM_TARGET: 'closures',
  PREFER_MAP: 'collections',
  PRESENCE_OVER_NULL_GUARD: 'errors',
  SPACING_BRACES: 'formatting',
  SIGNATURE_BARE_KEY: 'types',
  SPACING_BRACKETS: 'formatting',
  SPACING_CLOSURE: 'formatting',
  SPACING_DECLARATION: 'formatting',
  SPACING_MEMBER: 'formatting',
  SPACING_OPERATOR: 'formatting',
  SPACING_OPTIONS: 'formatting',
  STATUS_PROBE_NO_FIELD: 'errors',
  STREAM_PRE_ITERATION: 'anti-patterns',
  TEMPORAL_LITERAL: 'types',
  THROWAWAY_CAPTURE: 'formatting',
  TUPLE_ONE_POSITION: 'types',
  TYPE_EXTRA_KEY: 'types',
  UNNECESSARY_ASSERTION: 'types',
  USE_DEFAULT_OPERATOR: 'conditionals',
  USE_EMPTY_METHOD: 'strings',
  USE_DYNAMIC_IDENTIFIER: 'anti-patterns',
  USE_UNTYPED_HOST_REF: 'types',
  VALIDATE_EXTERNAL: 'types',
};

describe('RULES category', () => {
  it('matches the authoritative code -> category mapping for every rule', () => {
    for (const rule of RULES) {
      expect(rule.category).toBe(EXPECTED_CATEGORIES[rule.code]);
    }
  });

  it('has a registered rule for every code in the authoritative mapping', () => {
    const codes = new Set(RULES.map((rule) => rule.code));
    for (const code of Object.keys(EXPECTED_CATEGORIES)) {
      expect(codes.has(code)).toBe(true);
    }
  });
});
