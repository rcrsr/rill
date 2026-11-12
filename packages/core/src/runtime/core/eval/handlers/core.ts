/**
 * Main Expression Dispatch
 *
 * Provides the main entry points for expression evaluation and dispatches
 * to specialized evaluators based on AST node type.
 *
 * This is the central coordination point that ties together all other evaluator handlers.
 *
 * Interface requirements:
 * - evaluateExpression(expr) -> Promise<RillValue>
 * - evaluatePipeChain(chain) -> Promise<RillValue>
 * - evaluatePostfixExpr(expr) -> Promise<RillValue>
 * - evaluatePrimary(primary) -> Promise<RillValue>
 * - evaluatePipeTarget(target, input) -> Promise<RillValue>
 *
 * Error Handling:
 * - Unsupported expression types throw RuntimeError
 * - Aborted execution halts via RuntimeHaltSignal
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
import type { RillValue, TypeStructure } from '../../types/structures.js';
import {
  setArgsDeclared,
  setPipe,
  type Carried,
} from '../../types/declared.js';
import { isTuple, isTypeValue, isPlainDict } from '../../types/guards.js';
import {
  declaredParams,
  isCallable,
  isScriptCallable,
} from '../../callable.js';
import { inferType } from '../../types/registrations.js';
import { BreakSignal, ReturnSignal } from '../../signals.js';
import { invalidate, getStatus } from '../../types/status.js';
import { createTraceFrame } from '../../types/trace.js';
import {
  resolveAtom,
  atomName,
  toAtomValue,
} from '../../types/atom-registry.js';
import type { EvalState } from '../state.js';
import { accessHaltGateFast, formatAccessSite } from './access.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
  RuntimeHaltSignal,
} from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, checkAborted } from '../shared.js';
import {
  invokeCallable,
  evaluateMethod,
  evaluateAnnotationAccess,
  evaluateHostCall,
  evaluateYield,
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
  evaluateAssert,
  evaluateBodyExpression,
} from './control-flow.js';
import { evaluateUseExpr } from './use.js';
import {
  evaluateTypeCheck,
  evaluateTypeConstructor,
  evaluateClosureSigLiteral,
} from './types.js';
import { ERROR_CODE_STRUCTURE } from '../../types/error-code.js';
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
import { evaluateCollectionLiteral, evaluateSlice } from './extraction.js';
import { applyConversion, applyConstructorConversion } from './conversion.js';
import { evaluateListLiteralDispatch } from './list-dispatch.js';
import { evaluateAnnotations } from './annotations.js';
import {
  evaluateCarryingPipeTarget,
  evaluatePostfixExprCarried,
  evaluatePrimaryCarried,
  restorePipe,
} from './declared-flow.js';

// ============================================================
// ERROR-ID MATCHER (Fix A: ??)
// ============================================================

/**
 * Returns true when `error` matches either the legacy `RuntimeError` with
 * the given `runtimeErrorId`, or a `RuntimeHaltSignal` whose halt-atom
 * name equals `haltAtomCode`.
 *
 * Used by `evaluatePostfixExpr` and the path-traversal catch block to
 * coalesce RILL_R007 / RILL_R009 halts into the `??` default value. Those
 * halts are catchable, so `??` can recover from them.
 */
