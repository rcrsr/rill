/**
 * Validation Rules Registry
 * Barrel export for all validation rules.
 */

import type { ValidationRule } from '../types.js';
import { NAMING_SNAKE_CASE } from './naming.js';
import { CAPTURE_INLINE_CHAIN, CAPTURE_BEFORE_BRANCH } from './flow.js';
import {
  BREAK_IN_PARALLEL,
  PREFER_MAP,
  FOLD_INTERMEDIATES,
  FILTER_NEGATION,
  METHOD_SHORTHAND,
} from './collections.js';
import { LOOP_ACCUMULATOR, PREFER_DO_WHILE, USE_EACH } from './loops.js';
import { USE_DEFAULT_OPERATOR, CONDITION_TYPE } from './conditionals.js';
import {
  CLOSURE_BARE_DOLLAR,
  CLOSURE_BRACES,
  CLOSURE_LATE_BINDING,
} from './closures.js';
import { UNNECESSARY_ASSERTION, VALIDATE_EXTERNAL } from './types.js';
import { USE_HEREDOC, USE_EMPTY_METHOD } from './strings.js';
import { AVOID_REASSIGNMENT, COMPLEX_CONDITION } from './anti-patterns.js';
import {
  SPACING_OPERATOR,
  SPACING_BRACES,
  SPACING_BRACKETS,
  SPACING_CLOSURE,
  INDENT_CONTINUATION,
  IMPLICIT_DOLLAR_METHOD,
  IMPLICIT_DOLLAR_FUNCTION,
  IMPLICIT_DOLLAR_CLOSURE,
  THROWAWAY_CAPTURE,
} from './formatting.js';

// ============================================================
// RE-EXPORT INDIVIDUAL RULES
// ============================================================

export { NAMING_SNAKE_CASE } from './naming.js';
export { CAPTURE_INLINE_CHAIN, CAPTURE_BEFORE_BRANCH } from './flow.js';
export {
  BREAK_IN_PARALLEL,
  PREFER_MAP,
  FOLD_INTERMEDIATES,
  FILTER_NEGATION,
  METHOD_SHORTHAND,
} from './collections.js';
export { LOOP_ACCUMULATOR, PREFER_DO_WHILE, USE_EACH } from './loops.js';
export { USE_DEFAULT_OPERATOR, CONDITION_TYPE } from './conditionals.js';
export {
  CLOSURE_BARE_DOLLAR,
  CLOSURE_BRACES,
  CLOSURE_LATE_BINDING,
} from './closures.js';
export { UNNECESSARY_ASSERTION, VALIDATE_EXTERNAL } from './types.js';
export { USE_HEREDOC, USE_EMPTY_METHOD } from './strings.js';
export { AVOID_REASSIGNMENT, COMPLEX_CONDITION } from './anti-patterns.js';
export {
  SPACING_OPERATOR,
  SPACING_BRACES,
  SPACING_BRACKETS,
  SPACING_CLOSURE,
  INDENT_CONTINUATION,
  IMPLICIT_DOLLAR_METHOD,
  IMPLICIT_DOLLAR_FUNCTION,
  IMPLICIT_DOLLAR_CLOSURE,
  THROWAWAY_CAPTURE,
} from './formatting.js';

// ============================================================
// RULE REGISTRY
// ============================================================

/**
 * All registered validation rules.
 * Rules are applied during AST traversal via the validator.
 */
export const VALIDATION_RULES: ValidationRule[] = [
  // Naming conventions
  NAMING_SNAKE_CASE,

  // Flow and capture
  CAPTURE_INLINE_CHAIN,
  CAPTURE_BEFORE_BRANCH,

  // Collection operators
  BREAK_IN_PARALLEL,
  PREFER_MAP,
  FOLD_INTERMEDIATES,
  FILTER_NEGATION,
  METHOD_SHORTHAND,

  // Loop conventions
  LOOP_ACCUMULATOR,
  PREFER_DO_WHILE,
  USE_EACH,

  // Conditional conventions
  USE_DEFAULT_OPERATOR,
  CONDITION_TYPE,

  // Closure conventions
  CLOSURE_BARE_DOLLAR,
  CLOSURE_BRACES,
  CLOSURE_LATE_BINDING,

  // Type safety
  UNNECESSARY_ASSERTION,
  VALIDATE_EXTERNAL,

  // String handling
  USE_HEREDOC,
  USE_EMPTY_METHOD,

  // Anti-patterns
  AVOID_REASSIGNMENT,
  COMPLEX_CONDITION,

  // Formatting
  SPACING_OPERATOR,
  SPACING_BRACES,
  SPACING_BRACKETS,
  SPACING_CLOSURE,
  INDENT_CONTINUATION,
  IMPLICIT_DOLLAR_METHOD,
  IMPLICIT_DOLLAR_FUNCTION,
  IMPLICIT_DOLLAR_CLOSURE,
  THROWAWAY_CAPTURE,
];
