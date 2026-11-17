/**
 * String, Tuple, Dict, Closure, and Pass Evaluation
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
 * - evaluatePass(node) -> Promise<RillValue>
 * - evaluateString(node) -> Promise<{ value: string; interpolated: boolean }>
 * - evaluateDict(node) -> Promise<Record<string, RillValue>>
 * - createClosure(node) -> Promise<ScriptCallable>
 * - createBlockClosure(node) -> ScriptCallable
 *
 * Error Handling:
 * - Pass halts with RILL-R005 if $ not bound
 * - String interpolation errors propagate from evaluateExpression()
 * - Dict/tuple evaluation errors propagate from nested expressions
 *
 * @internal
 */

import type {
  StringLiteralNode,
  ListLiteralNode,
  DictNode,
  ClosureNode,
  BlockNode,
  PipeChainNode,
  PostfixExprNode,
  ExpressionNode,
  SourceLocation,
  AnnotationArg,
  PassNode,
  PassBlockNode,
} from '../../../../types.js';
import { isPipeChainNode } from '../../../../types.js';
import type { TypeStructure, RillValue } from '../../types/structures.js';
import {
  deepEquals,
  formatValue,
  inferType,
} from '../../types/registrations.js';
import { isTypeValue } from '../../types/guards.js';
import {
  anyTypeValue,
  isReservedBrandKey,
  isReservedMethod,
  RESERVED_DICT_METHODS,
} from '../../values.js';
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
import { isAtom, isOrdered, orderedValueEntries } from '../../types/guards.js';
import { isDict } from '../../callable.js';
import type { EvalState } from '../state.js';
import type { RuntimeContext } from '../../types/runtime.js';
import {
  createChildContext,
  getVariable,
  markDeferredHalt,
} from '../../context.js';
import { getEvalState } from '../state.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import { getNodeLocation, setDictField, withChildScope } from '../shared.js';
import { orderedDictEntries } from '../../types/dict-keys.js';
import {
  evaluateExpression,
  evaluatePipeChain,
  evaluatePrimary,
} from './core.js';
import {
  invokeSelected,
  rejectParameterizedClosure,
} from './element-dispatch.js';
import { accessHaltGateFast } from './access.js';
import { describeNoStringForm } from './conversion.js';
import { copyExtensionIdentity } from '../../policy/identity.js';
import { evaluateBody, evaluateBodyExpression } from './control-flow.js';
import { assertUsableAnnotationKey } from './annotations.js';
import { resolveTypeRef, evaluateTypeConstructor } from './types.js';
import { evaluateListLiteralElements } from './extraction.js';
import { dictSelectorKey } from './field-access.js';

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
function captureClosureAnnotations(ctx: RuntimeContext): Promise<{
  annotations: Record<string, RillValue>;
}> {
  // Capture closure-level annotations from immediateAnnotation field.
  // When a closure is created within a directly-annotated statement like:
  // ^(doc: "test") |x|($x * 2) :> $fn
  // immediateAnnotation holds the evaluated annotations set by executeAnnotatedStatement.
  // Consumed once: cleared after capture to prevent unintended re-use.
  const annotations: Record<string, RillValue> = ctx.immediateAnnotation ?? {};
  ctx.immediateAnnotation = undefined;

  return Promise.resolve({ annotations });
}

/**
 * Evaluate annotation arguments to a dict of key-value pairs.
 * Handles both named arguments and spread arguments.
 *
 * @param annotations - Annotation arguments from AST
 * @param evalExpr - Expression evaluator function
 * @param sourceId - Source identifier for error reporting
 * @returns Record of annotation key-value pairs
 *
 * @internal
 */
