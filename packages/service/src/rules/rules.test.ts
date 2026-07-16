import { describe, expect, it } from 'vitest';
import { RULES } from './index.js';
import type { RuleCategory } from './index.js';

describe('RULES', () => {
  it('registers exactly 40 rules', () => {
    expect(RULES.length).toBe(40);
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
 * rill-cli check engine. This table restates the 40 rule categories in a
 * second location, so it is a change detector, not a behavioral test:
 * `category` is not read by any code in this repo. Its value is as a
 * review artifact - it concentrates the port into one block a reviewer
 * can diff against rill-cli's mapping instead of opening 36 files.
 */
const EXPECTED_CATEGORIES: Record<string, RuleCategory> = {
  ATOM_UNREGISTERED: 'errors',
  AVOID_REASSIGNMENT: 'anti-patterns',
  BREAK_IN_PARALLEL: 'collections',
  CAPTURE_BEFORE_BRANCH: 'flow',
  CAPTURE_INLINE_CHAIN: 'flow',
  CLOSURE_BARE_DOLLAR: 'closures',
  CLOSURE_BRACES: 'closures',
  CLOSURE_LATE_BINDING: 'closures',
  COMPLEX_CONDITION: 'anti-patterns',
  CONDITION_TYPE: 'conditionals',
  FILTER_NEGATION: 'collections',
  FOLD_INTERMEDIATES: 'collections',
  GUARD_OVER_TRY_CATCH: 'errors',
  GUARD_BARE: 'errors',
  RETRY_TRIVIAL: 'errors',
  IMPLICIT_DOLLAR_CLOSURE: 'formatting',
  IMPLICIT_DOLLAR_FUNCTION: 'formatting',
  IMPLICIT_DOLLAR_METHOD: 'formatting',
  INDENT_CONTINUATION: 'formatting',
  LOOP_OUTER_CAPTURE: 'anti-patterns',
  LOOP_ACCUMULATOR: 'loops',
  PREFER_DO_WHILE: 'loops',
  USE_EACH: 'loops',
  METHOD_SHORTHAND: 'collections',
  NAMING_SNAKE_CASE: 'naming',
  PREFER_MAP: 'collections',
  PRESENCE_OVER_NULL_GUARD: 'errors',
  SPACING_BRACES: 'formatting',
  SPACING_BRACKETS: 'formatting',
  SPACING_CLOSURE: 'formatting',
  SPACING_OPERATOR: 'formatting',
  STATUS_PROBE_NO_FIELD: 'errors',
  STREAM_PRE_ITERATION: 'anti-patterns',
  THROWAWAY_CAPTURE: 'formatting',
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
