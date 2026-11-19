/**
 * Held Blocks
 *
 * A held block is a script callable with no params that a collection entry
 * holds. It is never a value, so operations that read entries as values
 * reject it. This module is the only producer of that halt.
 *
 * @internal
 */

import type { RillValue } from './structures.js';
import { isCallable, isOrdered, isPlainDict, isTuple } from './guards.js';
import { throwHeldEntryHalt, type TypeHaltSite } from './halt.js';

/** Which entries `rejectHeldEntries` inspects. */
export type HeldEntryMode = 'direct' | 'deep';

/** True when the value is a held block. */
export function isHeldBlock(value: RillValue): boolean {
  return isCallable(value) && 'held' in value && value.held === true;
}

function checkEntry(
  entry: RillValue,
  key: string | number,
  op: string,
  site: TypeHaltSite,
  mode: HeldEntryMode
): void {
  if (isHeldBlock(entry)) throwHeldEntryHalt(op, key, site);
  if (mode === 'deep') rejectHeldEntries(entry, op, site, mode);
}

/**
 * Halt with a catchable #TYPE_MISMATCH when a list, tuple, dict or ordered
 * value holds a block entry. 'direct' inspects the immediate entries;
 * 'deep' also recurses through nested collections. Other values pass.
 */
export function rejectHeldEntries(
  value: RillValue,
  op: string,
  site: TypeHaltSite,
  mode: HeldEntryMode
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => checkEntry(entry, i, op, site, mode));
  } else if (isTuple(value)) {
    value.entries.forEach((entry, i) => checkEntry(entry, i, op, site, mode));
  } else if (isOrdered(value)) {
    for (const [key, entry] of value.entries) {
      checkEntry(entry, key, op, site, mode);
    }
  } else if (isPlainDict(value)) {
    for (const [key, entry] of Object.entries(value)) {
      checkEntry(entry, key, op, site, mode);
    }
  }
}
