/**
 * Fixed-length duration check for time-bound options.
 *
 * A duration with a months part has no fixed wall-time length, so no option
 * that turns a duration into a delay or deadline accepts one. Every such
 * consumer reads its milliseconds through `requireFixedDuration`.
 */

import type { RillDuration } from './structures.js';
import { throwCatchableHostHalt, type TypeHaltSite } from './halt.js';

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