export function matchesErrorId(
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
 * Main expression evaluation entry point.
 * Delegates to pipe chain evaluator.
 */
export async function evaluateExpression(
  s: EvalState,
  expr: ExpressionNode
): Promise<RillValue> {
  return (await evaluateExpressionCarried(s, expr)).value;
}

/**
 * Expression evaluation that also reports the declared type of the result.
 */
// oxlint-disable-next-line require-await -- the PartialExpression guard halts synchronously; the async boundary turns it into a rejection
export async function evaluateExpressionCarried(
  s: EvalState,
  expr: ExpressionNode
): Promise<Carried> {
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
  return evaluatePipeChainCarried(s, expr);
}

/**
 * Evaluate pipe chain with left-to-right flow.
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
  return (await evaluatePipeChainCarried(s, chain)).value;
}

/**
 * Pipe-chain evaluation that also reports the declared type of the result.
 * The chain keeps a local declaration beside its value: a postfix head and
 * each carrying target supply one, a binary or unary head carries none.
 */
export async function evaluatePipeChainCarried(
  s: EvalState,
  chain: PipeChainNode
): Promise<Carried> {
  // Save parent's $ and its declaration slot - chains don't leak $
  // modifications to parent scope. The try/finally guarantees restoration on
  // every exit, including when a pipe target throws (a halt or control
  // signal). Without it, an error mid-chain leaves the chain's intermediate
  // value in ctx.pipeValue, which a surrounding `??` default would then
  // observe as a stale `$`.
  const savedPipeValue = s.ctx.pipeValue;
  const savedPipeDeclared = s.ctx.pipeDeclared;
  try {
    // Evaluate head (can be PostfixExpr, BinaryExpr, or UnaryExpr)
    let value: RillValue;
    let declared: TypeStructure | undefined;
    switch (chain.head.type) {
      case 'BinaryExpr':
        value = await evaluateBinaryExpr(s, chain.head);
        declared = undefined;
        break;
      case 'UnaryExpr':
        value = await evaluateUnaryExpr(s, chain.head);
        declared = undefined;
        break;
      case 'PostfixExpr':
        ({ value, declared } = await evaluatePostfixExprCarried(s, chain.head));
        break;
    }
    setPipe(s.ctx, value, declared); // OK: local to this chain evaluation

    // Evaluate each pipe target in sequence
    // BreakSignal and ReturnSignal propagate through to the caller.
    for (const target of chain.pipes) {
      // Handle inline captures (act as identity: store and pass through)
      if (target.type === 'Capture') {
        await handleCapture(s, target, value, declared);
        // Value flows through unchanged
        continue;
      }

      // access-halt gate at pipe site. An invalid LHS halts before
      // flowing into the pipe target; `->` is an access on the LHS value.
      // Status probes bypass the gate at their own call site (see
      // evaluateStatusProbe) so this gate never fires for `.!` access.
      value = accessHaltGateFast(
        value,
        '->',
        () => getNodeLocation(s, target),
        s.ctx.sourceId
      );

      ({ value, declared } = await evaluatePipeTarget(s, target, {
        value,
        declared,
      }));
      setPipe(s.ctx, value, declared); // OK: flows within chain
    }

    // Handle chain terminator (capture, break, return, yield)
    if (chain.terminator) {
      if (chain.terminator.type === 'Break') {
        throw new BreakSignal(value);
      }
      if (chain.terminator.type === 'Return') {
        throw new ReturnSignal(value);
      }
      if (chain.terminator.type === 'Yield') {
        // Restore parent's $ before yielding so a blocked stream consumer
        // never observes the chain's internal $.
        restorePipe(s.ctx, savedPipeValue, savedPipeDeclared);
        // Delegate to evaluateYield for chunk type validation + YieldSignal.
        // When inside a stream closure body, evaluateYield pushes to the
        // channel and blocks until the consumer pulls (returns Promise<void>).
        // When outside, it throws YieldSignal synchronously.
        await evaluateYield(s, value, chain.terminator.span.start);
        // After yield resumes (stream channel case), return the yielded
        // value as the chain result
        return { value, declared };
      }
      // Capture
      await handleCapture(s, chain.terminator, value, declared);
    }

    return { value, declared };
  } finally {
    // Restore parent's $ on every exit path (normal, thrown, or control
    // signal) - chain result is returned, but $ doesn't leak.
    restorePipe(s.ctx, savedPipeValue, savedPipeDeclared);
  }
}

/**
 * Evaluate postfix expression: primary with method chain.
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
  return (await evaluatePostfixExprCarried(s, expr)).value;
}

/**
 * Evaluate primary expression.
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

    case 'AnnotatedExpr': {
      // Set immediateAnnotation before evaluating the inner primary so
      // createClosure() can consume it via captureClosureAnnotations.
      const annots = await evaluateAnnotations(s, primary.annotations);
      s.ctx.immediateAnnotation = annots;
      try {
        const innerResult = await evaluatePrimary(s, primary.expression);
        if (!isScriptCallable(innerResult)) {
          // Non-closure: annotation silently ignored
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

    case 'TypeAssertion':
      return (await evaluatePrimaryCarried(s, primary)).value;

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
      // Bare type names that name a known kind get that kind's structure;
      // unknown names fall back to 'any'. This includes the scalar/branded
      // kinds (datetime, duration, atom, iterator, stream) so that
      // `now().^type == datetime` and `range(0,3).^type == iterator` hold.
      if (primary.typeName === 'error_code') {
        return Object.freeze({
          __rill_type: true as const,
          typeName: primary.typeName,
          structure: ERROR_CODE_STRUCTURE,
        });
      }
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
          primary.typeName === 'type' ||
          primary.typeName === 'datetime' ||
          primary.typeName === 'duration' ||
          primary.typeName === 'atom' ||
          primary.typeName === 'iterator' ||
          primary.typeName === 'stream'
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
      // Atom literals (`#NAME`) materialise an atom value named by the literal.
      return toAtomValue(resolveAtom(primary.name));

    case 'RecoveryError': {
      // a RecoveryErrorNode reached runtime produces an
      // invalid value with code `#R001`. Parse-recovery emitted the node;
      // execution surfaces it as an invalid.
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
      return throwTypeHalt(
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
 * Invoke a callable that is the target of a pipe.
 * Callables with params receive the input as their argument; zero-param
 * callables run with the input as the pipe value `$`.
 */
async function invokePipeCallable(
  s: EvalState,
  value: Parameters<typeof invokeCallable>[1],
  input: Carried,
  location: ReturnType<typeof getNodeLocation>,
  functionName = 'callable'
): Promise<RillValue> {
  const hasParams =
    (value.kind === 'script' && value.params.length > 0) ||
    (value.kind === 'application' &&
      declaredParams(value, functionName, location).length > 0 &&
      !value.isProperty);

  if (hasParams) {
    return invokeCallable(s, value, argsOf(input), location);
  }

  const savedPipeValue = s.ctx.pipeValue;
  const savedPipeDeclared = s.ctx.pipeDeclared;
  setPipe(s.ctx, input.value, input.declared);
  try {
    return await invokeCallable(s, value, [], location);
  } finally {
    restorePipe(s.ctx, savedPipeValue, savedPipeDeclared);
  }
}

/** Build a one-element args array whose declaration rides in the sidecar. */
function argsOf(input: Carried): RillValue[] {
  const args = [input.value];
  setArgsDeclared(args, [input.declared]);
  return args;
}

/**
 * Evaluate pipe target with input value.
 *
 * Pipe targets are expressions that can receive piped values.
 * Sets $ to the input value before evaluation.
 */
export async function evaluatePipeTarget(
  s: EvalState,
  target: PipeTargetNode,
  carried: Carried
): Promise<Carried> {
  setPipe(s.ctx, carried.value, carried.declared);
  const carrying = await evaluateCarryingPipeTarget(s, target, carried);
  if (carrying !== undefined) return carrying;
  return {
    value: await evaluatePipeTargetValue(s, target, carried),
    declared: undefined,
  };
}

/** Pipe targets that take their own type; carrying targets run above. */
async function evaluatePipeTargetValue(
  s: EvalState,
  target: PipeTargetNode,
  carried: Carried
): Promise<RillValue> {
  const input = carried.value;

  switch (target.type) {
    case 'HostCall':
      // Pass inPipeTarget=true so the unified pipe-binding rule
      // applies: auto-prepend fires when no top-level `$` is in args.
      return evaluateHostCall(s, target, true);

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
      return invokeCallable(
        s,
        closure,
        argsOf(carried),
        getNodeLocation(s, target)
      );
    }

    case 'Closure': {
      // Inline closure: create and invoke
      const closure = await createClosure(s, target);

      // Per closure-semantics spec: check params.length to determine invocation style
      if (closure.params.length > 0) {
        // Has params: invoke with input as first argument
        return invokeCallable(
          s,
          closure,
          argsOf(carried),
          getNodeLocation(s, target)
        );
      } else {
        // Zero-param closure: invoke with args = [] and pipeValue = input
        const savedPipeValue = s.ctx.pipeValue;
        const savedPipeDeclared = s.ctx.pipeDeclared;
        setPipe(s.ctx, input, carried.declared);
        try {
          return await invokeCallable(
            s,
            closure,
            [],
            getNodeLocation(s, target)
          );
        } finally {
          restorePipe(s.ctx, savedPipeValue, savedPipeDeclared);
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
      // list[...] as pipe target: index-based dispatch
      return evaluateListLiteralDispatch(s, target, input);
    }

    case 'Slice':
      return evaluateSlice(s, target, input);

    case 'TypeCheck': {
      // A written operand is evaluated once; otherwise the input is checked.
      const checked = target.operand
        ? await evaluatePostfixExpr(s, target.operand)
        : input;
      return evaluateTypeCheck(s, target, checked);
    }

    case 'Variable': {
      // `$.field` access is handled by the carrying-target path.
      // Variable in pipe chain: evaluate and invoke if callable
      const value = await evaluateVariableAsync(s, target);
      // If value is callable, invoke it with the pipe input
      // Per closure-semantics spec: check params.length to determine invocation style
      if (isCallable(value)) {
        return invokePipeCallable(
          s,
          value,
          carried,
          getNodeLocation(s, target),
          `$${target.name ?? ''}`
        );
      }

      // Slot 6: Type value dispatch — delegate to applyConversion.
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
        if (isPlainDict(value) || (Array.isArray(value) && !isTuple(value))) {
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

      if (isPlainDict(value)) {
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

    case 'AnnotationAccess':
      return evaluateAnnotationAccess(
        s,
        input,
        target.key,
        target.span.start,
        carried.declared
      );

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

    case 'UseExpr': {
      const resolved = await evaluateUseExpr(s, target);
      return isCallable(resolved)
        ? invokePipeCallable(s, resolved, carried, getNodeLocation(s, target))
        : resolved;
    }

    case 'TimeoutBlock':
      return evaluateTimeoutBlock(s, target);

    default:
      return throwTypeHalt(
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
 * Navigate nested data structure using list of keys/indexes.
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
async function evaluateHierarchicalDispatch(
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

    // Traverse all elements except the last, which is kept for terminal
    // closure support.
    for (const key of path) {
      if (lastKey !== undefined) {
        current = await traversePathStep(s, current, lastKey, false, location);
      }
      lastKey = key;
    }

    if (lastKey === undefined) {
      return throwFatalHostHalt(
        {
          location,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateHierarchicalDispatch',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        'Hierarchical dispatch path is empty'
      );
    }
    const result = await traversePathStep(s, current, lastKey, true, location);

    // Resolve terminal value (handles terminal closures with $ = lastKey)
    return await resolveTerminalValue(s, result, lastKey, location);
  } catch (error) {
    // Handle missing key/index errors with default value.
    // traversePathStep throws RuntimeHaltSignal with atom RILL_R009 instead
    // of RuntimeError directly; matchesErrorId handles both the legacy and
    // halt forms.
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
 * Execute single path step: dispatch key to current value.
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
async function traversePathStep(
  s: EvalState,
  current: RillValue,
  key: RillValue,
  isTerminal: boolean,
  location?: SourceLocation
): Promise<RillValue> {
  // Dict + string key: dispatch to dict
  if (isPlainDict(current) && typeof key === 'string') {
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
    : inferType(current);
  const keyType = typeof key;

  return throwCatchableHostHalt(
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
 * @throws RuntimeHaltSignal (catchable, RILL-R002) if parameterized closure
 */
async function resolveIntermediateClosure(
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
  const firstParam = value.kind === 'script' ? value.params[0] : undefined;
  if (value.kind === 'script' && firstParam !== undefined) {
    // Check if first param is '$' (block-closure) or user-defined (parameterized)
    if (firstParam.name !== '$') {
      // Parameterized closures cannot be auto-invoked at an intermediate path position.
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
 * Behavior:
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
 * @throws RuntimeHaltSignal (catchable, RILL-R002) if parameterized closure
 */
async function resolveTerminalValue(
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
  const firstParam = value.kind === 'script' ? value.params[0] : undefined;
  if (value.kind === 'script' && firstParam !== undefined) {
    // Check if first param is '$' (block-closure) or user-defined (parameterized)
    if (firstParam.name !== '$') {
      // Parameterized closures cannot be auto-invoked at a terminal path position.
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
      declaredParams(value).length > 0 &&
      !value.isProperty);

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
