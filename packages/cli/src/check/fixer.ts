/**
 * Fix Applier
 * Apply automatic fixes to source code with collision detection.
 */

import { parse } from '@rcrsr/rill';
import type { Diagnostic, ValidationContext } from './types.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Result of applying fixes to source code.
 */
export interface ApplyResult {
  /** Modified source code with fixes applied */
  readonly modified: string;
  /** Number of fixes successfully applied */
  readonly applied: number;
  /** Number of fixes skipped */
  readonly skipped: number;
  /** Reasons for skipped fixes */
  readonly skippedReasons: Array<{ code: string; reason: string }>;
}

/**
 * Internal representation of a fix to apply.
 */
interface ApplicableFix {
  readonly code: string;
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}

// ============================================================
// FIX APPLICATION
// ============================================================

/**
 * Apply automatic fixes to source code.
 *
 * Constraints:
 * - Applies fixes in reverse position order (end to start) to avoid offset shifts
 * - Skips fixes where applicable === false
 * - Detects collisions (overlapping ranges) and skips with reason
 * - Verifies modified source parses successfully
 * - Throws if any applied fix creates invalid syntax
 *
 * @param source - Original source code
 * @param diagnostics - Diagnostics with potential fixes
 * @param context - Validation context (unused but required by spec)
 * @returns ApplyResult with modified source and counts
 * @throws Error if applied fixes create invalid syntax [EC-6]
 */
export function applyFixes(
  source: string,
  diagnostics: Diagnostic[],
  _context: ValidationContext
): ApplyResult {
  // Filter to diagnostics with fixes
  const fixableDiagnostics = diagnostics.filter(
    (d) => d.fix !== null && d.fix.applicable
  );

  // If no applicable fixes, return original
  if (fixableDiagnostics.length === 0) {
    return {
      modified: source,
      applied: 0,
      skipped: 0,
      skippedReasons: [],
    };
  }

  // Convert to ApplicableFix with positions
  const fixes: ApplicableFix[] = fixableDiagnostics.map((d) => ({
    code: d.code,
    start: d.fix!.range.start.offset,
    end: d.fix!.range.end.offset,
    replacement: d.fix!.replacement,
  }));

  // Sort fixes by end position (descending) to apply from end to start
  // This avoids offset shifts when applying multiple fixes
  const sortedFixes = fixes.slice().sort((a, b) => b.end - a.end);

  // Detect collisions and filter to non-overlapping fixes
  const { validFixes, skippedReasons } = filterCollisions(sortedFixes);

  // Apply fixes to source
  let modified = source;
  for (const fix of validFixes) {
    const before = modified.slice(0, fix.start);
    const after = modified.slice(fix.end);
    modified = before + fix.replacement + after;
  }

  // Verify modified source parses successfully [EC-6]
  try {
    parse(modified);
  } catch {
    throw new Error('Fix would create invalid syntax');
  }

  const applied = validFixes.length;
  const skipped = sortedFixes.length - applied;

  return {
    modified,
    applied,
    skipped,
    skippedReasons,
  };
}

// ============================================================
// COLLISION DETECTION
// ============================================================

/**
 * Filter fixes to remove overlapping ranges.
 * Detects collisions where fix ranges overlap [EC-5].
 *
 * Strategy: Keep first fix in sorted order (end to start),
 * skip subsequent fixes that overlap with any kept fix.
 *
 * @param sortedFixes - Fixes sorted by end position (descending)
 * @returns Valid fixes and reasons for skipped fixes
 */
function filterCollisions(sortedFixes: ApplicableFix[]): {
  validFixes: ApplicableFix[];
  skippedReasons: Array<{ code: string; reason: string }>;
} {
  const validFixes: ApplicableFix[] = [];
  const skippedReasons: Array<{ code: string; reason: string }> = [];

  for (const fix of sortedFixes) {
    // Check if this fix overlaps with any already-kept fix
    const hasCollision = validFixes.some((kept) => rangesOverlap(fix, kept));

    if (hasCollision) {
      // Skip this fix due to collision [EC-5]
      skippedReasons.push({
        code: fix.code,
        reason: 'Fix range overlaps with another fix',
      });
    } else {
      // No collision, keep this fix
      validFixes.push(fix);
    }
  }

  return { validFixes, skippedReasons };
}

/**
 * Check if two fix ranges overlap.
 *
 * Ranges overlap if:
 * - One starts before the other ends, AND
 * - One ends after the other starts
 *
 * @param a - First fix range
 * @param b - Second fix range
 * @returns true if ranges overlap
 */
function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && a.end > b.start;
}
