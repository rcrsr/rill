import type { RillValue } from '../../core/types/structures.js';
import type { RuntimeContext } from '../../core/types/runtime.js';
import type { SourceLocation } from '../../../types.js';
import type { EvalState } from '../../core/eval/state.js';
import { callable, isCallable } from '../../core/callable.js';
import { checkAborted } from '../../core/eval/shared.js';
import { invokeCallable as invokeCallableState } from '../../core/eval/handlers/closures.js';
import { throwCatchableHostHalt } from '../../core/types/halt.js';

/**
 * Walk an iterator or stream until `cap` value-bearing elements have been
 * produced (or the sequence is exhausted), collecting those values.
 * Returns the collected elements and the tail step positioned immediately
 * after the last produced value.
 * Used by take() and skip() to avoid materialising the entire sequence.
 *
 * `cap` counts produced elements, not raw steps. A stream from
 * `createRillStream` begins with a value-less "pending" head step
 * (done:false with no `value`); the first `.next` pulls the first chunk.
 * That head step is a positioning step, not an element, so it must not
 * count toward `cap` — otherwise take() returns one element short and
 * skip() keeps one too many. Iterators (range, cycle, iterate) carry a
 * value in their head step and are unaffected: every step they emit is a
 * produced element. This mirrors expandStream/expandIterator, which push a
 * step's value only when it is not undefined.
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

  let produced = 0;
  while (produced < cap) {
    checkAborted(evaluator);
    if (current['done']) break;
    const val = current['value'];

    // Advance to the next step regardless of whether this step carried a
    // value: the value-less stream head still has to be stepped over to
    // reach the first chunk.
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

    // Count this step toward `cap` only when it produced a value.
    if (val !== undefined) {
      elements.push(val as RillValue);
      produced++;
    }
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
 * Iteration step cap shared by unbounded collection operators.
 * Enforced as a hard cap (halts with #RILL_R010 when exceeded) by seq, acc,
 * fold, iterate, batch, window, start_when, and stop_when. take is the sole
 * exception: n > MAX_ITER is silently clamped to MAX_ITER without halting.
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
