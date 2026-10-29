/**
 * Shared helpers for rule tests. Excluded from the published build.
 */
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import type { CheckConfig } from './types.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
export function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
export function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}
