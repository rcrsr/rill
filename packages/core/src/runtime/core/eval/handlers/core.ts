/**
 * Main Expression Dispatch
 *
 * Provides the main entry points for expression evaluation and dispatches
 * to specialized evaluators based on AST node type.
 *
 * This is the central coordination point that ties together all other mixins.
 *
 * Interface requirements (from spec IR-5 through IR-13):
 * - evaluateExpression(expr) -> Promise<RillValue> [IR-8]
 * - evaluatePipeChain(chain) -> Promise<RillValue> [IR-9]
 * - evaluatePostfixExpr(expr) -> Promise<RillValue> [IR-10]
 * - evaluatePrimary(primary) -> Promise<RillValue> [IR-11]
 * - evaluatePipeTarget(target, input) -> Promise<RillValue> [IR-12]
 *
 * Error Handling:
 * - Unsupported expression types throw RuntimeError [EC-4]
 * - Aborted execution halts via RuntimeHaltSignal [EC-5]
 *
 * @internal
 */

import type {
  ExpressionNode,
  PipeChainNode,
  PostfixExprNode,
  PrimaryNode,
  PipeTargetNode,
  BodyNode,
  SourceLocation,
} from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
import type { RillValue } from '../../types/structures.js';
import { isInvalid, isTuple, isTypeValue } from '../../types/guards.js';
import { isCallable, isDict, isScriptCallable } from '../../callable.js';
import { BreakSignal, ReturnSignal } from '../../signals.js';
import { invalidate, getStatus } from '../../types/status.js';
import { createTraceFrame } from '../../types/trace.js';
import { resolveAtom, atomName } from '../../types/atom-registry.js';
import type { EvalState } from '../state.js';
import { accessHaltGateFast, formatAccessSite } from './access.js';
import {
  throwCatchableHostHalt,
  throwTypeHalt,
  RuntimeHaltSignal,
} from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, checkAborted } from '../shared.js';
import {
  invokeCallable,
  evaluateMethod,
  evaluateAnnotationAccess,
  evaluateHostRef,
  evaluateHostCall,
  evaluateYield,
  evaluatePipePropertyAccess,
  evaluatePipeInvoke,
  evaluateClosureCallWithPipe,
  evaluateClosureCall,
} from './closures.js';
import { handleCapture, evaluateVariableAsync } from './variables.js';
import {
  evaluateWhileLoop,
  evaluateDoWhileLoop,
  evaluateError,
  evaluateConditional,
  evaluateBody,
  evaluateAssert,
  evaluateBodyExpression,
} from './control-flow.js';
import { evaluateUseExpr } from './use.js';
import {
  evaluateTypeCheck,
  evaluateTypeAssertion,
  evaluateTypeConstructor,
  evaluateClosureSigLiteral,
} from './types.js';
import {
  evaluateTimeoutBlock,
  evaluateStatusProbe,
  evaluateRetryBlock,
  evaluateGuardBlock,
} from './recovery.js';
import {
  evaluateString,
  evaluatePassBlock,
  evaluateDict,
  dispatchToList,
  dispatchToDict,
  createClosure,
  createBlockClosure,
  evaluatePass,
  evaluateDictDispatch,
} from './literals.js';
import {
  evaluateGroupedExpr,
  evaluateUnaryExpr,
  evaluateBinaryExpr,
} from './expressions.js';
import {
  evaluateCollectionLiteral,
  evaluateSlice,
  evaluateDestructure,
  evaluateDestruct,
} from './extraction.js';
import { applyConversion, applyConstructorConversion } from './conversion.js';
import { evaluateListLiteralDispatch } from './list-dispatch.js';
import { evaluateAnnotations } from './annotations.js';

// ============================================================
// ERROR-ID MATCHER (Fix A: ??)
// ============================================================

/**
 * Returns true when `error` matches either the legacy `RuntimeError` with
 * the given `runtimeErrorId`, or a `RuntimeHaltSignal` whose halt-atom
 * name equals `haltAtomCode`.
 *
 * Used by `evaluatePostfixExpr` and the path-traversal catch block to
 * coalesce RILL_R007 / RILL_R009 halts into the `??` default value after
 * the Phase 2 halt-builder migration replaced direct `RuntimeError` throws
 * with `throwCatchableHostHalt` in closures.ts.
 */
