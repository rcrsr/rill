/**
 * LiteralsMixin: String, Tuple, Dict, Closure, and Pass Evaluation
 *
 * Handles evaluation of literal values including:
 * - Pass keyword (returns current pipe value)
 * - String literals with interpolation
 * - Tuple literals
 * - Dict literals with callable binding
 * - Closure creation with late binding
 * - Block-closure creation for expression-position blocks
 *
 * Interface requirements (from spec):
 * - evaluatePass(node) -> Promise<RillValue> [IR-4]
 * - evaluateString(node) -> Promise<{ value: string; interpolated: boolean }>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 *
 * Error Handling:
 * - Pass throws RUNTIME_UNDEFINED_VARIABLE if $ not bound [EC-5]
 * - String interpolation errors propagate from evaluateExpression() [EC-6]
 * - Dict/tuple evaluation errors propagate from nested expressions [EC-7]
 *
 * @internal
 */

import type {
  StringLiteralNode,
  ListLiteralNode,
  ListSpreadNode,
  DictNode,
  ClosureNode,
  BlockNode,
  PostfixExprNode,
  ExpressionNode,
  BodyNode,
  SourceLocation,
  AnnotationArg,
  NamedArgNode,
  SpreadArgNode,
  DictKeyVariable,
  DictKeyComputed,
  PassNode,
  PassBlockNode,
  TypeRef,
} from '../../../../types.js';
import { isPipeChainNode } from '../../../../types.js';
import type { TypeStructure, RillValue } from '../../types/structures.js';
import { deepEquals, formatValue } from '../../types/registrations.js';
import { isTypeValue, isVector } from '../../types/guards.js';
import { inferElementType } from '../../types/operations.js';
import { anyTypeValue, isReservedMethod } from '../../values.js';
import {
  isCallable,
  type ScriptCallable,
  type RillParam,
} from '../../callable.js';
import {
  throwCatchableHostHalt,
  throwFatalHostHalt,
  throwTypeHalt,
  RuntimeHaltSignal,
} from '../../types/halt.js';
import { ControlSignal } from '../../signals.js';
import { resolveAtom } from '../../types/atom-registry.js';
import { isAtom } from '../../types/guards.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';
import type { EvalState } from '../state.js';
import type { RuntimeContext } from '../../types/runtime.js';
import { createChildContext, getVariable } from '../../context.js';
import { getEvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation } from '../shared.js';
import {
  evaluateExpression,
  evaluatePipeChain,
  evaluatePrimary,
} from './core.js';
import { evaluateBody, evaluateBodyExpression } from './control-flow.js';
import { invokeCallable } from './closures.js';
import { resolveTypeRef, evaluateTypeConstructor } from './types.js';
import { evaluateListLiteralElements } from './extraction.js';

/**
 * Capture annotation context at closure creation time.
 *
 * Evaluates annotation expressions in current context and returns structured object
 * with closure-level and parameter-level annotations.
 *
 * Closure-level annotations are captured from the annotation stack (statement-level
 * annotations like `^(doc: "test")` that precede the closure definition).
 *
 * @param ctx - Runtime context with annotation stack
 * @param closureNode - Closure AST node with parameter annotations
 * @param evaluateExpression - Expression evaluator function
 * @returns Object with annotations and paramAnnotations as evaluated values
 *
 * @internal
 */
async function captureClosureAnnotations(ctx: RuntimeContext): Promise<{
  annotations: Record<string, RillValue>;
}> {
  // Capture closure-level annotations from immediateAnnotation field [IR-7].
  // When a closure is created within a directly-annotated statement like:
  // ^(doc: "test") |x|($x * 2) :> $fn
  // immediateAnnotation holds the evaluated annotations set by executeAnnotatedStatement.
  // Consumed once: cleared after capture to prevent unintended re-use.
  const annotations: Record<string, RillValue> = ctx.immediateAnnotation ?? {};
  ctx.immediateAnnotation = undefined;

  return { annotations };
}

/**
 * Evaluate annotation arguments to a dict of key-value pairs.
 * Handles both named arguments and spread arguments.
 *
 * @param annotations - Annotation arguments from AST
 * @param evaluateExpression - Expression evaluator function
 * @returns Record of annotation key-value pairs
 *
 * @internal
 */