export async function evaluateAnnotations(
  annotations: AnnotationArg[],
  evalExpr: (expr: ExpressionNode) => Promise<RillValue>,
  sourceId?: string
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};

  for (const arg of annotations) {
    if (arg.type === 'NamedArg') {
      const namedArg = arg;
      assertUsableAnnotationKey(namedArg.name, namedArg.span.start, sourceId);
      setDictField(result, namedArg.name, await evalExpr(namedArg.value));
    } else {
      // SpreadArg: spread tuple/dict keys as annotations
      const spreadArg = arg;
      const spreadValue = await evalExpr(spreadArg.expression);

      if (
        typeof spreadValue === 'object' &&
        spreadValue !== null &&
        !Array.isArray(spreadValue) &&
        !isCallable(spreadValue)
      ) {
        // Dict: spread all key-value pairs
        for (const [k, v] of Object.entries(spreadValue)) {
          assertUsableAnnotationKey(k, spreadArg.span.start, sourceId);
          setDictField(result, k, v);
        }
      } else if (Array.isArray(spreadValue)) {
        // Tuple/list: not valid for annotations (need named keys)
        throwCatchableHostHalt(
          {
            location: spreadArg.span.start,
            sourceId,
            fn: 'evaluateAnnotations',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          'Annotation spread requires dict with named keys, got list'
        );
      } else {
        throwCatchableHostHalt(
          {
            location: spreadArg.span.start,
            sourceId,
            fn: 'evaluateAnnotations',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Annotation spread requires dict, got ${typeof spreadValue}`
        );
      }
    }
  }

  return result;
}

/**
 * Evaluate pass node - returns current pipe value unchanged.
 *
 * Pass returns ctx.pipeValue. If $ not bound (pipeValue is null),
 * halts with RILL-R005.
 *
 * @param s - Evaluator state
 * @param node - PassNode from AST
 * @returns Current pipe value
 * @throws RuntimeHaltSignal (catchable, RILL-R005) if $ not bound
 */
// oxlint-disable-next-line require-await -- the unbound-pipe guard halts synchronously; the async boundary turns it into a rejection
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
 * Evaluate pass block node — non-halting side-effect.
 *
 * Runs `body` in the current context. Reads `on_error` from `options`;
 * when it equals `#IGNORE`, catchable halts from the body are suppressed
 * and the original pipe value is returned unchanged.
 *
 * When `async: true` is present in options, the body is dispatched via
 * `trackInflight` without awaiting (fire-and-forget). The pipe-entry value
 * flows downstream immediately; the body return value is discarded.
 * `on_error: #IGNORE` composes with `async: true`: the registered promise
 * suppresses catchable body halts when both options are set.
 *
 * Without `on_error: #IGNORE`, a body halt in the async path is not
 * awaited by any caller, so it is tagged (`markDeferredHalt`) before it
 * reaches `trackInflight` and surfaces at `dispose()` time via the log
 * callbacks rather than being swallowed. Non-catchable `error`/`assert`
 * halts always surface this way.
 *
 * Non-catchable halts (`catchable: false`) and `ControlSignal` instances
 * are always re-thrown.
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
    onErrorValue.atom.name === 'IGNORE';

  // Read async option. Parser enforces BoolLiteral; runtime defends
  // against non-bool at evaluation time [RILL_R003].
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
      .then(() => {})
      .catch((e: unknown) => {
        // ControlSignal always re-throws.
        if (e instanceof ControlSignal) throw e;
        // Non-catchable halts always re-throw.
        if (e instanceof RuntimeHaltSignal && !e.catchable) throw e;
        // Catchable halt: suppress only when on_error: #IGNORE.
        if (e instanceof RuntimeHaltSignal && suppress) {
          // Suppressed — body error discarded.
          return;
        }
        throw e;
      });

  if (isAsync) {
    // Async path: register body promise with trackInflight and return
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
    // Fire-and-forget: nobody awaits this promise, so a body halt would
    // otherwise be swallowed by trackInflight. Tag any non-suppressed
    // rejection (catchable halt without on_error: #IGNORE, or any
    // non-catchable error/assert halt) so dispose() surfaces it via the
    // log callbacks — as documented for pass<async: true>. Suppressed
    // halts (on_error: #IGNORE) resolve in runBody and never reject, so
    // they are correctly never surfaced.
    const surfacing = runBody(asyncEvaluator).catch((e: unknown): never => {
      throw markDeferredHalt(e);
    });
    s.ctx.trackInflight(surfacing);
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
 * A function or iterator nested at any depth in an interpolated value halts
 * with RILL-R036.
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
  for (const part of node.parts) {
    if (typeof part === 'string') {
      result += part;
    } else {
      interpolated = true;
      // Each interpolation runs in its own child scope, so a capture inside
      // one part is not visible to later parts or to the code after the string.
      const raw = await withChildScope(s, createChildContext(s.ctx), () =>
        evaluateExpression(s, part.expression)
      );
      const value = accessHaltGateFast(
        raw,
        'evaluateString',
        () => getNodeLocation(s, part),
        s.ctx.sourceId
      );
      // A function, iterator, or vector at any depth has no printed form.
      const noStringForm = describeNoStringForm(value, 'print');
      if (noStringForm) {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, part),
            sourceId: s.ctx.sourceId,
            fn: 'evaluateString',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R036],
          noStringForm.message,
          noStringForm.raw
        );
      }
      result += formatValue(value);
    }
  }
  return { value: result, interpolated };
}

/**
 * Evaluate a dict entry value: a block or closure literal becomes a closure,
 * any other expression is evaluated. The result passes the invalid-value gate
 * so a collection never stores an invalid value.
 */
async function evaluateDictEntryValue(
  s: EvalState,
  valueNode: ExpressionNode
): Promise<RillValue> {
  let value: RillValue;
  if (isBlockExpr(valueNode)) {
    value = createBlockClosure(s, valueNode.head.primary);
  } else if (isClosureExpr(valueNode)) {
    value = await createClosure(s, valueNode.head.primary);
  } else {
    value = await evaluateExpression(s, valueNode);
  }
  return accessHaltGateFast(
    value,
    'evaluateDict',
    () => valueNode.span?.start,
    s.ctx.sourceId
  );
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

  // Validate non-empty
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

  // Every listed key must be a string: a number or bool is ambiguous
  // (`0.50` evaluates to 0.5), so the key is spelled as a string.
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key === 'string') {
      stringKeys.push(key);
    } else {
      const keyType = inferType(key);
      throwCatchableHostHalt(
        {
          location: keyList.span?.start,
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDictMultiKeyFromList',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Multi-key dict entry keys must be string, got ${keyType}; quote the key`,
        { got: keyType }
      );
    }
  }

  // Evaluate value once
  const evaluatedValue = await evaluateDictEntryValue(s, value);

  // Create entry for each key
  const entries: Array<[string, RillValue]> = [];
  for (const key of stringKeys) {
    entries.push([key, evaluatedValue]);
  }

  return entries;
}

/**
 * Halt unless a variable-supplied dict key resolved to a string. Shared by
 * dict and ordered literals so both emit the same message.
 */
export function assertStringVariableKey(
  s: EvalState,
  value: RillValue,
  span: { readonly start: SourceLocation },
  fn: string
): asserts value is string {
  if (typeof value !== 'string') {
    throwCatchableHostHalt(
      { location: span.start, sourceId: s.ctx.sourceId, fn },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Dict key must be string, got ${typeof value}`
    );
  }
}

/**
 * Halt unless a computed dict key evaluated to a string. Shared by dict and
 * ordered literals so both emit the same message.
 */
export function assertStringComputedKey(
  s: EvalState,
  value: RillValue,
  span: { readonly start: SourceLocation },
  fn: string
): asserts value is string {
  if (typeof value !== 'string') {
    throwCatchableHostHalt(
      { location: span.start, sourceId: s.ctx.sourceId, fn },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Dict key evaluated to ${typeof value}, expected string`
    );
  }
}

/**
 * Reject dict keys that collide with reserved method names (len, first,
 * empty, eq, ne, keys, values, entries) or reserved brand keys used
 * internally to discriminate runtime value shapes (__type, __rill_atom,
 * __rill_tuple, etc.). Halts catchably when the key is unusable; a no-op
 * otherwise.
 */
export function assertUsableDictKey(
  s: EvalState,
  stringKey: string,
  span: { readonly start: SourceLocation }
): void {
  if (isReservedMethod(stringKey)) {
    throwCatchableHostHalt(
      {
        location: span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateDict',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot use reserved method name '${stringKey}' as dict key`,
      {
        key: stringKey,
        reservedMethods: [...RESERVED_DICT_METHODS],
      }
    );
  }

  if (isReservedBrandKey(stringKey)) {
    throwCatchableHostHalt(
      {
        location: span.start,
        sourceId: s.ctx.sourceId,
        fn: 'evaluateDict',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Cannot use reserved brand key '${stringKey}' as dict key`
    );
  }
}

/**
 * Evaluate dict literal.
 * All callables in the dict are bound to the containing dict via boundDict property.
 *
 * Reserved method names (len, first, empty, eq, ne, keys, values, entries)
 * cannot be used as dict keys.
 * Multi-key entries (tuple keys) expand to multiple entries with shared value.
 * Errors from value evaluation propagate to caller.
 */
export async function evaluateDict(
  s: EvalState,
  node: DictNode
): Promise<Record<string, RillValue>> {
  const result: Record<string, RillValue> = {};
  for (const entry of node.entries) {
    // Spread entry: the parser encodes `...$expr` as a DictEntry whose key is
    // the literal '...' marker with no keyForm (a real `["...": x]` string key
    // always carries keyForm, so the two cannot collide). A later key with the
    // same name overrides the spread value in place.
    if (entry.key === '...' && entry.keyForm === undefined) {
      const spreadValue = accessHaltGateFast(
        await evaluateExpression(s, entry.value),
        'evaluateDict',
        () => entry.span.start,
        s.ctx.sourceId
      );
      const pairs: [string, RillValue][] = [];
      if (isOrdered(spreadValue)) {
        for (const pair of orderedValueEntries(spreadValue)) {
          pairs.push(pair);
        }
      } else if (isDict(spreadValue)) {
        for (const { key, value } of orderedDictEntries(spreadValue)) {
          pairs.push([key, value]);
        }
      } else {
        throwCatchableHostHalt(
          {
            location: entry.span.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateDict',
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          `Spread in dict literal requires dict or ordered, got ${inferType(spreadValue)}`,
          { got: inferType(spreadValue) }
        );
      }
      for (const [k, rawValue] of pairs) {
        const v = accessHaltGateFast(
          rawValue,
          'evaluateDict',
          () => entry.span.start,
          s.ctx.sourceId
        );
        assertUsableDictKey(s, k, entry.span);
        setDictField(result, k, v);
      }
      continue;
    }

    // Multi-key entries: expand to multiple key-value pairs
    if (typeof entry.key === 'object') {
      // Check for new key types (variable/computed keys)
      if ('kind' in entry.key) {
        const keyObj = entry.key;

        // Handle DictKeyVariable: resolve variable and validate string type
        if (keyObj.kind === 'variable') {
          const varValue = getVariable(s.ctx, keyObj.variableName);

          // Variable undefined
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

          // Variable non-string
          assertStringVariableKey(s, varValue, entry.span, 'evaluateDict');

          // Use resolved string as dict key
          const stringKey = varValue;

          assertUsableDictKey(s, stringKey, entry.span);

          // Evaluate value and store with resolved key
          setDictField(
            result,
            stringKey,
            await evaluateDictEntryValue(s, entry.value)
          );

          continue;
        }

        // Remaining kind is DictKeyComputed: evaluate expression and validate string type
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

        // Computed key must evaluate to string
        assertStringComputedKey(s, computedValue, entry.span, 'evaluateDict');

        // Use resolved string as dict key
        const stringKey = computedValue;

        assertUsableDictKey(s, stringKey, entry.span);

        // Evaluate value and store with resolved key
        setDictField(
          result,
          stringKey,
          await evaluateDictEntryValue(s, entry.value)
        );

        continue;
      }
      // At this point, entry.key is ListLiteralNode (multi-key entry)
      const pairs = await evaluateDictMultiKeyFromList(
        s,
        entry.key,
        entry.value
      );
      for (const [key, value] of pairs) {
        assertUsableDictKey(s, key, entry.span);
        // Apply last-write-wins semantics
        setDictField(result, key, value);
      }
      continue;
    }

    const storeKey = String(entry.key);
    assertUsableDictKey(s, storeKey, entry.span);
    setDictField(
      result,
      storeKey,
      await evaluateDictEntryValue(s, entry.value)
    );
  }

  // Bind all callables to the containing dict. Use setDictField so a field
  // literally named `__proto__` is rewritten as an own property rather than
  // reparenting the dict via the prototype setter.
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (value !== undefined && isCallable(value)) {
      const bound = { ...value, boundDict: result };
      copyExtensionIdentity(value, bound);
      setDictField(result, key, bound);
    }
  }

  return result;
}

/**
 * Evaluate dict as dispatch table when piped.
 *
 * Searches dict entries for a key matching the piped value. Dict keys are
 * strings, so a non-string input halts #TYPE_MISMATCH.
 * Returns matched value. Auto-invokes if matched value is closure.
 *
 * Multi-key support: [["k1", "k2"]: value] syntax allows multiple keys
 * to map to the same value. Key tuple is evaluated to get list of candidates.
 *
 * @param s - Evaluator state
 * @param node - DictNode representing dispatch table
 * @param input - Piped value to use as lookup key
 * @returns Matched value (auto-invoked if closure)
 * @throws RuntimeHaltSignal if no match and no default
 */
export async function evaluateDictDispatch(
  s: EvalState,
  node: DictNode,
  input: RillValue
): Promise<RillValue> {
  // A non-string selector halts before any lookup, so the default cannot mask it.
  dictSelectorKey(input, {
    location: node.span?.start,
    sourceId: s.ctx.sourceId,
    fn: 'evaluateDictDispatch',
  });
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
            fn: 'evaluateDictDispatch',
          },
          'INVALID_INPUT',
          'Variable and computed dict keys not yet supported',
          'runtime',
          undefined,
          'host'
        );
      }
      // ListLiteralNode key - evaluate to get list of candidates
      const keyValue = await evaluateListLiteralElements(s, entry.key.elements);

      // Every listed key must be a string, as in a dict literal. Validate the
      // whole list before matching so the halt does not depend on the input.
      for (const candidate of keyValue) {
        if (typeof candidate !== 'string') {
          const keyType = inferType(candidate);
          throwCatchableHostHalt(
            {
              location: entry.span.start,
              sourceId: s.ctx.sourceId,
              fn: 'evaluateDictDispatch',
            },
            ERROR_ATOMS[ERROR_IDS.RILL_R002],
            `Multi-key dict entry keys must be string, got ${keyType}; quote the key`,
            { got: keyType }
          );
        }
      }
      matchFound = keyValue.some((candidate) => deepEquals(input, candidate));
    } else {
      // Spelled key, always a string after parsing
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

  // No match and no default - halt with RILL-R009 (key not found)
  const location = node.span?.start;
  return throwCatchableHostHalt(
    { location, sourceId: s.ctx.sourceId, fn: 'evaluateDictDispatch' },
    ERROR_ATOMS[ERROR_IDS.RILL_R009],
    `Dict dispatch: key '${formatValue(input)}' not found`,
    { key: input }
  );
}

/**
 * Resolve dispatch value: auto-invoke if closure, otherwise return as-is.
 * Zero-param closures (block-closures) are invoked with args = [] and pipeValue = input.
 * Parameterized closures (1+ params) throw error.
 */
async function resolveDispatchValue(
  s: EvalState,
  value: RillValue,
  input: RillValue,
  node: DictNode
): Promise<RillValue> {
  if (!isCallable(value)) return value;
  const location = node.span?.start;
  rejectParameterizedClosure(s, value, location, 'resolveDispatchValue');
  return await invokeSelected(s, value, input, location);
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

    // Resolve typeRef at closure-creation time.
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

    // Infer type from default value when no explicit typeRef is present.
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
      paramAnnots = await evaluateAnnotations(
        param.annotations,
        (expr) => evaluateExpression(s, expr),
        s.ctx.sourceId
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

  // Evaluate returnTypeTarget at closure creation time.
  // TypeConstructorNode → resolve via evaluateTypeConstructor() (e.g., stream(T):R).
  // TypeRef → resolve via resolveTypeRef() — returns RillTypeValue.
  // Absent → returnType defaults to anyTypeValue (omission implies :any).
  let returnType = anyTypeValue;
  if (node.returnTypeTarget !== undefined) {
    if ('type' in node.returnTypeTarget) {
      returnType = await evaluateTypeConstructor(s, node.returnTypeTarget);
    } else {
      returnType = await resolveTypeRef(
        s,
        node.returnTypeTarget,
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
function isClosureExpr(expr: ExpressionNode): expr is BareClosureExpr {
  if (!isPipeChainNode(expr)) return false;
  if (expr.pipes.length > 0) return false;
  if (expr.head.type !== 'PostfixExpr') return false;
  const head = expr.head;
  if (head.methods.length > 0) return false;
  return head.primary.type === 'Closure';
}

/** Pipe chain whose head is a bare block: no pipes, no methods. */
type BareBlockExpr = PipeChainNode & {
  readonly head: PostfixExprNode & { readonly primary: BlockNode };
};

/** Pipe chain whose head is a bare closure: no pipes, no methods. */
type BareClosureExpr = PipeChainNode & {
  readonly head: PostfixExprNode & { readonly primary: ClosureNode };
};

/**
 * Helper: Check if expression is a bare block (no pipes, no methods).
 * Used to detect dict entries that should be treated as block closures.
 */
function isBlockExpr(expr: ExpressionNode): expr is BareBlockExpr {
  if (!isPipeChainNode(expr)) return false;
  if (expr.pipes.length > 0) return false;
  if (expr.head.type !== 'PostfixExpr') return false;
  const head = expr.head;
  if (head.methods.length > 0) return false;
  return head.primary.type === 'Block';
}