function matchesErrorId(
  error: unknown,
  runtimeErrorId: string,
  haltAtomCode: string
): boolean {
  if (error instanceof RuntimeError && error.errorId === runtimeErrorId) {
    return true;
  }
  if (error instanceof RuntimeHaltSignal) {
    return atomName(getStatus(error.value).code) === haltAtomCode;
  }
  return false;
}

/**
 * Main expression evaluation entry point [IR-8].
 * Delegates to pipe chain evaluator.
 */
export async function evaluateExpression(
  s: EvalState,
  expr: ExpressionNode
): Promise<RillValue> {
  checkAborted(s);
  // PartialExpressionNode is produced by parser error recovery for a
  // partially-typed expression fragment. It has no `.head`, so it
  // cannot flow into evaluatePipeChain's switch; surface it as a
  // catchable halt here instead of letting a raw TypeError escape.
  if (expr.type === 'PartialExpression') {
    throwCatchableHostHalt(
      {
        location: expr.span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateExpression',
      },
      'R001',
      expr.message
    );
  }
  return evaluatePipeChain(s, expr);
}

/**
 * Evaluate pipe chain with left-to-right flow [IR-9].
 *
 * Pipe chains isolate their $ value from parent scope.
 * The chain's result is returned, but $ modifications don't leak.
 *
 * Handles chain terminators:
 * - Capture: stores value and returns it
 * - Break: throws BreakSignal with value
 * - Return: throws ReturnSignal with value
 */
export async function evaluatePipeChain(
  s: EvalState,
  chain: PipeChainNode
): Promise<RillValue> {
  // Save parent's $ - chains don't leak $ modifications to parent scope
  const savedPipeValue = s.ctx.pipeValue;

  // Evaluate head (can be PostfixExpr, BinaryExpr, or UnaryExpr)
  let value: RillValue;
  switch (chain.head.type) {
    case 'BinaryExpr':
      value = await evaluateBinaryExpr(s, chain.head);
      break;
    case 'UnaryExpr':
      value = await evaluateUnaryExpr(s, chain.head);
      break;
    case 'PostfixExpr':
      value = await evaluatePostfixExpr(s, chain.head);
      break;
  }
  s.ctx.pipeValue = value; // OK: local to this chain evaluation

  // Evaluate each pipe target in sequence
  // [IR-8: BreakSignal and ReturnSignal propagate through to caller]
  for (const target of chain.pipes) {
    // Handle inline captures (act as identity: store and pass through)
    if (target.type === 'Capture') {
      await handleCapture(s, target, value);
      // Value flows through unchanged
      continue;
    }

    // EC-7: access-halt gate at pipe site. An invalid LHS halts before
    // flowing into the pipe target; `->` is an access on the LHS value.
    // Status probes bypass the gate at their own call site (see
    // evaluateStatusProbe) so this gate never fires for `.!` access.
    value = accessHaltGateFast(
      value,
      '->',
      () => getNodeLocation(s, target),
      s.ctx.sourceId
    );

    value = await evaluatePipeTarget(s, target, value);
    s.ctx.pipeValue = value; // OK: flows within chain
  }

  // Handle chain terminator (capture, break, return, yield)
  if (chain.terminator) {
    if (chain.terminator.type === 'Break') {
      // Restore parent's $ before throwing (cleanup)
      s.ctx.pipeValue = savedPipeValue;
      throw new BreakSignal(value);
    }
    if (chain.terminator.type === 'Return') {
      // Restore parent's $ before throwing (cleanup)
      s.ctx.pipeValue = savedPipeValue;
      throw new ReturnSignal(value);
    }
    if (chain.terminator.type === 'Yield') {
      // Restore parent's $ before throwing (cleanup)
      s.ctx.pipeValue = savedPipeValue;
      // Delegate to evaluateYield for chunk type validation + YieldSignal.
      // When inside a stream closure body, evaluateYield pushes to the
      // channel and blocks until the consumer pulls (returns Promise<void>).
      // When outside, it throws YieldSignal synchronously.
      await evaluateYield(s, value, chain.terminator.span.start);
      // After yield resumes (stream channel case), restore pipe value
      // and return the yielded value as the chain result
      return value;
    }
    // Capture
    await handleCapture(s, chain.terminator, value);
  }

  // Restore parent's $ - chain result is returned, but $ doesn't leak
  s.ctx.pipeValue = savedPipeValue;

  return value;
}

