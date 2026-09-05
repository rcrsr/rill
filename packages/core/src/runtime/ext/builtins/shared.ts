import type { RillValue } from '../../core/types/structures.js';
import type { RuntimeContext } from '../../core/types/runtime.js';
import type { SourceLocation } from '../../../types.js';
import type { EvalState } from '../../core/eval/state.js';
import { callable, isCallable } from '../../core/callable.js';
import { typedKeyEntries } from '../../core/types/dict-keys.js';
import { checkAborted } from '../../core/eval/shared.js';
import { invokeCallable as invokeCallableState } from '../../core/eval/handlers/closures.js';
import {
  throwCatchableHostHalt,
  throwTypeHalt,
} from '../../core/types/halt.js';
import { inferType } from '../../core/types/registrations.js';

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
 *
 * Bounded by raw steps taken (MAX_ITER), not just `produced`: a
 * user-authored iterator that returns `{done: false, next: ...}` with no
 * `value` field never increments `produced` and would otherwise loop
 * forever. Mirrors the expandIterator/expandStream MAX_ITER guard. Raised as
 * a catchable #RILL_R010, matching batch/window/start_when/stop_when
 * (functions/slicing.ts): a guard block can recover from a runaway
 * take()/skip() input.
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
  let steps = 0;
  let expectedType: string | undefined;
  while (produced < cap) {
    checkAborted(evaluator);
    if (current['done']) break;
    if (steps >= MAX_ITER) {
      throwCatchableHostHalt(
        site,
        'RILL_R010',
        `Iterator/stream exceeded ${MAX_ITER} step limit without producing ${cap} value(s)`
      );
    }
    steps++;
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
      const actualType = inferType(val as RillValue);
      if (expectedType === undefined) {
        expectedType = actualType;
      } else if (actualType !== expectedType) {
        throwTypeHalt(
          site,
          'TYPE_MISMATCH',
          `Chunk type mismatch: expected ${expectedType}, got ${actualType}`,
          'runtime',
          { expectedType, actualType }
        );
      }
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

/**
 * True when `str` contains no surrogate-pair (astral) characters, i.e. every
 * UTF-16 code unit is also a full Unicode code point.
 *
 * Code-point-correct string methods (`.len`, `.head`, `.tail`, `.at`,
 * `.index_of`) must not split an astral character (e.g. "😀") into a lone
 * surrogate half, so they materialize `[...str]` to walk code points. That
 * array allocation is O(n) on every call, which makes repeated per-index
 * access (`range(0, $s.len) -> seq({ $s -> .at($) })`) O(n²). Strings with no
 * astral characters can use `.length`/`charAt`/direct indexing instead,
 * which are O(1) per access, while astral strings still take the
 * code-point-correct path.
 */
export function isBmpOnly(str: string): boolean {
  return !/[\uD800-\uDBFF]/.test(str);
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
 *
 * Iteration is by Unicode code point, not UTF-16 code unit, so astral
 * characters (e.g. "😀") are emitted whole and never split into lone
 * surrogates. This matches how .len, .head, .tail, .at, and slice<> index
 * strings, and how seq/fan/take/skip traverse them.
 */
export function makeStringIterator(str: string, index: number): RillValue {
  return makeCodePointIterator(Array.from(str), index);
}

/**
 * Iterate a pre-split array of code points. Splitting once and recursing over
 * the shared array keeps stepping O(1) rather than re-scanning the string on
 * every `.next`.
 */
function makeCodePointIterator(codePoints: string[], index: number): RillValue {
  if (index >= codePoints.length) {
    return {
      done: true,
      next: callable(() => makeCodePointIterator(codePoints, index)),
    };
  }
  return {
    value: codePoints[index]!,
    done: false,
    next: callable(() => makeCodePointIterator(codePoints, index + 1)),
  };
}

/**
 * Create an iterator for a dict at the given index.
 * Dict iteration yields { key, value } entries: sorted string keys first, then
 * number/boolean keys (in insertion order), each surfaced with its real type.
 */
export function makeDictIterator(
  dict: Record<string, RillValue>,
  index: number
): RillValue {
  const stringKeys = Object.keys(dict).sort();
  const entries: Array<{ key: RillValue; value: RillValue }> = stringKeys.map(
    (key) => ({ key, value: dict[key]! })
  );
  for (const e of typedKeyEntries(dict)) {
    entries.push({ key: e.key, value: e.value });
  }
  if (index >= entries.length) {
    return {
      done: true,
      next: callable(() => makeDictIterator(dict, index)),
    };
  }
  const entry = entries[index]!;
  return {
    value: { key: entry.key, value: entry.value },
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