async function evaluateAnnotations(
  annotations: AnnotationArg[],
  evaluateExpression: (expr: ExpressionNode) => Promise<RillValue>
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};

  for (const arg of annotations) {
    if (arg.type === 'NamedArg') {
      const namedArg = arg as NamedArgNode;
      result[namedArg.name] = await evaluateExpression(namedArg.value);
    } else {
      // SpreadArg: spread tuple/dict keys as annotations
      const spreadArg = arg as SpreadArgNode;
      const spreadValue = await evaluateExpression(spreadArg.expression);

      if (
        typeof spreadValue === 'object' &&
        spreadValue !== null &&
        !Array.isArray(spreadValue) &&
        !isCallable(spreadValue)
      ) {
        // Dict: spread all key-value pairs
        Object.assign(result, spreadValue);
      } else if (Array.isArray(spreadValue)) {
        // Tuple/list: not valid for annotations (need named keys)
        throwCatchableHostHalt(
          { location: spreadArg.span.start, fn: 'evaluateAnnotations' },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Annotation spread requires dict with named keys, got list'
        );
      } else {
        throwCatchableHostHalt(
          { location: spreadArg.span.start, fn: 'evaluateAnnotations' },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Annotation spread requires dict, got ${typeof spreadValue}`
        );
      }
    }
  }

  return result;
}

/**
 * Narrows a dict-entry value expression to its PipeChainNode head.
 *
 * Bare-closure and bare-block dict entries are parsed inline while building
 * a live dict literal (never via the statement-level recovery path), so
 * `expr` only ever holds a PipeChainNode here; PartialExpressionNode is
 * reserved for parser error recovery. The check below is a defensive
 * narrowing that is unreachable in normal execution.
 *
 * @internal
 */
function requirePipeChainHead(
  expr: ExpressionNode,
  ctx: RuntimeContext,
  fn: string
): PostfixExprNode {
  if (!isPipeChainNode(expr)) {
    throwFatalHostHalt(
      { sourceId: ctx.sourceId, fn },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Expected a PipeChain node with PostfixExpr head'
    );
  }
  return expr.head as PostfixExprNode;
}

/**
 * Evaluate pass node - returns current pipe value unchanged [IR-4].
 *
 * Pass returns ctx.pipeValue. If $ not bound (pipeValue is null),
 * throws RUNTIME_UNDEFINED_VARIABLE error [EC-5].
 *
 * @param s - Evaluator state
 * @param node - PassNode from AST
 * @returns Current pipe value
 * @throws RuntimeError with RUNTIME_UNDEFINED_VARIABLE if $ not bound
 */
export async function evaluatePass(
  s: EvalState,
  node: PassNode
): Promise<RillValue> {
  if (s.ctx.pipeValue === null) {
    throwCatchableHostHalt(
      {
        location: node.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluatePass',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R005],
      "Variable '$' not defined",
      { variable: '$' }
    );
  }
  return s.ctx.pipeValue;
}

/**
 * Evaluate pass block node — non-halting side-effect [IR-8].
 *
 * Runs `body` in the current context. Reads `on_error` from `options`;
 * when it equals `#IGNORE`, catchable halts from the body are suppressed
 * and the original pipe value is returned unchanged [EC-8].
 *
 * When `async: true` is present in options, the body is dispatched via
 * `trackInflight` without awaiting (fire-and-forget). The pipe-entry value
 * flows downstream immediately; the body return value is discarded [IR-3].
 * `on_error: #IGNORE` composes with `async: true`: the registered promise
 * suppresses catchable body halts when both options are set [EC-8].
 *
 * Non-catchable halts (`catchable: false`) and `ControlSignal` instances
 * are always re-thrown per §NOD.10.4 [EC-9].
 *
 * @param s - Evaluator state
 * @param node - PassBlockNode from AST
 * @returns Original pipe value (ctx.pipeValue at entry), unchanged
 */
export async function evaluatePassBlock(
  s: EvalState,
  node: PassBlockNode
): Promise<RillValue> {
  // Capture pipe value at entry — returned unchanged regardless of body outcome.
  const pipeBefore = s.ctx.pipeValue;

  // Evaluate options dict to determine suppression and async dispatch mode.
  const opts = await evaluateDict(s, node.options);

  const onErrorValue = opts['on_error'];
  const suppress =
    onErrorValue !== undefined &&
    isAtom(onErrorValue) &&
    onErrorValue.atom === resolveAtom('IGNORE');

  // Read async option [IR-3]. Parser enforces BoolLiteral; runtime defends
  // against non-bool at evaluation time [EC-6 → RILL_R003].
  const asyncValue = opts['async'];
  if (asyncValue !== undefined && typeof asyncValue !== 'boolean') {
    throwCatchableHostHalt(
      {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'evaluatePassBlock',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `pass<async:> value must be a bool, got ${typeof asyncValue}`
    );
  }
  const isAsync = asyncValue === true;

  // Body execution logic shared between sync and async paths.
  // Returns a promise that resolves on body completion or rejects with a
  // re-throwable signal. Catchable halts are suppressed when suppress is
  // true; non-catchable halts and ControlSignals always propagate.
  const runBody = (evaluator: EvalState): Promise<void> =>
    evaluateBody(evaluator, node.body)
      .then(() => undefined)
      .catch((e: unknown) => {
        // §NOD.10.4: ControlSignal always re-throws.
        if (e instanceof ControlSignal) throw e;
        // Non-catchable halts always re-throw [EC-9].
        if (e instanceof RuntimeHaltSignal && !e.catchable) throw e;
        // Catchable halt: suppress only when on_error: #IGNORE [EC-8].
        if (e instanceof RuntimeHaltSignal && suppress) {
          // Suppressed — body error discarded.
          return;
        }
        throw e;
      });

  if (isAsync) {
    // Async path [IR-3]: register body promise with trackInflight and return
    // control immediately. Body return value is intentionally discarded.
    // Pipe-entry value flows downstream unchanged.
    //
    // Run the body in a dedicated child context/evaluator so that
    // pipeValue and other mutable evaluator state are isolated from the
    // main pipeline. Without this, the body's await callbacks could
    // mutate `s.ctx.pipeValue` while downstream operators run,
    // producing races between fire-and-forget side effects and the
    // synchronous pipe.
    const asyncCtx = createChildContext(s.ctx);
    asyncCtx.pipeValue = pipeBefore;
    const asyncEvaluator: EvalState = getEvalState(asyncCtx);
    s.ctx.trackInflight(runBody(asyncEvaluator));
    return pipeBefore ?? '';
  }

  // Synchronous path: await body completion before returning.
  await runBody(s);

  // Restore pipe value (body execution may have mutated ctx.pipeValue).
  s.ctx.pipeValue = pipeBefore;
  // pipe-optional semantics: pass<> treats an unbound pipe (null) as ''.
  // This intentionally deviates from evaluatePass (bare `pass`), which throws
  // RILL_R005 when $ is not bound. pass<> is designed for use outside a pipe
  // chain, so returning '' is the correct fallback rather than halting.
  return pipeBefore ?? '';
}

/**
 * Evaluate string literal with interpolation.
 * Interpolation expressions are evaluated with the current pipe value preserved.
 *
 * String parts are concatenated with interpolated values formatted via formatValue().
 * Errors from interpolation expression evaluation propagate to caller.
 *
 * Returns `{ value, interpolated }` where `interpolated` is `true` iff at least one
 * part is a non-literal (interpolation expression). This flag enables callers such as
 * `evaluateError` to decide whether to wrap frames with the original literal text.
 */
export async function evaluateString(
  s: EvalState,
  node: StringLiteralNode
): Promise<{ value: string; interpolated: boolean }> {
  let result = '';
  let interpolated = false;
  // Save pipeValue since interpolation expressions can modify it
  const savedPipeValue = s.ctx.pipeValue;
  for (const part of node.parts) {
    if (typeof part === 'string') {
      result += part;
    } else {
      interpolated = true;
      // InterpolationNode: evaluate the expression
      // Restore pipeValue before each interpolation so they all see the same value
      s.ctx.pipeValue = savedPipeValue;
      const value = await evaluateExpression(s, part.expression);
      // Vector coercion guard [EC-31]
      if (isVector(value)) {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, part),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateString',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R003],
          'cannot coerce vector to string'
        );
      }
      result += formatValue(value);
    }
  }
  // Restore pipeValue after string evaluation
  s.ctx.pipeValue = savedPipeValue;
  return { value: result, interpolated };
}

/**
 * Evaluate list literal elements into a flat array.
 * Elements are evaluated in order and collected into an array.
 *
 * Errors from element evaluation propagate to caller.
 */
export async function evaluateTuple(
  s: EvalState,
  node: ListLiteralNode
): Promise<RillValue[]> {
  const elements: RillValue[] = [];
  for (const elem of node.elements) {
    if (elem.type === 'ListSpread') {
      const spreadNode = elem as ListSpreadNode;
      const spreadValue = await evaluateExpression(s, spreadNode.expression);
      if (Array.isArray(spreadValue)) {
        elements.push(...spreadValue);
      } else {
        throwCatchableHostHalt(
          {
            location: spreadNode.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateTuple',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Spread in list literal requires list, got ${typeof spreadValue}`,
          { got: typeof spreadValue }
        );
      }
    } else {
      elements.push(await evaluateExpression(s, elem));
    }
  }
  // Validate homogeneity: all elements must share the same structural type [C-1]
  inferElementType(elements);
  return elements;
}

/**
 * Evaluate multi-key dict entry from a ListLiteralNode key.
 */
export async function evaluateDictMultiKeyFromList(
  s: EvalState,
  keyList: ListLiteralNode,
  value: ExpressionNode
): Promise<Array<[string, RillValue]>> {
  // Evaluate list elements to get keys
  const keys: RillValue[] = await evaluateListLiteralElements(
    s,
    keyList.elements
  );

  // Validate non-empty [EC-4]
  if (keys.length === 0) {
    throwCatchableHostHalt(
      {
        location: keyList.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateDictMultiKeyFromList',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      'Multi-key dict entry requires non-empty list'
    );
  }

  // Validate all keys are primitives [EC-5]
  for (const key of keys) {
    const keyType = typeof key;
    if (keyType !== 'string' && keyType !== 'number' && keyType !== 'boolean') {
      throwCatchableHostHalt(
        {
          location: keyList.span?.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDictMultiKeyFromList',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Dict key must be string, number, or boolean, got ${keyType}`,
        { got: keyType }
      );
    }
  }

  // Evaluate value once
  let evaluatedValue: RillValue;
  if (isBlockExpr(value)) {
    const head = requirePipeChainHead(
      value,
      s.ctx,
      'evaluateDictMultiKeyFromList'
    );
    const blockNode = head.primary as BlockNode;
    evaluatedValue = createBlockClosure(s, blockNode);
  } else if (isClosureExpr(value)) {
    const head = requirePipeChainHead(
      value,
      s.ctx,
      'evaluateDictMultiKeyFromList'
    );
    const fnLit = head.primary as ClosureNode;
    evaluatedValue = await createClosure(s, fnLit);
  } else {
    evaluatedValue = await evaluateExpression(s, value);
  }

  // Create entry for each key
  const entries: Array<[string, RillValue]> = [];
  for (const key of keys) {
    const stringKey = String(key);
    entries.push([stringKey, evaluatedValue]);
  }

  return entries;
}

/**
 * Evaluate dict literal.
 * All callables in the dict are bound to the containing dict via boundDict property.
 *
 * Reserved method names (keys, values, entries) cannot be used as dict keys.
 * Multi-key entries (tuple keys) expand to multiple entries with shared value.
 * Errors from value evaluation propagate to caller.
 */
export async function evaluateDict(
  s: EvalState,
  node: DictNode
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};
  for (const entry of node.entries) {
    // Multi-key entries: expand to multiple key-value pairs
    if (typeof entry.key === 'object') {
      // Check for new key types (variable/computed keys)
      if ('kind' in entry.key) {
        const keyObj = entry.key as DictKeyVariable | DictKeyComputed;

        // Handle DictKeyVariable: resolve variable and validate string type
        if (keyObj.kind === 'variable') {
          const varValue = getVariable(s.ctx, keyObj.variableName);

          // EC-6: Variable undefined
          if (varValue === undefined) {
            throwCatchableHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R005],
              `Variable '${keyObj.variableName}' is undefined`
            );
          }

          // EC-7: Variable non-string
          if (typeof varValue !== 'string') {
            throwCatchableHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `Dict key must be string, got ${typeof varValue}`
            );
          }

          // Use resolved string as dict key
          const stringKey = varValue;

          if (isReservedMethod(stringKey)) {
            throwCatchableHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `Cannot use reserved method name '${stringKey}' as dict key`,
              {
                key: stringKey,
                reservedMethods: ['keys', 'values', 'entries'],
              }
            );
          }

          // Evaluate value and store with resolved key
          if (isBlockExpr(entry.value)) {
            const head = requirePipeChainHead(
              entry.value,
              s.ctx,
              'evaluateDict'
            );
            const blockNode = head.primary as BlockNode;
            const closure = createBlockClosure(s, blockNode);
            result[stringKey] = closure;
          } else if (isClosureExpr(entry.value)) {
            const head = requirePipeChainHead(
              entry.value,
              s.ctx,
              'evaluateDict'
            );
            const fnLit = head.primary as ClosureNode;
            const closure = await createClosure(s, fnLit);
            result[stringKey] = closure;
          } else {
            result[stringKey] = await evaluateExpression(s, entry.value);
          }

          continue;
        }

        // Handle DictKeyComputed: evaluate expression and validate string type
        if (keyObj.kind === 'computed') {
          // Computed dict keys are parsed inline while building a live
          // dict literal (never via the statement-level recovery
          // path), so they only ever hold PipeChainNode;
          // PartialExpressionNode is reserved for parser error recovery.
          if (!isPipeChainNode(keyObj.expression)) {
            throwFatalHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              'Computed dict key expression must be a pipe chain'
            );
          }
          const computedValue = await evaluatePipeChain(s, keyObj.expression);

          // EC-8: Computed key must evaluate to string
          if (typeof computedValue !== 'string') {
            throwCatchableHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `Dict key evaluated to ${typeof computedValue}, expected string`
            );
          }

          // Use resolved string as dict key
          const stringKey = computedValue;

          if (isReservedMethod(stringKey)) {
            throwCatchableHostHalt(
              {
                location: entry.span.start,
                sourceId: s.ctx.sourceId,
                fn: 'evaluateDict',
              },
              ERROR_ATOMS[ERROR_IDS.RILL_R002],
              `Cannot use reserved method name '${stringKey}' as dict key`,
              {
                key: stringKey,
                reservedMethods: ['keys', 'values', 'entries'],
              }
            );
          }

          // Evaluate value and store with resolved key
          if (isBlockExpr(entry.value)) {
            const head = requirePipeChainHead(
              entry.value,
              s.ctx,
              'evaluateDict'
            );
            const blockNode = head.primary as BlockNode;
            const closure = createBlockClosure(s, blockNode);
            result[stringKey] = closure;
          } else if (isClosureExpr(entry.value)) {
            const head = requirePipeChainHead(
              entry.value,
              s.ctx,
              'evaluateDict'
            );
            const fnLit = head.primary as ClosureNode;
            const closure = await createClosure(s, fnLit);
            result[stringKey] = closure;
          } else {
            result[stringKey] = await evaluateExpression(s, entry.value);
          }

          continue;
        }
      }
      // At this point, entry.key is ListLiteralNode (multi-key entry)
      const pairs = await evaluateDictMultiKeyFromList(
        s,
        entry.key as ListLiteralNode,
        entry.value
      );
      for (const [stringKey, value] of pairs) {
        if (isReservedMethod(stringKey)) {
          throwCatchableHostHalt(
            {
              location: entry.span.start,
              sourceId: s.ctx.sourceId,
              fn: 'evaluateDict',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Cannot use reserved method name '${stringKey}' as dict key`,
            {
              key: stringKey,
              reservedMethods: ['keys', 'values', 'entries'],
            }
          );
        }
        // Apply last-write-wins semantics
        result[stringKey] = value;
      }
      continue;
    }

    // Convert number and boolean keys to strings per IR-3
    // String keys: use directly as object property
    // Number keys: convert to string via String(key)
    // Boolean keys: convert to string via String(key)
    const stringKey = String(entry.key);

    if (isReservedMethod(stringKey)) {
      throwCatchableHostHalt(
        {
          location: entry.span.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDict',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Cannot use reserved method name '${stringKey}' as dict key`,
        { key: stringKey, reservedMethods: ['keys', 'values', 'entries'] }
      );
    }

    if (isBlockExpr(entry.value)) {
      const head = requirePipeChainHead(entry.value, s.ctx, 'evaluateDict');
      const blockNode = head.primary as BlockNode;
      const closure = createBlockClosure(s, blockNode);
      result[stringKey] = closure;
    } else if (isClosureExpr(entry.value)) {
      const head = requirePipeChainHead(entry.value, s.ctx, 'evaluateDict');
      const fnLit = head.primary as ClosureNode;
      const closure = await createClosure(s, fnLit);
      result[stringKey] = closure;
    } else {
      result[stringKey] = await evaluateExpression(s, entry.value);
    }
  }

  // Bind all callables to the containing dict
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (value !== undefined && isCallable(value)) {
      result[key] = {
        ...value,
        boundDict: result,
      };
    }
  }

  return result;
}

/**
 * Evaluate dict as dispatch table when piped [IR-2].
 *
 * Searches dict entries for key matching piped value using type-aware deep equality.
 * Returns matched value. Auto-invokes if matched value is closure.
 *
 * Type-aware matching ensures:
 * - Number key 1 matches only number input 1, not string "1"
 * - Boolean key true matches only boolean input true, not string "true"
 *
 * Multi-key support: [["k1", "k2"]: value] syntax allows multiple keys
 * to map to the same value. Key tuple is evaluated to get list of candidates.
 *
 * @param s - Evaluator state
 * @param node - DictNode representing dispatch table
 * @param input - Piped value to use as lookup key
 * @returns Matched value (auto-invoked if closure)
 * @throws RuntimeError with RUNTIME_PROPERTY_NOT_FOUND if no match and no default [EC-4]
 */
export async function evaluateDictDispatch(
  s: EvalState,
  node: DictNode,
  input: RillValue
): Promise<RillValue> {
  // Search entries for matching key (process in order, return first match)
  for (const entry of node.entries) {
    let matchFound = false;

    if (typeof entry.key === 'object') {
      // Check for new key types (variable/computed keys)
      if ('kind' in entry.key) {
        throwTypeHalt(
          {
            location: entry.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'dict-dispatch',
          },
          'INVALID_INPUT',
          'Variable and computed dict keys not yet supported',
          'runtime',
          undefined,
          'host'
        );
      }
      // ListLiteralNode key - evaluate to get list of candidates
      const keyValue = await evaluateListLiteralElements(
        s,
        (entry.key as ListLiteralNode).elements
      );

      // Check if input matches any element in the list (type-aware)
      for (const candidate of keyValue) {
        if (deepEquals(input, candidate)) {
          matchFound = true;
          break;
        }
      }
    } else {
      // Primitive key (string, number, or boolean) - type-aware comparison
      // deepEquals ensures number 1 != string "1", boolean true != string "true"
      matchFound = deepEquals(input, entry.key);
    }

    if (matchFound) {
      // Found match - evaluate and return the value
      const matchedValue = await evaluateExpression(s, entry.value);
      return resolveDispatchValue(s, matchedValue, input, node);
    }
  }

  // No match found - check for default value
  if (node.defaultValue) {
    return await evaluateBodyExpression(s, node.defaultValue);
  }

  // No match and no default - throw RUNTIME_PROPERTY_NOT_FOUND [EC-4]
  const location = node.span?.start;
  throwCatchableHostHalt(
    { location, sourceId: s.ctx.sourceId, fn: 'evaluateDictDispatch' },
    ERROR_ATOMS[ERROR_IDS.RILL_R009],
    `Dict dispatch: key '${formatValue(input)}' not found`,
    { key: input }
  );
}

/**
 * Evaluate list literal as dispatch table when piped.
 *
 * Takes numeric index and returns element at that position.
 * Supports negative indices and default values.
 *
 * @param s - Evaluator state
 * @param node - ListLiteralNode representing list literal
 * @param input - Piped value to use as index (must be number)
 * @returns Element at index
 * @throws RuntimeError if input not number or index out of bounds
 */
export async function evaluateListDispatch(
  s: EvalState,
  node: ListLiteralNode,
  input: RillValue
): Promise<RillValue> {
  // Validate input is an integer (EC-15)
  if (typeof input !== 'number' || !Number.isInteger(input)) {
    throwCatchableHostHalt(
      {
        location: node.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R041],
      `List dispatch requires integer index, got ${typeof input !== 'number' ? typeof input : 'non-integer number'}`,
      { input, expectedType: 'integer' }
    );
  }

  // Evaluate all elements to get the list
  const elements = await evaluateTuple(s, node);

  const index = input;

  // Normalize negative indices
  const normalizedIndex = index < 0 ? elements.length + index : index;

  // Check bounds
  if (normalizedIndex < 0 || normalizedIndex >= elements.length) {
    // Check for default value
    if (node.defaultValue) {
      return await evaluateBodyExpression(s, node.defaultValue);
    }

    // No default - throw EC-16 out-of-bounds error
    throwCatchableHostHalt(
      {
        location: node.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateListDispatch',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R042],
      `List dispatch: index ${index} out of range (length: ${elements.length})`,
      { index, listLength: elements.length }
    );
  }

  // Return element at normalized index
  return elements[normalizedIndex]!;
}

/**
 * Resolve dispatch value: auto-invoke if closure, otherwise return as-is.
 * Zero-param closures (block-closures) are invoked with args = [] and pipeValue = input.
 * Parameterized closures (1+ params) throw error.
 */
export async function resolveDispatchValue(
  s: EvalState,
  value: RillValue,
  input: RillValue,
  node: DictNode
): Promise<RillValue> {
  if (isCallable(value)) {
    // Check for parameterized closure (explicit user-defined params)
    // Note: Block-closures have exactly 1 param named '$'
    // Parameterized closures have 1+ params with user-defined names
    if (value.kind === 'script' && value.params.length >= 1) {
      // Check if first param is '$' (block-closure) or user-defined (parameterized)
      if (value.params[0]!.name !== '$') {
        // Parameterized closure at terminal position: error
        throwCatchableHostHalt(
          {
            location: node.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'resolveDispatchValue',
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
      // Application callable with params: invoke with input as argument
      // Note: Script callables with params already threw error above
      return await invokeCallable(s, value, [input], node.span?.start);
    } else {
      // Zero-param closure: invoke with args = [] and pipeValue = input
      const savedPipeValue = s.ctx.pipeValue;
      s.ctx.pipeValue = input;
      try {
        const result = await invokeCallable(s, value, [], node.span?.start);
        return result;
      } finally {
        s.ctx.pipeValue = savedPipeValue;
      }
    }
  }
  return value;
}

/**
 * Runtime dict dispatch for variables: search dict for matching key.
 * Supports multi-key entries, auto-invokes closures, handles default values.
 *
 * @param s - Evaluator state
 * @param dict - Runtime dict value
 * @param input - Key to search for
 * @param defaultValue - Optional default value expression node
 * @param location - Source location for error reporting
 * @returns Matched value or default
 */
export async function dispatchToDict(
  s: EvalState,
  dict: Record<string, RillValue>,
  input: RillValue,
  defaultValue: BodyNode | null,
  location: {
    span?: { start: SourceLocation; end: SourceLocation };
  },
  skipClosureResolution = false
): Promise<RillValue> {
  // Search dict entries for matching key
  for (const [key, value] of Object.entries(dict)) {
    // Simple key match using deep equality
    if (deepEquals(input, key)) {
      // Skip closure resolution for hierarchical dispatch (caller handles it)
      if (skipClosureResolution) {
        return value;
      }
      // Auto-invoke closures if needed
      return resolveDispatchValueRuntime(s, value, input, location);
    }
  }

  // No match found - check for default value
  if (defaultValue) {
    return await evaluateBodyExpression(s, defaultValue);
  }

  // No match and no default - throw error
  const loc = location.span?.start;
  throwCatchableHostHalt(
    { location: loc, sourceId: s.ctx.sourceId, fn: 'dispatchToDict' },
    ERROR_ATOMS[ERROR_IDS.RILL_R009],
    `Dict dispatch: key '${formatValue(input)}' not found`,
    { key: input }
  );
}

/**
 * Runtime list dispatch for variables: return element at numeric index.
 * Supports negative indices, auto-invokes closures, handles default values.
 *
 * @param s - Evaluator state
 * @param list - Runtime list value
 * @param input - Index value (must be number)
 * @param defaultValue - Optional default value expression node
 * @param location - Source location for error reporting
 * @returns Element at index or default
 */
export async function dispatchToList(
  s: EvalState,
  list: RillValue[],
  input: RillValue,
  defaultValue: BodyNode | null,
  location: {
    span?: { start: SourceLocation; end: SourceLocation };
  },
  skipClosureResolution = false
): Promise<RillValue> {
  // Validate input is number
  if (typeof input !== 'number') {
    throwCatchableHostHalt(
      {
        location: location.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'dispatchToList',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `List dispatch requires number index, got ${typeof input}`,
      { input, expectedType: 'number' }
    );
  }

  // Truncate decimal to integer
  const index = Math.trunc(input);

  // Normalize negative indices
  const normalizedIndex = index < 0 ? list.length + index : index;

  // Check bounds
  if (normalizedIndex < 0 || normalizedIndex >= list.length) {
    // Check for default value
    if (defaultValue) {
      return await evaluateBodyExpression(s, defaultValue);
    }

    // No default - throw error
    throwCatchableHostHalt(
      {
        location: location.span?.start,
        sourceId: s.ctx.sourceId,
        fn: 'dispatchToList',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R009],
      `List dispatch: index '${index}' not found`,
      { index, listLength: list.length }
    );
  }

  // Return element at normalized index
  const element = list[normalizedIndex]!;
  // Skip closure resolution for hierarchical dispatch (caller handles it)
  if (skipClosureResolution) {
    return element;
  }
  // Auto-invoke closures if needed
  return resolveDispatchValueRuntime(s, element, input, location);
}

/**
 * Resolve dispatch value for runtime values: auto-invoke if closure.
 * Similar to resolveDispatchValue but works with runtime values.
 */
export async function resolveDispatchValueRuntime(
  s: EvalState,
  value: RillValue,
  input: RillValue,
  location: {
    span?: { start: SourceLocation; end: SourceLocation };
  }
): Promise<RillValue> {
  if (isCallable(value)) {
    // Check if callable has params to determine invocation style
    const hasParams =
      (value.kind === 'script' && value.params.length > 0) ||
      (value.kind === 'application' &&
        value.params !== undefined &&
        value.params.length > 0);

    if (hasParams) {
      // Block-closure: invoke with input as argument
      return await invokeCallable(s, value, [input], location.span?.start);
    } else {
      // Zero-param closure: invoke with args = [] and pipeValue = input
      const savedPipeValue = s.ctx.pipeValue;
      s.ctx.pipeValue = input;
      try {
        const result = await invokeCallable(s, value, [], location.span?.start);
        return result;
      } finally {
        s.ctx.pipeValue = savedPipeValue;
      }
    }
  }
  return value;
}

/**
 * Create a script callable from a closure node.
 * Closures use late binding - variables are resolved in definingScope when invoked.
 *
 * Default parameter values are evaluated immediately in the current context.
 * Property-style callables (zero params) are auto-invoked on dict access.
 */
export async function createClosure(
  s: EvalState,
  node: ClosureNode
): Promise<ScriptCallable> {
  // Store reference to the defining scope for late-bound variable resolution
  const definingScope = s.ctx;

  // Capture annotations at closure creation time
  const { annotations } = await captureClosureAnnotations(s.ctx);

  const rillParams: RillParam[] = [];
  for (const param of node.params) {
    let defaultValue: RillValue | undefined = undefined;
    if (param.defaultValue) {
      defaultValue = await evaluatePrimary(s, param.defaultValue);
    }

    // Resolve typeRef at closure-creation time (AC-12).
    // Dynamic refs ($var) are resolved against the current context now,
    // so the closure captures the concrete type, not the variable reference.
    let resolvedType: TypeStructure | undefined = undefined;
    if (param.typeRef !== null) {
      const resolved = await resolveTypeRef(s, param.typeRef, (name: string) =>
        getVariable(s.ctx, name)
      );
      if (!isTypeValue(resolved)) {
        throwTypeHalt(
          {
            sourceId: s.ctx.sourceId,
            fn: 'closure-param',
          },
          'TYPE_MISMATCH',
          `Closure parameter '${param.name}' type must be a type value, not a shape`,
          'runtime',
          { paramName: param.name }
        );
      }
      resolvedType = resolved.structure;
    }

    // Infer type from default value when no explicit typeRef is present (AC-12).
    // Primitive defaults (string, number, bool) constrain the parameter type.
    // Complex defaults (list, dict, closure) leave the parameter any-typed.
    if (resolvedType === undefined && defaultValue !== undefined) {
      const defaultKind = typeof defaultValue;
      if (defaultKind === 'string') {
        resolvedType = { kind: 'string' };
      } else if (defaultKind === 'number') {
        resolvedType = { kind: 'number' };
      } else if (defaultKind === 'boolean') {
        resolvedType = { kind: 'bool' };
      }
    }

    // Evaluate per-param annotations inline
    let paramAnnots: Record<string, RillValue> = {};
    if (param.annotations && param.annotations.length > 0) {
      paramAnnots = await evaluateAnnotations(param.annotations, (expr) =>
        evaluateExpression(s, expr)
      );
    }

    rillParams.push({
      name: param.name,
      type: resolvedType,
      defaultValue,
      annotations: paramAnnots,
    });
  }

  const isProperty = rillParams.length === 0;

  // Evaluate returnTypeTarget at closure creation time (IR-4).
  // TypeConstructorNode → resolve via evaluateTypeConstructor() (e.g., stream(T):R).
  // TypeRef → resolve via resolveTypeRef() — returns RillTypeValue.
  // Absent → returnType defaults to anyTypeValue (omission implies :any, AC-17, AC-18, AC-19).
  let returnType = anyTypeValue;
  if (node.returnTypeTarget !== undefined) {
    if (
      'type' in node.returnTypeTarget &&
      node.returnTypeTarget.type === 'TypeConstructor'
    ) {
      returnType = await evaluateTypeConstructor(s, node.returnTypeTarget);
    } else {
      returnType = await resolveTypeRef(
        s,
        node.returnTypeTarget as TypeRef,
        (name: string) => getVariable(s.ctx, name)
      );
    }
  }

  return {
    __type: 'callable',
    kind: 'script',
    params: rillParams,
    body: node.body,
    definingScope,
    isProperty,
    annotations,
    returnType,
  };
}

/**
 * Create a script callable from a block node in expression position.
 * Block-closures have a single implicit $ parameter representing the piped value.
 *
 * No default parameter evaluation since the implicit $ has no default.
 * isProperty is always false (block-closures require $).
 */
export function createBlockClosure(
  s: EvalState,
  node: BlockNode
): ScriptCallable {
  // Store reference to the defining scope for late-bound variable resolution
  const definingScope = s.ctx;

  // Block-closures have exactly one parameter: $
  // type is undefined (any-typed) so paramsToStructuralType produces { type: 'any' },
  // matching the structural type of an explicit `|any|{}` closure.
  const rillParams: readonly RillParam[] = [
    {
      name: '$',
      type: undefined,
      defaultValue: undefined,
      annotations: {},
    },
  ];

  const annotations = s.ctx.immediateAnnotation ?? {};
  s.ctx.immediateAnnotation = undefined;

  return {
    __type: 'callable',
    kind: 'script',
    params: rillParams,
    body: node,
    definingScope,
    isProperty: false,
    annotations,
    returnType: anyTypeValue,
  };
}

/**
 * Helper: Check if expression is a bare closure (no pipes, no methods).
 * Used to detect dict entries that should be treated as closures.
 */
export function isClosureExpr(expr: ExpressionNode): boolean {
  if (!isPipeChainNode(expr)) return false;
  if (expr.pipes.length > 0) return false;
  if (expr.head.type !== 'PostfixExpr') return false;
  const head = expr.head as PostfixExprNode;
  if (head.methods.length > 0) return false;
  return head.primary.type === 'Closure';
}

/**
 * Helper: Check if expression is a bare block (no pipes, no methods).
 * Used to detect dict entries that should be treated as block closures.
 */
export function isBlockExpr(expr: ExpressionNode): boolean {
  if (!isPipeChainNode(expr)) return false;
  if (expr.pipes.length > 0) return false;
  if (expr.head.type !== 'PostfixExpr') return false;
  const head = expr.head as PostfixExprNode;
  if (head.methods.length > 0) return false;
  return head.primary.type === 'Block';
}

/**
 * LiteralsMixin implementation.
 *
 * Provides evaluation of literal values. Pass returns the current pipe value,
 * string literals support interpolation, closures are created with late binding,
 * and dict callables are automatically bound to their containing dict.
 *
 * Depends on:
 * - EvaluatorBase: ctx, checkAborted(), getNodeLocation()
 * - evaluateExpression() (from future CoreMixin composition)
 * - evaluatePrimary() (from future CoreMixin composition)
 *
 * Methods added:
 * - evaluatePass(node) -> Promise<RillValue>
 * - evaluateString(node) -> Promise<{ value: string; interpolated: boolean }>
 * - evaluateTuple(node) -> Promise<RillValue[]>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 */
export function LiteralsMixin<
  TBase extends EvaluatorConstructor<EvaluatorBase>,
>(Base: TBase) {
  return class LiteralsEvaluator extends Base {
    evaluatePass(node: PassNode): Promise<RillValue> {
      return evaluatePass(this as unknown as EvalState, node);
    }

    evaluatePassBlock(node: PassBlockNode): Promise<RillValue> {
      return evaluatePassBlock(this as unknown as EvalState, node);
    }

    evaluateString(
      node: StringLiteralNode
    ): Promise<{ value: string; interpolated: boolean }> {
      return evaluateString(this as unknown as EvalState, node);
    }

    evaluateTuple(node: ListLiteralNode): Promise<RillValue[]> {
      return evaluateTuple(this as unknown as EvalState, node);
    }

    evaluateDictMultiKeyFromList(
      keyList: ListLiteralNode,
      value: ExpressionNode
    ): Promise<Array<[string, RillValue]>> {
      return evaluateDictMultiKeyFromList(
        this as unknown as EvalState,
        keyList,
        value
      );
    }

    evaluateDict(node: DictNode): Promise<Record<string, RillValue>> {
      return evaluateDict(this as unknown as EvalState, node);
    }

    evaluateDictDispatch(node: DictNode, input: RillValue): Promise<RillValue> {
      return evaluateDictDispatch(this as unknown as EvalState, node, input);
    }

    evaluateListDispatch(
      node: ListLiteralNode,
      input: RillValue
    ): Promise<RillValue> {
      return evaluateListDispatch(this as unknown as EvalState, node, input);
    }

    resolveDispatchValue(
      value: RillValue,
      input: RillValue,
      node: DictNode
    ): Promise<RillValue> {
      return resolveDispatchValue(
        this as unknown as EvalState,
        value,
        input,
        node
      );
    }

    dispatchToDict(
      dict: Record<string, RillValue>,
      input: RillValue,
      defaultValue: BodyNode | null,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      },
      skipClosureResolution = false
    ): Promise<RillValue> {
      return dispatchToDict(
        this as unknown as EvalState,
        dict,
        input,
        defaultValue,
        location,
        skipClosureResolution
      );
    }

    dispatchToList(
      list: RillValue[],
      input: RillValue,
      defaultValue: BodyNode | null,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      },
      skipClosureResolution = false
    ): Promise<RillValue> {
      return dispatchToList(
        this as unknown as EvalState,
        list,
        input,
        defaultValue,
        location,
        skipClosureResolution
      );
    }

    resolveDispatchValueRuntime(
      value: RillValue,
      input: RillValue,
      location: {
        span?: { start: SourceLocation; end: SourceLocation };
      }
    ): Promise<RillValue> {
      return resolveDispatchValueRuntime(
        this as unknown as EvalState,
        value,
        input,
        location
      );
    }

    createClosure(node: ClosureNode): Promise<ScriptCallable> {
      return createClosure(this as unknown as EvalState, node);
    }

    createBlockClosure(node: BlockNode): ScriptCallable {
      return createBlockClosure(this as unknown as EvalState, node);
    }

    isClosureExpr(expr: ExpressionNode): boolean {
      return isClosureExpr(expr);
    }

    isBlockExpr(expr: ExpressionNode): boolean {
      return isBlockExpr(expr);
    }
  };
}

/**
 * Capability fragment: methods contributed by LiteralsMixin that are called
 * from core.ts cast sites. Covers only the methods core.ts invokes.
 */
export type LiteralsMixinCapability = {
  evaluateString(
    node: StringLiteralNode
  ): Promise<{ value: string; interpolated: boolean }>;
  evaluateDict(node: DictNode): Promise<Record<string, RillValue>>;
  createClosure(node: ClosureNode): Promise<ScriptCallable>;
  createBlockClosure(node: BlockNode): ScriptCallable;
  evaluatePass(node: PassNode): Promise<RillValue>;
  evaluatePassBlock(node: PassBlockNode): Promise<RillValue>;
  evaluateDictDispatch(node: DictNode, input: RillValue): Promise<RillValue>;
  dispatchToDict(
    dict: Record<string, RillValue>,
    input: RillValue,
    defaultValue: BodyNode | null,
    location: { span?: { start: SourceLocation; end: SourceLocation } },
    skipClosureResolution?: boolean
  ): Promise<RillValue>;
  dispatchToList(
    list: RillValue[],
    input: RillValue,
    defaultValue: BodyNode | null,
    location: { span?: { start: SourceLocation; end: SourceLocation } },
    skipClosureResolution?: boolean
  ): Promise<RillValue>;
};
