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
 * ## Design Rationale: Why Mixins Over Composition
 *
 * The nested mixin pattern addresses three problems that make traditional
 * composition awkward for this use case:
 *
 * **1. Circular method dependencies**
 *
 * Mixins call each other's methods freely across the composition:
 * - ClosuresMixin.evaluateArgs() calls evaluateExpression() (ExpressionsMixin)
 * - ExpressionsMixin calls invokeCallable() (ClosuresMixin)
 * - CollectionsMixin calls evaluateBodyExpression() (CoreMixin)
 *
 * With composition, this creates circular references between components
 * requiring complex dependency injection or a mediator pattern.
 *
 * **2. Shared mutable state**
 *
 * All mixins share direct access to `this.ctx` (RuntimeContext), including
 * the current pipe value and variable maps. Composition would require
 * threading context through every call or synchronizing state across objects.
 *
 * **3. Protected method visibility**
 *
 * Mixins call each other's protected methods directly. Composition would
 * require public interfaces or accessor patterns, breaking encapsulation.
 *
 * ## Trade-offs
 *
 * The mixin pattern trades compile-time type safety for simpler cross-cutting
 * dispatch. Cross-mixin calls use `(this as any).methodName()` because
 * TypeScript cannot infer the final composed type within each mixin.
 * These casts are localized to cross-mixin call sites.
 *
 * ## Alternatives Considered
 *
 * **Handler Registry with Central Dispatch**
 * ```
 * class Evaluator {
 *   private handlers = new Map<string, NodeHandler>();
 *   async evaluate(node: ASTNode) {
 *     return this.handlers.get(node.type)!(node, this.ctx);
 *   }
 * }
 * ```
 * Pros: No circular deps, testable handlers. Cons: Loses node type safety,
 * all handlers public, shared state still needs threading.
 *
 * **Capability Interfaces with Lazy Resolution**
 * ```
 * interface IClosureEval { invokeCallable(...): Promise<RillValue>; }
 * class ClosuresEval {
 *   constructor(private lazy: (k: string) => any) {}
 *   invoke() { return this.lazy('expressions').evaluate(node); }
 * }
 * ```
 * Pros: Type-safe interfaces, mockable. Cons: More boilerplate, lazy
 * accessor indirection, shared state still awkward.
 *
 * **Proxy-Based Dynamic Dispatch**
 * ```
 * class Evaluator {
 *   private createProxy() {
 *     return new Proxy({}, {
 *       get: (_, method) => this.findMethod(method)
 *     });
 *   }
 * }
 * ```
 * Pros: Clean separation. Cons: No compile-time checking, runtime errors
 * for typos, harder debugging.
 *
 * ## Conclusion
 *
 * The coupling between expression evaluation, closure invocation, and
 * variable resolution is fundamental to the domain. The mixin pattern
 * reflects this reality with minimal indirection. The `as any` casts
 * are the localized cost; alternatives trade this for other complexity.
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
