/**
 * Type Infrastructure for Evaluator Mixins
 *
 * Defines the constructor types and constraints for the mixin pattern.
 * Mixins receive a base constructor and return an extended constructor.
 *
 * @internal
 */

import type { EvaluatorBase } from './base.js';

/**
 * Constructor type for EvaluatorBase or any class extending it.
 * This is the input type for mixin functions.
 *
 * Type parameter TBase must extend EvaluatorBase to ensure all mixins
 * have access to the base utilities (ctx, checkAborted, etc.).
 *
 * Note: `any[]` is required for constructor args because mixins don't know
 * what parameters the base constructor accepts. This is the standard TypeScript
 * mixin pattern.
 */
export type EvaluatorConstructor<TBase extends EvaluatorBase = EvaluatorBase> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...args: any[]) => TBase;
