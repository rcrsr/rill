/**
 * EvaluatorInterface — structural cast target for the composed Evaluator class.
 *
 * This type alias is the intersection of EvaluatorBase with all per-mixin
 * capability fragments. Callers that need to invoke protected mixin methods
 * cast the evaluator instance to EvaluatorInterface instead of using `any`.
 *
 * Capability fragments are published incrementally (Phase 2+). Until a mixin
 * publishes its fragment, it contributes the empty stub below. When Phase 2
 * publishes CoreMixinCapability and ClosuresMixinCapability, the corresponding
 * stub entries are replaced with the real imports.
 *
 * @internal — not exported from packages/core/src/index.ts or
 * packages/core/src/runtime/index.ts.
 */

import type { EvaluatorBaseCapability } from './base.js';
import type { CoreMixinCapability } from './mixins/core.js';
import type { ClosuresMixinCapability } from './mixins/closures.js';
import type { LiteralsMixinCapability } from './mixins/literals.js';
import type { ControlFlowMixinCapability } from './mixins/control-flow.js';
import type { ExtractionMixinCapability } from './mixins/extraction.js';
import type { TypesMixinCapability } from './mixins/types.js';
import type { VariablesMixinCapability } from './mixins/variables.js';
import type { ConversionMixinCapability } from './mixins/conversion.js';
import type { ListDispatchMixinCapability } from './mixins/list-dispatch.js';
import type { RecoveryMixinCapability } from './mixins/recovery.js';
import type { ExpressionsMixinCapability } from './mixins/expressions.js';
import type { AnnotationsMixinCapability } from './mixins/annotations.js';
import type { UseMixinCapability } from './mixins/use.js';
import type { StreamClosuresMixinCapability } from './invocation/stream-closures.js';
import type { CollectionsMixinCapability } from './mixins/collections.js';

/**
 * Structural intersection of EvaluatorBaseCapability (access-stripped) with all
 * mixin capability fragments.
 *
 * EvaluatorBaseCapability lists EvaluatorBase members as plain signatures,
 * stripping `protected`. This lets external wrapper functions in index.ts cast
 * to EvaluatorInterface and call checkAborted / checkAutoExceptions without
 * TS2445 errors.
 *
 * The 15 capability slots (one per mixin) are listed individually so that
 * Phase 2+ tasks can replace each stub with a named import without restructuring
 * the intersection shape.
 */
export type EvaluatorInterface = EvaluatorBaseCapability &
  CoreMixinCapability & // CoreMixinCapability (Phase 1.2)
  ClosuresMixinCapability & // ClosuresMixinCapability (Phase 1.2)
  LiteralsMixinCapability & // LiteralsMixinCapability (Phase 1.3)
  ControlFlowMixinCapability & // ControlFlowMixinCapability (Phase 1.3)
  ExtractionMixinCapability & // ExtractionMixinCapability (Phase 1.3)
  TypesMixinCapability & // TypesMixinCapability (Phase 1.3)
  VariablesMixinCapability & // VariablesMixinCapability (Phase 1.3)
  ConversionMixinCapability & // ConversionMixinCapability (Phase 1.3)
  ListDispatchMixinCapability & // ListDispatchMixinCapability (Phase 1.3)
  RecoveryMixinCapability & // RecoveryMixinCapability (Phase 1.3)
  ExpressionsMixinCapability & // ExpressionsMixinCapability (Phase 1.3)
  AnnotationsMixinCapability & // AnnotationsMixinCapability (Phase 1.3)
  UseMixinCapability & // UseMixinCapability (Phase 1.3)
  StreamClosuresMixinCapability & // StreamClosuresMixinCapability (Phase 1.4)
  CollectionsMixinCapability; // CollectionsMixinCapability (Phase 1.4)
