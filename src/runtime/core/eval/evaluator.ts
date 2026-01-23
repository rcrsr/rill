/**
 * Composed Evaluator
 *
 * The complete evaluator class composed from all mixins.
 * Uses WeakMap caching to reuse evaluator instances per RuntimeContext.
 *
 * Mixin composition order (bottom to top):
 * 1. EvaluatorBase - Foundation utilities
 * 2. CoreMixin - Expression dispatch
 * 3. LiteralsMixin - String, dict, tuple, closure literals
 * 4. VariablesMixin - Variable resolution and access chains
 * 5. CollectionsMixin - each, map, fold, filter operators
 * 6. ExtractionMixin - Destructure, slice, spread operators
 * 7. ControlFlowMixin - Conditionals, loops, blocks
 * 8. ClosuresMixin - Function calls and invocation
 * 9. ExpressionsMixin - Binary, unary, grouped expressions
 * 10. TypesMixin - Type assertions and checks
 * 11. AnnotationsMixin - Annotated statement execution (outermost)
 *
 * The order ensures that each mixin can depend on the methods provided
 * by mixins below it in the stack.
 *
 * @internal
 */

import { EvaluatorBase } from './base.js';
import { CoreMixin } from './mixins/core.js';
import { LiteralsMixin } from './mixins/literals.js';
import { VariablesMixin } from './mixins/variables.js';
import { CollectionsMixin } from './mixins/collections.js';
import { ExtractionMixin } from './mixins/extraction.js';
import { ControlFlowMixin } from './mixins/control-flow.js';
import { ClosuresMixin } from './mixins/closures.js';
import { ExpressionsMixin } from './mixins/expressions.js';
import { TypesMixin } from './mixins/types.js';
import { AnnotationsMixin } from './mixins/annotations.js';
import type { RuntimeContext } from '../types.js';

/**
 * Complete Evaluator class composed from all mixins.
 *
 * This is the final, fully-composed evaluator that has all evaluation
 * capabilities. The composition order is carefully chosen to ensure
 * dependencies are satisfied.
 */
export const Evaluator = AnnotationsMixin(
  TypesMixin(
    ExpressionsMixin(
      ClosuresMixin(
        ControlFlowMixin(
          ExtractionMixin(
            CollectionsMixin(
              VariablesMixin(LiteralsMixin(CoreMixin(EvaluatorBase)))
            )
          )
        )
      )
    )
  )
);

// eslint-disable-next-line no-redeclare
export type Evaluator = InstanceType<typeof Evaluator>;

/**
 * WeakMap cache for evaluator instances.
 *
 * Key: RuntimeContext object reference
 * Value: Evaluator instance for that context
 *
 * Cache eviction happens automatically when the RuntimeContext is
 * garbage collected, since WeakMap keys don't prevent GC.
 */
const evaluatorCache = new WeakMap<
  RuntimeContext,
  InstanceType<typeof Evaluator>
>();

/**
 * Get or create an evaluator instance for a given RuntimeContext.
 *
 * Evaluator instances are cached per context to avoid recreating
 * the same evaluator multiple times during script execution.
 *
 * @param ctx - The runtime context
 * @returns Evaluator instance (cached or newly created)
 *
 * @internal
 */
export function getEvaluator(
  ctx: RuntimeContext
): InstanceType<typeof Evaluator> {
  let evaluator = evaluatorCache.get(ctx);
  if (!evaluator) {
    evaluator = new Evaluator(ctx);
    evaluatorCache.set(ctx, evaluator);
  }
  return evaluator;
}
