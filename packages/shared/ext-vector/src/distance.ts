/**
 * Distance metric normalization utilities.
 * Converts provider-specific distance metric names to standard strings.
 */

import type { DistanceMetric } from './types.js';

/**
 * Convert provider-specific distance metric names to standard strings.
 *
 * Maps common provider-specific variations to standardized metric names:
 * - "cosine" or "Cosine" → "cosine"
 * - "euclidean" or "Euclid" → "euclidean"
 * - "dotproduct" or "Dot" or "dot" → "dot"
 * - Unknown values → returned unchanged
 *
 * Matching is case-sensitive per provider conventions (not a general lowercase).
 *
 * @param metric - Provider-specific distance metric name
 * @returns Standard DistanceMetric string or original value if unknown
 *
 * @example
 * ```typescript
 * normalizeDistance('Cosine');      // "cosine"
 * normalizeDistance('Euclid');      // "euclidean"
 * normalizeDistance('dotproduct');  // "dot"
 * normalizeDistance('Dot');         // "dot"
 * normalizeDistance('custom');      // "custom" (unchanged)
 * ```
 */
export function normalizeDistance(metric: string): DistanceMetric | string {
  // AC-7: "dotproduct" or "Dot" or "dot" → "dot"
  if (metric === 'dotproduct' || metric === 'Dot' || metric === 'dot') {
    return 'dot';
  }

  // "cosine" or "Cosine" → "cosine"
  if (metric === 'cosine' || metric === 'Cosine') {
    return 'cosine';
  }

  // AC-8: "euclidean" or "Euclid" → "euclidean"
  if (metric === 'euclidean' || metric === 'Euclid') {
    return 'euclidean';
  }

  // AC-20: Unknown input returns original value unchanged
  return metric;
}
