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
export type EvaluatorConstructor<TBase extends EvaluatorBase = EvaluatorBase> = new (...args: any[]) => TBase;
/**
 * Mixin function type.
 * Receives a constructor extending EvaluatorBase and returns an extended constructor.
 *
 * @template TBase - The base class being extended (must extend EvaluatorBase)
 * @template TExtension - The extended class returned by the mixin
 *
 * Example usage:
 * ```typescript
 * const CoreMixin: Mixin<EvaluatorBase, CoreEvaluator> = (Base) => {
 *   return class extends Base {
 *     protected async evaluateExpression(expr: ExpressionNode): Promise<RillValue> {
 *       // implementation
 *     }
 *   };
 * };
 * ```
 */
export type Mixin<TBase extends EvaluatorBase = EvaluatorBase, TExtension extends TBase = TBase> = (Base: EvaluatorConstructor<TBase>) => EvaluatorConstructor<TExtension>;
//# sourceMappingURL=types.d.ts.map