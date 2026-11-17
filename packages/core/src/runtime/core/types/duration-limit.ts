/**
 * Fixed-length duration check for time-bound options.
 *
 * A duration with a months part has no fixed wall-time length, so no option
 * that turns a duration into a delay or deadline accepts one. Every such
 * consumer reads its milliseconds through `requireFixedDuration`.
 */

import type { RillDuration } from './structures.js';
import {
  throwCatchableHostHalt,
  throwTypeHalt,
  type TypeHaltSite,
} from './halt.js';
import { isDurationInRange, parseDurationText } from './duration-units.js';

/**
 * Return the milliseconds of `value`, halting `#INVALID_INPUT` when it has a
 * nonzero months part. `optionName` names the option in the halt message.
 */
export function requireFixedDuration(
  value: RillDuration,
  optionName: string,
  site: TypeHaltSite
): number {
  if (value.months !== 0) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `${optionName}: duration with a months part has no fixed length; use a duration without months or years`
    );
  }
  return value.ms;
}

/** Largest delay a Node timer honours; larger delays fire after 1 ms. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Return `ms` unchanged, halting `#INVALID_INPUT` when it exceeds the timer
 * ceiling. Call before arming any timer from a duration.
 */
export function requireTimerDelay(
  ms: number,
  optionName: string,
  site: TypeHaltSite
): number {
  if (ms > MAX_TIMER_DELAY_MS) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `${optionName}: ${ms} ms exceeds the timer ceiling of ${MAX_TIMER_DELAY_MS} ms`
    );
  }
  return ms;
}

/**
 * Halt `#INVALID_INPUT` unless both components are finite, non-negative, and
 * at most `Number.MAX_SAFE_INTEGER`. Call before building any duration.
 */
export function requireDurationInRange(
  months: number,
  ms: number,
  site: TypeHaltSite,
  operation: string
): void {
  if (!isDurationInRange(months, ms)) {
    throwCatchableHostHalt(
      site,
      'INVALID_INPUT',
      `${operation}: duration out of range (months ${months}, ms ${ms}); each component must be a non-negative integer no larger than ${Number.MAX_SAFE_INTEGER}`
    );
  }
}

/**
 * Parse duration text (the printed form) into a duration value. Halts
 * `#INVALID_INPUT` on malformed text or an out-of-range result. Shared by
 * `duration("...")` and `"..." -> duration`.
 */
export function durationFromText(
  text: string,
  site: TypeHaltSite
): RillDuration {
  const parsed = parseDurationText(text);
  if (parsed === undefined) {
    throwTypeHalt(
      site,
      'INVALID_INPUT',
      `duration() cannot parse "${text}"`,
      'runtime'
    );
  }
  requireDurationInRange(parsed.months, parsed.ms, site, 'duration()');
  return { __rill_duration: true, months: parsed.months, ms: parsed.ms };
}
