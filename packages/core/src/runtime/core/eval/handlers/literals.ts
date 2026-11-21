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
 * - evaluateArgument(node) -> Promise<Carried>
 * - evaluateEntryValue(node) -> Promise<RillValue>
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
  MapLiteralNode,
  DictNode,
  ClosureNode,
  BlockNode,
  PipeChainNode,
  ExpressionNode,
  SourceLocation,
  PassNode,
  PassBlockNode,
  ASTNode,
  AnnotationArg,
  BodyNode,
  TypeRef,
} from '../../../../types.js';
import {
  codeBlockShape,
  isPipeChainNode,
  unnamedParamsRead,
} from '../../../../types.js';
import type { Carried } from '../../types/declared.js';
import type {
  RillMapKey,
  RillTypeValue,
  RillValue,
  TypeStructure,
} from '../../types/structures.js';
import {
  deepEquals,
  formatValue,
  inferType,
} from '../../types/registrations.js';
import { isStructureKind } from '../../types/guards.js';
import { fieldDefsToParams } from '../../types/fn-params.js';
import {
  anyTypeValue,
  isReservedBrandKey,
  isReservedMethod,
  RESERVED_DICT_METHODS,
  structureToTypeValue,
} from '../../values.js';
import {
  isPropertyCallable,
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
import {
  isAtom,
  isMapKey,
  isOrdered,
  orderedValueEntries,
} from '../../types/guards.js';
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
import { createMapKeyChecker, freezeMap } from '../../types/constructors.js';
import {
  evaluateExpression,
  evaluateExpressionCarried,
  evaluatePipeChain,
} from './core.js';
import { evaluateAnnotations } from './annotations.js';
import { invokeCallable } from './closures.js';
import { resolveSelected } from './code-block.js';
import { rejectHeldEntries } from '../../types/held-block.js';
import { accessHaltGateFast } from './access.js';
import { describeNoStringForm } from './conversion.js';
import { evaluateBody, evaluateBodyExpression } from './control-flow.js';
import { resolveTypeRef } from './types.js';
import { evaluateListLiteralElements } from './extraction.js';
import { dictSelectorKey, throwUndefinedDictKey } from './field-access.js';

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
  // ^(doc: "test") fn(x) { $x * 2 } => $fn
  // immediateAnnotation holds the evaluated annotations set by executeAnnotatedStatement.
  // Consumed once: cleared after capture to prevent unintended re-use.
  const annotations: Record<string, RillValue> = ctx.immediateAnnotation ?? {};
  ctx.immediateAnnotation = undefined;

  return Promise.resolve({ annotations });
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
      rejectHeldEntries(
        value,
        'string interpolation',
        {
          location: getNodeLocation(s, part),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateString',
        },
        'deep'
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
 * Evaluate one non-spread entry of a dict, list, tuple or ordered literal.
 * A code block entry is held uncalled, with the annotations written on it; any
 * other expression, a function literal included, is evaluated. The result
 * passes the invalid-value gate so a collection never stores an invalid value.
 */
export async function evaluateEntryValue(
  s: EvalState,
  valueNode: ExpressionNode,
  fn = 'evaluateDict'
): Promise<RillValue> {
  const value =
    isPipeChainNode(valueNode) && codeBlockShape(valueNode) !== undefined
      ? await createHeldBlock(s, valueNode)
      : await evaluateExpression(s, valueNode);
  return accessHaltGateFast(
    value,
    fn,
    () => valueNode.span?.start,
    s.ctx.sourceId
  );
}

/**
 * Create the held block for a code block entry. It has no params, runs the
 * whole entry body in the scope where it was written, and carries the held
 * brand. Annotations written on the entry attach to it.
 */
async function createHeldBlock(
  s: EvalState,
  body: PipeChainNode
): Promise<ScriptCallable> {
  const written = peelArgumentBlock(body)?.annotations ?? [];
  const annotations =
    written.length > 0 ? await evaluateAnnotations(s, [...written]) : {};
  return {
    ...buildScriptCallable({
      params: [],
      body,
      definingScope: s.ctx,
      annotations,
      returnType: anyTypeValue,
    }),
    held: true,
  };
}

/** Key lists made only of plain string literals, computed once per AST node. */
const LITERAL_KEY_LISTS = new WeakMap<
  ListLiteralNode,
  readonly string[] | null
>();

/**
 * The keys of a non-empty list made only of plain (non-interpolated) string
 * literals, or undefined when any element needs evaluation. Such a list is
 * valid by construction and always yields the same keys, so it is computed once
 * per node instead of on every dispatch.
 */
function literalStringKeys(
  keyList: ListLiteralNode
): readonly string[] | undefined {
  const cached = LITERAL_KEY_LISTS.get(keyList);
  if (cached !== undefined) return cached ?? undefined;
  const keys: string[] = [];
  let allLiteral = keyList.elements.length > 0;
  for (const element of keyList.elements) {
    const text = plainStringLiteralText(element);
    if (text === undefined) {
      allLiteral = false;
      break;
    }
    keys.push(text);
  }
  LITERAL_KEY_LISTS.set(keyList, allLiteral ? keys : null);
  return allLiteral ? keys : undefined;
}

/** Text of a bare, non-interpolated string literal expression, else undefined. */
function plainStringLiteralText(
  element: ListLiteralNode['elements'][number]
): string | undefined {
  if (element.type !== 'PipeChain') return undefined;
  if (element.pipes.length > 0 || element.terminator !== null) return undefined;
  const head = element.head;
  if (head.type !== 'PostfixExpr' || head.methods.length > 0) return undefined;
  if (head.defaultValue !== null || (head.existenceCheck ?? null) !== null) {
    return undefined;
  }
  const primary = head.primary;
  if (primary.type !== 'StringLiteral') return undefined;
  let text = '';
  for (const part of primary.parts) {
    if (typeof part !== 'string') return undefined;
    text += part;
  }
  return text;
}

/** Halt RILL-R002 when a multi-key entry's key list is empty. */
function requireNonEmptyKeys(
  keys: readonly RillValue[],
  site: {
    location: SourceLocation | undefined;
    sourceId: string | undefined;
    fn: string;
  },
  noun: 'dict' | 'map'
): void {
  if (keys.length === 0) {
    throwCatchableHostHalt(
      site,
      ERROR_ATOMS[ERROR_IDS.RILL_R002],
      `Multi-key ${noun} entry requires non-empty list`
    );
  }
}

/**
 * Evaluate a multi-key entry's key list and validate it: the list is
 * non-empty and every element is a string. A number or bool is ambiguous
 * (`0.50` evaluates to 0.5), so such a key is spelled as a string.
 */
async function evaluateMultiKeyStrings(
  s: EvalState,
  keyList: ListLiteralNode,
  fn: string
): Promise<readonly string[]> {
  const literalKeys = literalStringKeys(keyList);
  if (literalKeys !== undefined) return literalKeys;
  const keys: RillValue[] = await evaluateListLiteralElements(
    s,
    keyList.elements
  );
  const site = {
    location: keyList.span?.start,
    sourceId: s.ctx.sourceId,
    fn,
  };
  requireNonEmptyKeys(keys, site, 'dict');
  const stringKeys: string[] = [];
  for (const key of keys) {
    if (typeof key !== 'string') {
      const keyType = inferType(key);
      throwCatchableHostHalt(
        site,
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Multi-key dict entry keys must be string, got ${keyType}; quote the key`,
        { got: keyType }
      );
    }
    stringKeys.push(key);
  }
  return stringKeys;
}

/** An already evaluated entry value, reused instead of evaluating its node again. */
interface EntryReuse {
  readonly node: ExpressionNode;
  readonly value: RillValue;
}

/** Evaluate an entry value, or return the reused value when its node matches. */
function evaluateEntryOrReuse(
  s: EvalState,
  valueNode: ExpressionNode,
  reuse: EntryReuse | undefined
): Promise<RillValue> {
  return reuse !== undefined && reuse.node === valueNode
    ? Promise.resolve(reuse.value)
    : evaluateEntryValue(s, valueNode);
}

/**
 * Evaluate multi-key dict entry from a ListLiteralNode key.
 */
export async function evaluateDictMultiKeyFromList(
  s: EvalState,
  keyList: ListLiteralNode,
  value: ExpressionNode,
  reuse?: EntryReuse
): Promise<Array<[string, RillValue]>> {
  const stringKeys = await evaluateMultiKeyStrings(
    s,
    keyList,
    'evaluateDictMultiKeyFromList'
  );
  // Evaluate value once
  const evaluatedValue = await evaluateEntryOrReuse(s, value, reuse);
  return stringKeys.map((key): [string, RillValue] => [key, evaluatedValue]);
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
      `Dict key must be string, got ${inferType(value)}`
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
      `Dict key evaluated to ${inferType(value)}, expected string`
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
 *
 * Reserved method names (len, first, empty, eq, ne, keys, values, entries)
 * cannot be used as dict keys.
 * Multi-key entries (tuple keys) expand to multiple entries with shared value.
 * Errors from value evaluation propagate to caller.
 */
export async function evaluateDict(
  s: EvalState,
  node: DictNode,
  reuse?: EntryReuse
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
      rejectHeldEntries(
        spreadValue,
        'spread',
        {
          location: getNodeLocation(s, entry),
          sourceId: s.ctx.sourceId,
          fn: 'evaluateDict',
        },
        'direct'
      );
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
            await evaluateEntryOrReuse(s, entry.value, reuse)
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
          await evaluateEntryOrReuse(s, entry.value, reuse)
        );

        continue;
      }
      // At this point, entry.key is ListLiteralNode (multi-key entry)
      const pairs = await evaluateDictMultiKeyFromList(
        s,
        entry.key,
        entry.value,
        reuse
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
      await evaluateEntryOrReuse(s, entry.value, reuse)
    );
  }

  return result;
}

/**
 * Evaluate the keys of one map entry: a single key expression, or the
 * elements of a multi-key list. Every key passes the invalid-value gate.
 */
async function evaluateMapKeys(
  s: EvalState,
  key: ExpressionNode | ListLiteralNode
): Promise<RillValue[]> {
  if (key.type !== 'ListLiteral') {
    return [
      accessHaltGateFast(
        await evaluateExpression(s, key),
        'evaluateMap',
        () => key.span?.start,
        s.ctx.sourceId
      ),
    ];
  }
  const keys = await evaluateListLiteralElements(s, key.elements);
  requireNonEmptyKeys(
    keys,
    { location: key.span?.start, sourceId: s.ctx.sourceId, fn: 'evaluateMap' },
    'map'
  );
  return keys;
}

/**
 * Evaluate a map literal.
 *
 * Each entry evaluates its keys, then its value once; a multi-key entry binds
 * every key to that value. Entries keep insertion order. A map reserves no
 * keys. A non-scalar key, keys of two kinds, or two keys equal by value halt
 * at the offending entry.
 */
export async function evaluateMap(
  s: EvalState,
  node: MapLiteralNode
): Promise<RillValue> {
  const check = createMapKeyChecker();
  const pairs: (readonly [RillMapKey, RillValue])[] = [];
  for (const entry of node.entries) {
    const keys = await evaluateMapKeys(s, entry.key);
    for (const key of keys) {
      const fault = check(key);
      if (fault !== undefined || !isMapKey(key)) {
        throwTypeHalt(
          {
            location: entry.span?.start,
            sourceId: s.ctx.sourceId,
            fn: 'evaluateMap',
          },
          fault?.code ?? 'TYPE_MISMATCH',
          fault?.message ?? 'Map key must be a scalar',
          'runtime'
        );
      }
    }
    const value = await evaluateEntryValue(s, entry.value, 'evaluateMap');
    for (const key of keys) {
      if (isMapKey(key)) pairs.push([key, value]);
    }
  }
  return freezeMap(pairs);
}

/**
 * Evaluate dict as dispatch table when piped.
 *
 * Searches dict entries for a key matching the piped value. Dict keys are
 * strings, so a non-string input halts #TYPE_MISMATCH.
 * Returns the matched value. A selected held block runs with the selector as
 * `$`; any other value, including a function, is returned uncalled.
 *
 * Multi-key support: [["k1", "k2"]: value] syntax allows multiple keys
 * to map to the same value. Key tuple is evaluated to get list of candidates.
 *
 * @param s - Evaluator state
 * @param node - DictNode representing dispatch table
 * @param input - Piped value to use as lookup key
 * @returns Matched value (a held block's result when one was selected)
 * @throws RuntimeHaltSignal if no match and no default
 */
export async function evaluateDictDispatch(
  s: EvalState,
  node: DictNode,
  input: RillValue
): Promise<RillValue> {
  // Validate every entry's keys before matching, so a malformed table halts
  // whatever the input and whichever entry would match.
  const candidates: Array<readonly string[]> = [];
  for (const entry of node.entries) {
    if (typeof entry.key !== 'object') {
      // Spelled key, always a string after parsing
      candidates.push([entry.key]);
    } else if ('kind' in entry.key) {
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
    } else {
      candidates.push(
        await evaluateMultiKeyStrings(s, entry.key, 'evaluateDictDispatch')
      );
    }
  }
  // A non-string selector halts before any lookup, so the default cannot mask it.
  const inputKey = dictSelectorKey(input, {
    location: node.span?.start,
    sourceId: s.ctx.sourceId,
    fn: 'evaluateDictDispatch',
  });
  // Search entries for matching key (process in order, return first match)
  for (const [index, entry] of node.entries.entries()) {
    const matchFound = (candidates[index] ?? []).some((candidate) =>
      deepEquals(input, candidate)
    );

    if (matchFound) {
      // Found match - evaluate and return the value
      const matchedValue = await evaluateEntryValue(
        s,
        entry.value,
        'evaluateDictDispatch'
      );
      // A host property callable runs with the evaluated literal as `self`
      // and the selector as its pipe value.
      if (isPropertyCallable(matchedValue)) {
        const self = await evaluateDict(s, node, {
          node: entry.value,
          value: matchedValue,
        });
        const savedPipeValue = s.ctx.pipeValue;
        s.ctx.pipeValue = input;
        try {
          return await invokeCallable(
            s,
            matchedValue,
            [self],
            node.span?.start
          );
        } finally {
          s.ctx.pipeValue = savedPipeValue;
        }
      }
      return (
        await resolveSelected(
          s,
          matchedValue,
          input,
          undefined,
          node.span?.start
        )
      ).value;
    }
  }

  // No match found - check for default value
  if (node.defaultValue) {
    return await evaluateBodyExpression(s, node.defaultValue);
  }

  // No match and no default: the miss reads as a bracket read's
  return throwUndefinedDictKey(
    inputKey,
    {
      location: node.span?.start,
      sourceId: s.ctx.sourceId,
      fn: 'evaluateDictDispatch',
    },
    { key: inputKey }
  );
}

/**
 * Create a script callable from a closure node.
 * Closures use late binding - variables are resolved in definingScope when invoked.
 *
 * Default parameter values are evaluated immediately in the current context.
 * A script callable is never property-style: only a host callable
 * registered as a property runs on selection.
 */
export async function createClosure(
  s: EvalState,
  node: ClosureNode
): Promise<ScriptCallable> {
  // Store reference to the defining scope for late-bound variable resolution
  const definingScope = s.ctx;

  // Capture annotations at closure creation time
  const { annotations } = await captureClosureAnnotations(s.ctx);

  // The fn type is the one resolver of params and outer: dynamic refs
  // resolve now, so the closure captures concrete types.
  const fnType = await resolveTypeRef(
    s,
    node.returnTypeTarget === undefined
      ? { kind: 'fn', params: node.params }
      : { kind: 'fn', params: node.params, outer: node.returnTypeTarget },
    (name: string) => getVariable(s.ctx, name),
    node.span.start
  );
  const fnStructure = fnType.structure;
  const rillParams = isStructureKind(fnStructure, 'fn')
    ? fieldDefsToParams(fnStructure.params ?? [])
    : [];
  const outer = isStructureKind(fnStructure, 'fn')
    ? fnStructure.ret
    : undefined;

  return buildScriptCallable({
    params: rillParams,
    body: node.body,
    definingScope,
    annotations,
    returnType: outerTypeValue(outer),
  });
}

/** Type value of an outer type; `any` and an absent outer share one value. */
function outerTypeValue(outer: TypeStructure | undefined): RillTypeValue {
  return outer === undefined || outer.kind === 'any'
    ? anyTypeValue
    : structureToTypeValue(outer);
}

/**
 * The one constructor of a script callable, shared by a written function and
 * a function converted from an argument block. A callable with no params is
 * property-style.
 */
function buildScriptCallable(parts: {
  readonly params: readonly RillParam[];
  readonly body: BodyNode;
  readonly definingScope: RuntimeContext;
  readonly annotations: Record<string, RillValue>;
  readonly returnType: RillTypeValue;
}): ScriptCallable {
  return {
    __type: 'callable',
    kind: 'script',
    params: parts.params,
    body: parts.body,
    definingScope: parts.definingScope,
    isProperty: false,
    annotations: parts.annotations,
    returnType: parts.returnType,
  };
}

/** A code block with the annotations and outer type written around it. */
interface ArgumentBlock {
  readonly block: BlockNode;
  readonly annotations: readonly AnnotationArg[];
  readonly outer: TypeRef | undefined;
  /** The written expression when a `:?T` check wraps the block; it is the body. */
  readonly check: BodyNode | undefined;
}

/**
 * Peel the wrappers around an argument code block: annotations, a `:T`
 * assertion, or a `:?T` check. A check keeps the written expression, which
 * becomes the function body and yields a bool. Returns undefined for any other
 * wrapper.
 */
function peelArgumentBlock(node: ASTNode): ArgumentBlock | undefined {
  const annotations: AnnotationArg[] = [];
  let outer: TypeRef | undefined;
  let check: BodyNode | undefined;
  let written: BodyNode | undefined;
  let current: ASTNode = node;
  for (;;) {
    switch (current.type) {
      case 'Block':
        return { block: current, annotations, outer, check };
      case 'PostfixExpr':
        written ??= current;
        current = current.primary;
        break;
      case 'PipeChain':
        written ??= current;
        current = current.head;
        break;
      case 'TypeCheck':
        if (current.operand === null || written === undefined) {
          return undefined;
        }
        check ??= written;
        current = current.operand;
        break;
      case 'AnnotatedExpr':
        annotations.push(...current.annotations);
        current = current.expression;
        break;
      case 'TypeAssertion':
        if (current.operand === null) return undefined;
        outer ??= current.typeRef;
        current = current.operand;
        break;
      default:
        return undefined;
    }
  }
}

const ARGUMENT_BLOCK_PARAM_COUNTS = new WeakMap<BlockNode, number>();

/** Count of unnamed params an argument block reads, cached per block node. */
function argumentBlockParamCount(block: BlockNode): number {
  let count = ARGUMENT_BLOCK_PARAM_COUNTS.get(block);
  if (count === undefined) {
    count = unnamedParamsRead(block);
    ARGUMENT_BLOCK_PARAM_COUNTS.set(block, count);
  }
  return count;
}

/**
 * Create the function an argument block converts to. Its params are the
 * unnamed params the body reads, each typed any; its outer is the `:T` written
 * after the block, else any. Annotations written on the argument, and any
 * pending immediate annotation, attach to the function.
 */
async function createArgumentFunction(
  s: EvalState,
  arg: ArgumentBlock
): Promise<ScriptCallable> {
  const definingScope = s.ctx;
  const annotations: Record<string, RillValue> = {};
  for (const [k, v] of Object.entries(s.ctx.immediateAnnotation ?? {})) {
    setDictField(annotations, k, v);
  }
  s.ctx.immediateAnnotation = undefined;
  if (arg.annotations.length > 0) {
    const written = await evaluateAnnotations(s, [...arg.annotations]);
    for (const [k, v] of Object.entries(written)) {
      setDictField(annotations, k, v);
    }
  }

  const params = fieldDefsToParams(
    Array.from({ length: argumentBlockParamCount(arg.block) }, () => ({
      type: { kind: 'any' } as const,
    }))
  );
  const outer =
    arg.outer === undefined || arg.check !== undefined
      ? undefined
      : (
          await resolveTypeRef(
            s,
            arg.outer,
            (name: string) => getVariable(s.ctx, name),
            arg.block.span.start
          )
        ).structure;

  return buildScriptCallable({
    params,
    body: arg.check ?? arg.block,
    definingScope,
    annotations,
    returnType:
      arg.check === undefined
        ? outerTypeValue(outer)
        : structureToTypeValue({ kind: 'bool' }),
  });
}

/**
 * Evaluate a call argument. An argument that is a code block converts to a
 * function typed by the unnamed params its body reads; any other argument
 * evaluates as an expression.
 */
export async function evaluateArgument(
  s: EvalState,
  node: ExpressionNode
): Promise<Carried> {
  if (codeBlockShape(node) !== undefined) {
    const arg = peelArgumentBlock(node);
    if (arg !== undefined) {
      return {
        value: await createArgumentFunction(s, arg),
        declared: undefined,
      };
    }
  }
  return evaluateExpressionCarried(s, node);
}