/**
 * Evaluate postfix expression: primary with method chain [IR-10].
 *
 * Example: obj.method1().method2().method3()
 * Evaluates primary, then applies each method in sequence.
 *
 * Default value handling:
 * - If the method chain throws a recoverable missing-member error and
 *   expr.defaultValue exists, evaluates and returns defaultValue instead
 *   of propagating the error.
 * - Recoverable missing-member errors are matched by error id: RILL_R007
 *   (missing method or field on a value) and RILL_R008 (annotation key
 *   not found). Both legacy RuntimeError and migrated RuntimeHaltSignal
 *   forms are recognised via `matchesErrorId`.
 * - If the primary+method-chain produces an invalid RillValue (e.g. from
 *   `guard`/`retry` recovery) and expr.defaultValue exists, the default
 *   expression is evaluated and returned.
 * - All other errors propagate normally.
 */
export async function evaluatePostfixExpr(
  s: EvalState,
  expr: PostfixExprNode
): Promise<RillValue> {
  try {
    let value = await evaluatePrimary(s, expr.primary);

    for (const method of expr.methods) {
      if (method.type === 'AnnotationAccess') {
        value = await evaluateAnnotationAccess(
          s,
          value,
          method.key,
          method.span.start
        );
      } else {
        value = await evaluateMethod(s, method, value);
      }
    }

    if (expr.defaultValue !== null && isInvalid(value)) {
      return evaluateBody(s, expr.defaultValue);
    }

    return value;
  } catch (error) {
    // If method chain throws a recoverable "not found" error and defaultValue
    // exists, evaluate and return the default value. After the Phase 2
    // halt-builder migration, evaluateMethod and evaluateAnnotationAccess throw
    // RuntimeHaltSignal instead of RuntimeError directly; matchesErrorId handles
    // both the legacy and migrated forms.
    //
    // RILL-R007 / RILL_R007: missing method or field on a value.
    // RILL-R008 / RILL_R008: annotation key not found (evaluateAnnotationAccess).
    if (expr.defaultValue !== null) {
      if (
        matchesErrorId(
          error,
          ERROR_IDS.RILL_R007,
          ERROR_ATOMS[ERROR_IDS.RILL_R007]
        ) ||
        matchesErrorId(
          error,
          ERROR_IDS.RILL_R008,
          ERROR_ATOMS[ERROR_IDS.RILL_R008]
        )
      ) {
        return evaluateBody(s, expr.defaultValue);
      }
    }
    // All other errors propagate
    throw error;
  }
}

/**
 * Evaluate primary expression [IR-11].
 *
 * Primary expressions are the atomic units of expressions:
 * - Literals (string, number, boolean, tuple, dict, closure)
 * - Variables
 * - Function calls
 * - Control flow constructs
 * - Grouped expressions
 *
 * Extension: to add a new PrimaryNode type, (1) add the node to the AST
 * union in ast-nodes.ts and ast-unions.ts, (2) add an evaluation function
 * to the appropriate module, (3) add a case here delegating to that
 * function. The default branch surfaces any unhandled type at runtime so
 * TypeScript exhaustiveness remains in force.
 */
