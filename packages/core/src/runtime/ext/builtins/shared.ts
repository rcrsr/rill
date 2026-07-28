import type { RillValue } from '../../core/types/structures.js';
import type { RuntimeContext } from '../../core/types/runtime.js';
import type { SourceLocation } from '../../../types.js';
import type { EvalState } from '../../core/eval/state.js';
import { callable, isCallable } from '../../core/callable.js';
import { checkAborted } from '../../core/eval/shared.js';
import { invokeCallable as invokeCallableState } from '../../core/eval/handlers/closures.js';
import { throwCatchableHostHalt } from '../../core/types/halt.js';

/**
 * Walk an iterator or stream for up to `cap` steps, collecting values.
 * Returns the collected elements. Stops early when done===true.
 * Used by take() and skip() to avoid materialising the entire sequence.
 */
export async function walkIteratorSteps(
  start: Record<string, unknown>,
  cap: number,
  evaluator: EvalState,
  location: { line: number; column: number; offset: number },
  sourceId: string | undefined
): Promise<{ elements: RillValue[]; tail: Record<string, unknown> }> {
  const elements: RillValue[] = [];
  let current = start;
  const site = {
    location,
    sourceId: sourceId ?? '<unknown>',
    fn: 'walkIteratorSteps',
  };

  for (let i = 0; i < cap; i++) {
    checkAborted(evaluator);
    if (current['done']) break;
    const val = current['value'];
    if (val !== undefined) {
      elements.push(val as RillValue);
    }
    const nextRaw = current['next'];
    const nextClosure = nextRaw as RillValue;
    if (nextRaw === undefined || !isCallable(nextClosure)) {
      throwCatchableHostHalt(
        site,
        'RILL_R002',
        'Iterator/stream .next must be a closure'
      );
    }
    const nextStep = await invokeCallableState(
      evaluator,
      nextClosure,
      [],
      location,
      'next'
    );
    if (typeof nextStep !== 'object' || nextStep === null) {
      throwCatchableHostHalt(
        site,
        'RILL_R002',
        'Iterator/stream .next must return an object'
      );
    }
    current = nextStep as Record<string, unknown>;
  }

  return { elements, tail: current };
}

/**
 * Slice `elements` into chunks of `size`. The last chunk may be smaller
 * than `size` when `elements.length` is not an exact multiple.
 * Used by `fan`, `filter` (concurrency batches) and `batch` (output chunks).
 */
export function chunkSlice(elements: RillValue[], size: number): RillValue[][] {
  const chunks: RillValue[][] = [];
  for (let i = 0; i < elements.length; i += size) {
    chunks.push(elements.slice(i, i + size));
  }
  return chunks;
}

/** Internal type alias for built-in method implementations. */
export type RillMethod = (
  receiver: RillValue,
  args: RillValue[],
  ctx: RuntimeContext,
  location?: SourceLocation
) => RillValue | Promise<RillValue>;

// ============================================================
// ITERATOR HELPERS
// ============================================================

/**
 * Create an iterator for a list at the given index.
 * Returns { value, done, next } dict.
 */
export function makeListIterator(list: RillValue[], index: number): RillValue {
  if (index >= list.length) {
    return { done: true, next: callable(() => makeListIterator(list, index)) };
  }
  return {
    value: list[index]!,
    done: false,
    next: callable(() => makeListIterator(list, index + 1)),
  };
}

/**
 * Create an iterator for a string at the given index.
 * Returns { value, done, next } dict.
 */
export function makeStringIterator(str: string, index: number): RillValue {
  if (index >= str.length) {
    return { done: true, next: callable(() => makeStringIterator(str, index)) };
  }
  return {
    value: str[index]!,
    done: false,
    next: callable(() => makeStringIterator(str, index + 1)),
  };
}

/**
 * Create an iterator for a dict at the given index.
 * Dict iteration yields { key, value } entries sorted by key.
 */
export function makeDictIterator(
  dict: Record<string, RillValue>,
  index: number
): RillValue {
  const keys = Object.keys(dict).sort();
  if (index >= keys.length) {
    return {
      done: true,
      next: callable(() => makeDictIterator(dict, index)),
    };
  }
  const key = keys[index]!;
  return {
    value: { key, value: dict[key]! },
    done: false,
    next: callable(() => makeDictIterator(dict, index + 1)),
  };
}

/**
 * Check if a value is a rill iterator (dict with value, done, next fields).
 */

export const MAX_ITER = 10000;

/**
 * Describes one step produced by a makeGenericIterator step function.
 * done:true   — the sequence is exhausted; no value emitted.
 * done:false  — emit value and continue with next seed.
 */
type GenericStepResult =
  | { done: true }
  | { done: false; value: RillValue; next: RillValue };

/**
 * Build a lazy iterator from a seed value and a pure step function.
 *
 * fn(current) returns either { done: true } to terminate the sequence, or
 * { done: false, value, next } to emit value and advance the seed to next.
 *
 * This is the private unification point for range and repeat; iterate is
 * the public-facing builtin that uses it via an async wrapper.
 *
 * @internal
 */
export function makeGenericIterator(
  seed: RillValue,
  fn: (current: RillValue) => GenericStepResult
): RillValue {
  const step = (current: RillValue): RillValue => {
    const result = fn(current);
    if (result.done) {
      return { done: true, next: callable(() => step(current)) };
    }
    return {
      value: result.value,
      done: false,
      next: callable(() => step(result.next)),
    };
  };
  return step(seed);
}

/**
 * Default key extractor for sort(dict, ...).
 * Receives a { key, value } entry dict and returns the key string.
 * Constructed once at module load; not re-allocated per call.
 */
export const DICT_DEFAULT_KEY_FN = callable((args) => {
  const entry = (args as unknown as RillValue[])[0] ?? null;
  if (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    'key' in (entry as Record<string, unknown>)
  ) {
    return (entry as Record<string, RillValue>)['key'] ?? null;
  }
  return null;
});