export async function evaluatePrimary(
  s: EvalState,
  primary: PrimaryNode
): Promise<RillValue> {
  switch (primary.type) {
    case 'StringLiteral': {
      const { value } = await evaluateString(s, primary);
      return value;
    }

    case 'NumberLiteral':
      return primary.value;

    case 'BoolLiteral':
      return primary.value;

    case 'Dict':
      return evaluateDict(s, primary);

    case 'Closure':
      return await createClosure(s, primary);

    case 'Variable':
      return evaluateVariableAsync(s, primary);

    case 'HostCall':
      return evaluateHostCall(s, primary);

    case 'HostRef':
      return evaluateHostRef(s, primary);

    case 'AnnotatedExpr': {
      // Set immediateAnnotation before evaluating the inner primary so
      // createClosure() can consume it via captureClosureAnnotations [IR-5].
      const annots = await evaluateAnnotations(s, primary.annotations);
      s.ctx.immediateAnnotation = annots;
      try {
        const innerResult = await evaluatePrimary(s, primary.expression);
        if (!isScriptCallable(innerResult)) {
          // Non-closure: annotation silently ignored [EC-5]
          s.ctx.immediateAnnotation = undefined;
        }
        // ScriptCallable: immediateAnnotation was consumed by createClosure()
        return innerResult;
      } finally {
        // Ensure immediateAnnotation is cleared even on error paths
        s.ctx.immediateAnnotation = undefined;
      }
    }

    case 'ClosureCall':
      return evaluateClosureCall(s, primary);

    case 'MethodCall':
      if (s.ctx.pipeValue === null) {
        throwCatchableHostHalt(
          {
            location: primary.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluatePrimaryExpression',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R005],
          'Undefined variable: $',
          { variable: '$' }
        );
      }
      return evaluateMethod(s, primary, s.ctx.pipeValue);

    case 'Conditional':
      return evaluateConditional(s, primary);

    case 'WhileLoop':
      return evaluateWhileLoop(s, primary);

    case 'DoWhileLoop':
      return evaluateDoWhileLoop(s, primary);

    case 'Block':
      return createBlockClosure(s, primary);

    case 'GroupedExpr':
      return evaluateGroupedExpr(s, primary);

    case 'Assert':
      return evaluateAssert(s, primary);

    case 'Error':
      return evaluateError(s, primary);

    case 'Pass':
      return evaluatePass(s, primary);

    case 'PassBlock':
      return evaluatePassBlock(s, primary);

    case 'TimeoutBlock':
      return evaluateTimeoutBlock(s, primary);

    case 'TypeAssertion': {
      // Postfix type assertion: the operand is already evaluated
      if (!primary.operand) {
        throwTypeHalt(
          {
            location: primary.span.start,
            sourceId: s.ctx.sourceId,
            fn: ':',
          },
          'INVALID_INPUT',
          'Postfix type assertion requires operand',
          'runtime',
          undefined,
          'host'
        );
      }
      const assertValue = await evaluatePostfixExpr(s, primary.operand);
      return evaluateTypeAssertion(s, primary, assertValue);
    }

    case 'TypeCheck': {
      // Postfix type check: the operand is already evaluated
      if (!primary.operand) {
        throwTypeHalt(
          {
            location: primary.span.start,
            sourceId: s.ctx.sourceId,
            fn: ':?',
          },
          'INVALID_INPUT',
          'Postfix type check requires operand',
          'runtime',
          undefined,
          'host'
        );
      }
      const checkValue = await evaluatePostfixExpr(s, primary.operand);
      return evaluateTypeCheck(s, primary, checkValue);
    }

    case 'TypeNameExpr':
      // Bare type names that are primitives get primitive structure; others get 'any'.
      return Object.freeze({
        __rill_type: true as const,
        typeName: primary.typeName,
        structure:
          primary.typeName === 'string' ||
          primary.typeName === 'number' ||
          primary.typeName === 'bool' ||
          primary.typeName === 'closure' ||
          primary.typeName === 'list' ||
          primary.typeName === 'dict' ||
          primary.typeName === 'tuple' ||
          primary.typeName === 'ordered' ||
          primary.typeName === 'vector' ||
          primary.typeName === 'type'
            ? ({ kind: primary.typeName } as const)
            : ({ kind: 'any' } as const),
      });

    case 'TypeConstructor':
      return evaluateTypeConstructor(s, primary);

    case 'ClosureSigLiteral':
      return evaluateClosureSigLiteral(s, primary);

    case 'ListLiteral':
    case 'DictLiteral':
    case 'TupleLiteral':
    case 'OrderedLiteral':
      return evaluateCollectionLiteral(s, primary);

    case 'UseExpr':
      return evaluateUseExpr(s, primary);

    case 'GuardBlock':
      return evaluateGuardBlock(s, primary);

    case 'RetryBlock':
      return evaluateRetryBlock(s, primary);

    case 'StatusProbe':
      return evaluateStatusProbe(s, primary);

    case 'AtomLiteral':
      // Atom literals (`#NAME`) resolve via the atom registry. Unregistered
      // names resolve to `#R001` at registry level; the node itself simply
      // materialises a typed atom value.
      return {
        __rill_atom: true,
        atom: resolveAtom(primary.name),
      } as unknown as RillValue;

    case 'RecoveryError': {
      // EC-12 / EC-14: a RecoveryErrorNode reached runtime produces an
      // invalid value with code `#R001`. Parse-recovery emitted the node;
      // execution surfaces it as an invalid per FR-ERR-4.
      const site = formatAccessSite(
        getNodeLocation(s, primary),
        s.ctx.sourceId
      );
      return invalidate(
        {},
        {
          code: 'R001',
          provider: 'parse-recovery',
          raw: { message: primary.message },
        },
        createTraceFrame({ site, kind: 'host', fn: 'parse-recovery' })
      );
    }

    default:
      throwTypeHalt(
        {
          location: getNodeLocation(s, primary),
          sourceId: s.ctx.sourceId,
          fn: 'primary',
        },
        'INVALID_INPUT',
        `Unsupported expression type: ${(primary as { type: string }).type}`,
        'runtime',
        { nodeType: (primary as { type: string }).type },
        'host'
      );
  }
}

/**
 * Evaluate pipe target with input value [IR-12].
 *
 * Pipe targets are expressions that can receive piped values.
 * Sets $ to the input value before evaluation.
 */
export async function evaluatePipeTarget(
  s: EvalState,
  target: PipeTargetNode,
  input: RillValue
): Promise<RillValue> {
  s.ctx.pipeValue = input;

  switch (target.type) {
    case 'HostCall':
      // Pass inPipeTarget=true so the IR-8 unified pipe-binding rule
      // applies: auto-prepend fires when no top-level `$` is in args.
      return evaluateHostCall(s, target, true);

    case 'HostRef':
      // pipeValue is already set to input above; evaluateHostRef invokes
      // with it when pipeValue is non-null [IR-4].
      return evaluateHostRef(s, target);

    case 'ClosureCall':
      return evaluateClosureCallWithPipe(s, target, input);

    case 'PipeInvoke':
      return evaluatePipeInvoke(s, target, input);

    case 'MethodCall':
      return evaluateMethod(s, target, input);

    case 'Conditional':
      return evaluateConditional(s, target);

    case 'WhileLoop':
      return evaluateWhileLoop(s, target);

    case 'DoWhileLoop':
      return evaluateDoWhileLoop(s, target);

    case 'Block': {
      // Create block-closure then invoke with input as $
      const closure = createBlockClosure(s, target);
      return invokeCallable(s, closure, [input], getNodeLocation(s, target));
    }

    case 'Closure': {
      // Inline closure: create and invoke
      const closure = await createClosure(s, target);

      // Per closure-semantics spec: check params.length to determine invocation style
      if (closure.params.length > 0) {
        // Has params: invoke with input as first argument
        return invokeCallable(s, closure, [input], getNodeLocation(s, target));
      } else {
        // Zero-param closure: invoke with args = [] and pipeValue = input
        const savedPipeValue = s.ctx.pipeValue;
        s.ctx.pipeValue = input;
        try {
          return await invokeCallable(
            s,
            closure,
            [],
            getNodeLocation(s, target)
          );
        } finally {
          s.ctx.pipeValue = savedPipeValue;
        }
      }
    }

    case 'StringLiteral': {
      const { value } = await evaluateString(s, target);
      return value;
    }

    case 'Dict': {
      // Hierarchical dispatch: detect list input (not tuple)
      if (Array.isArray(input) && !isTuple(input)) {
        // Evaluate dict literal first, then dispatch through path
        const dictValue = await evaluateDict(s, target);
        return await evaluateHierarchicalDispatch(
          s,
          dictValue,
          input,
          target.defaultValue ?? undefined,
          getNodeLocation(s, target)
        );
      }
      // Dict dispatch: lookup key matching piped value
      return evaluateDictDispatch(s, target, input);
    }

    case 'GroupedExpr':
      return evaluateGroupedExpr(s, target);

    case 'Destructure':
      return evaluateDestructure(s, target, input);

    case 'Destruct':
      // Keyword-based destruct<$a, $b, ...> form [IR-26]
      return evaluateDestruct(s, target, input);

    case 'ListLiteral': {
      // Hierarchical dispatch: detect list input (not tuple)
      if (Array.isArray(input) && !isTuple(input)) {
        // Evaluate list literal first, then dispatch through path
        const listValue = await evaluateCollectionLiteral(s, target);
        return await evaluateHierarchicalDispatch(
          s,
          listValue,
          input,
          target.defaultValue ?? undefined,
          getNodeLocation(s, target)
        );
      }
      // list[...] as pipe target: index-based dispatch [IR-11]
      return evaluateListLiteralDispatch(s, target, input);
    }

    case 'Slice':
      return evaluateSlice(s, target, input);

    case 'TypeAssertion':
      return evaluateTypeAssertion(s, target, input);

    case 'TypeCheck':
      return evaluateTypeCheck(s, target, input);

    case 'Variable': {
      // $.field is property access on pipe value, not closure invocation
      if (target.isPipeVar && !target.name && target.accessChain.length > 0) {
        return evaluatePipePropertyAccess(s, target, input);
      }
      // Variable in pipe chain: evaluate and invoke if callable
      const value = await evaluateVariableAsync(s, target);
      // If value is callable, invoke it with the pipe input
      // Per closure-semantics spec: check params.length to determine invocation style
      if (isCallable(value)) {
        // Check if callable has params to determine invocation style
        const hasParams =
          (value.kind === 'script' && value.params.length > 0) ||
          (value.kind === 'application' &&
            value.params !== undefined &&
            value.params.length > 0);

        if (hasParams) {
          // Block-closure: invoke with input as argument
          return invokeCallable(s, value, [input], getNodeLocation(s, target));
        } else {
          // Zero-param closure: invoke with args = [] and pipeValue = input
          const savedPipeValue = s.ctx.pipeValue;
          s.ctx.pipeValue = input;
          try {
            const result = await invokeCallable(
              s,
              value,
              [],
              getNodeLocation(s, target)
            );
            return result;
          } finally {
            s.ctx.pipeValue = savedPipeValue;
          }
        }
      }

      // Slot 6 (IR-2): Type value dispatch — delegate to applyConversion.
      // Detection uses the __rill_type flag on RillTypeValue, not structural
      // duck typing. Must be checked BEFORE isDict and hierarchical dispatch
      // checks, since RillTypeValue is a plain object that isDict() would
      // otherwise match.
      if (isTypeValue(value)) {
        return applyConversion(s, input, value.typeName, target);
      }

      // Variable dispatch: if value is dict or list, dispatch into it
      // Hierarchical dispatch: detect list input (not tuple) for path navigation
      const defaultVal: BodyNode | null = target.defaultValue;
      if (Array.isArray(input) && !isTuple(input)) {
        if (isDict(value) || (Array.isArray(value) && !isTuple(value))) {
          return await evaluateHierarchicalDispatch(
            s,
            value,
            input,
            defaultVal ?? undefined,
            getNodeLocation(s, target)
          );
        }
      }

      if (Array.isArray(value) && !isTuple(value)) {
        // List dispatch
        return await dispatchToList(s, value, input, defaultVal, target);
      }

      if (isDict(value)) {
        // Dict dispatch
        return await dispatchToDict(s, value, input, defaultVal, target);
      }

      // Non-dispatchable type in pipe context - error
      const valueType =
        typeof value === 'object' && value !== null
          ? Array.isArray(value)
            ? 'tuple'
            : 'dict'
          : typeof value;
      return throwCatchableHostHalt(
        {
          location: getNodeLocation(s, target),
          sourceId: s.ctx.sourceId,
          fn: 'evaluatePipeChain',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Cannot dispatch to ${valueType}`
      );
    }

    case 'PostfixExpr': {
      // Chained methods on pipe value: -> .a.b.c
      // The primary is implicit $ (pipe value)
      let value = input;
      for (const method of target.methods) {
        if (method.type === 'AnnotationAccess') {
          value = await evaluateAnnotationAccess(
            s,
            value,
            method.key,
            method.span.start
          );
        } else {
          value = await evaluateMethod(s, method, value);
        }
      }
      return value;
    }

    case 'AnnotationAccess':
      return evaluateAnnotationAccess(s, input, target.key, target.span.start);

    case 'Assert':
      return evaluateAssert(s, target, input);

    case 'Error':
      return evaluateError(s, target, input);

    case 'TypeNameExpr': {
      // Pipe target: `-> type` (bare type keyword). Delegate directly to
      // applyConversion, which enforces the full conversion compatibility
      // matrix (no-op short-circuits, RILL-R036, RILL-R037, etc.).
      return applyConversion(s, input, target.typeName, target);
    }

    case 'TypeConstructor': {
      // Pipe target: `-> type(...)` (parameterized type constructor).
      // Delegate to applyConstructorConversion, which handles structural
      // signatures (dict/ordered/tuple with fields) and uniform types.
      return applyConstructorConversion(s, input, target, target);
    }

    case 'UseExpr':
      return evaluateUseExpr(s, target);

    case 'PassBlock':
      // pipeValue is already set to input above; evaluatePassBlock returns
      // the original pipe value unchanged (suppressing catchable halts per
      // on_error option).
      return evaluatePassBlock(s, target);

    case 'TimeoutBlock':
      return evaluateTimeoutBlock(s, target);

    default:
      throwTypeHalt(
        {
          location: getNodeLocation(s, target),
          sourceId: s.ctx.sourceId,
          fn: '->',
        },
        'INVALID_INPUT',
        `Unsupported pipe target type: ${(target as { type: string }).type}`,
        'runtime',
        { nodeType: (target as { type: string }).type },
        'host'
      );
  }
}

/**
 * Navigate nested data structure using list of keys/indexes [IR-1].
 *
 * Traverses through nested dicts and lists using a path of keys/indexes.
 * Empty path returns target unchanged. Each path element dispatches to
 * current value. Terminal closures receive $ = final path key.
 *
 * @param s - Evaluator state
 * @param target - Already-evaluated dict/list to navigate
 * @param path - List of keys/indexes to traverse
 * @param defaultExpr - Optional default value if path not found
 * @param location - Source location for error reporting
 * @returns Final value at path
 */
export async function evaluateHierarchicalDispatch(
  s: EvalState,
  target: RillValue,
  path: RillValue[],
  defaultExpr?: BodyNode,
  location?: SourceLocation
): Promise<RillValue> {
  // Target is already evaluated
  const targetValue = target;

  // Empty path returns target unchanged
  if (path.length === 0) {
    return targetValue;
  }

  try {
    // Navigate through path elements
    let current = targetValue;
    let lastKey: RillValue | undefined;

    // Traverse all elements except the last
    for (let i = 0; i < path.length - 1; i++) {
      // Bounds-checked loop: path[i] is always defined
      const key = path[i]!;
      current = await traversePathStep(s, current, key, false, location);
    }

    // Handle last element separately for terminal closure support
    // path.length > 0 is guaranteed above so this index is always valid
    lastKey = path[path.length - 1]!;
    const result = await traversePathStep(s, current, lastKey, true, location);

    // Resolve terminal value (handles terminal closures with $ = lastKey)
    return await resolveTerminalValue(s, result, lastKey, location);
  } catch (error) {
    // Handle missing key/index errors with default value. After the Phase 2
    // halt-builder migration, traversePathStep throws RuntimeHaltSignal with
    // atom RILL_R009 instead of RuntimeError directly; matchesErrorId handles
    // both the legacy and migrated forms.
    if (
      matchesErrorId(
        error,
        ERROR_IDS.RILL_R009,
        ERROR_ATOMS[ERROR_IDS.RILL_R009]
      )
    ) {
      if (defaultExpr) {
        return await evaluateBodyExpression(s, defaultExpr);
      }
      // No default - re-throw original error
      throw error;
    }
    // Type errors and other errors always propagate
    throw error;
  }
}

/**
 * Execute single path step: dispatch key to current value [IR-2].
 *
 * Handles type-specific dispatch:
 * - Dict + string key -> dispatchToDict
 * - List + number key -> dispatchToList
 * - Other combinations -> type error
 *
 * For non-terminal steps, closures are resolved via resolveIntermediateClosure.
 * Terminal closures are handled by caller with $ = key.
 *
 * @param s - Evaluator state
 * @param current - Current value in traversal
 * @param key - Key/index to dispatch
 * @param isTerminal - Whether this is the final path element
 * @param location - Source location for error reporting
 * @returns Value at key/index
 */
export async function traversePathStep(
  s: EvalState,
  current: RillValue,
  key: RillValue,
  isTerminal: boolean,
  location?: SourceLocation
): Promise<RillValue> {
  // Dict + string key: dispatch to dict
  if (isDict(current) && typeof key === 'string') {
    // Create location-like object for dispatchToDict signature.
    // exactOptionalPropertyTypes requires explicit conditional assignment.
    const locObj: {
      span?: { start: SourceLocation; end: SourceLocation };
    } = {};
    if (location) locObj.span = { start: location, end: location };
    const result = await dispatchToDict(
      s,
      current,
      key,
      null, // No default value for intermediate steps
      locObj,
      true // Skip closure resolution - we handle it here
    );

    // Non-terminal closures must be resolved via resolveIntermediateClosure
    if (!isTerminal && isCallable(result)) {
      return await resolveIntermediateClosure(s, result, location);
    }

    // Terminal closures will be handled by evaluateHierarchicalDispatch
    return result;
  }

  // List + number key: dispatch to list
  if (Array.isArray(current) && !isTuple(current) && typeof key === 'number') {
    // Create location-like object for dispatchToList signature.
    // exactOptionalPropertyTypes requires explicit conditional assignment.
    const locObj: {
      span?: { start: SourceLocation; end: SourceLocation };
    } = {};
    if (location) locObj.span = { start: location, end: location };
    const result = await dispatchToList(
      s,
      current,
      key,
      null, // No default value for intermediate steps
      locObj,
      true // Skip closure resolution - we handle it here
    );

    // Non-terminal closures must be resolved via resolveIntermediateClosure
    if (!isTerminal && isCallable(result)) {
      return await resolveIntermediateClosure(s, result, location);
    }

    // Terminal closures will be handled by evaluateHierarchicalDispatch
    return result;
  }

  // Type mismatch: throw error
  const currentType = Array.isArray(current)
    ? isTuple(current)
      ? 'tuple'
      : 'list'
    : isDict(current)
      ? 'dict'
      : typeof current;
  const keyType = typeof key;

  throwCatchableHostHalt(
    {
      location,
      sourceId: s.ctx.sourceId,
      fn: 'hierarchicalDispatch',
    },
    ERROR_ATOMS[ERROR_IDS.RILL_R002],
    `Hierarchical dispatch type mismatch: cannot use ${keyType} key with ${currentType} value`,
    { currentType, keyType, key }
  );
}

/**
 * Resolve closure encountered at non-terminal path position.
 *
 * Auto-invokes zero-param closures with args = [].
 * Throws error for parameterized closures (no args available at intermediate position).
 * Returns non-callable values unchanged.
 *
 * @param s - Evaluator state
 * @param value - Value to resolve (may be callable or regular value)
 * @param location - Source location for error reporting
 * @returns Resolved value (invoked result or original value)
 * @throws RuntimeError with RUNTIME_TYPE_ERROR if parameterized closure
 */
export async function resolveIntermediateClosure(
  s: EvalState,
  value: RillValue,
  location?: SourceLocation
): Promise<RillValue> {
  if (!isCallable(value)) {
    return value;
  }

  // Check for parameterized closure (explicit user-defined params)
  // Note: Block-closures have exactly 1 param named '$'
  // Parameterized closures have 1+ params with user-defined names
  if (value.kind === 'script' && value.params.length >= 1) {
    // Check if first param is '$' (block-closure) or user-defined (parameterized)
    if (value.params[0]!.name !== '$') {
      // Parameterized closure at intermediate position: error per EC-8
      throwCatchableHostHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'resolveIntermediateClosure',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Cannot invoke parameterized closure at intermediate path position'
      );
    }
  }

  // Zero-param closure or block-closure: auto-invoke with args = []
  return await invokeCallable(s, value, [], location);
}

/**
 * Resolve terminal value in hierarchical dispatch: auto-invoke closures with finalKey.
 * Used when navigating to a final path element.
 *
 * Behavior per IR-4:
 * - Block-closures (params.length > 0, first param is '$'): invoke with args = [finalKey]
 * - Zero-param closures: invoke with pipeValue = finalKey
 * - Parameterized closures: throw error (dispatch does not provide args)
 * - Non-callable: return unchanged
 *
 * @param s - Evaluator state
 * @param value - Value at terminal path position
 * @param finalKey - Final key from path (becomes $ or first arg)
 * @param location - Source location for error reporting
 * @returns Resolved value (invoked or unchanged)
 * @throws RuntimeError with RUNTIME_TYPE_ERROR if parameterized closure
 */
export async function resolveTerminalValue(
  s: EvalState,
  value: RillValue,
  finalKey: RillValue,
  location?: SourceLocation
): Promise<RillValue> {
  if (!isCallable(value)) {
    return value;
  }

  // Check for parameterized closure (explicit user-defined params)
  // Note: Block-closures have exactly 1 param named '$'
  // Parameterized closures have 1+ params with user-defined names
  if (value.kind === 'script' && value.params.length >= 1) {
    // Check if first param is '$' (block-closure) or user-defined (parameterized)
    if (value.params[0]!.name !== '$') {
      // Parameterized closure at terminal position: error per EC-9
      throwCatchableHostHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'resolveTerminalValue',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Dispatch does not provide arguments for parameterized closure'
      );
    }
  }

  // Check if callable has params to determine invocation style
  const hasParams =
    (value.kind === 'script' && value.params.length > 0) ||
    (value.kind === 'application' &&
      value.params !== undefined &&
      value.params.length > 0);

  if (hasParams) {
    // Block-closure or application callable with params: invoke with finalKey as argument
    return await invokeCallable(s, value, [finalKey], location);
  } else {
    // Zero-param closure: invoke with pipeValue = finalKey
    const savedPipeValue = s.ctx.pipeValue;
    s.ctx.pipeValue = finalKey;
    try {
      const result = await invokeCallable(s, value, [], location);
      return result;
    } finally {
      s.ctx.pipeValue = savedPipeValue;
    }
  }
}
