/**
 * Unit tests for composeHarness config-based approach.
 *
 * Covered:
 *   AC-18  Extension with no required fields and empty config {} succeeds
 *   EC-10  composeHarness(manifest) without config → TypeScript compile error (type-level only)
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { composeHarness } from '../../src/index.js';
import type { HarnessManifest } from '@rcrsr/rill-agent-shared';

// Absolute path to fixture directory — resolved once at module load.
const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures'
);

// ============================================================
// describe: composeHarness — config-based approach
// ============================================================

describe('composeHarness — config-based approach', () => {
  // ----------------------------------------------------------
  // AC-18: Extension with no required fields and empty config {} succeeds
  // ----------------------------------------------------------
  it('succeeds with no extensions and empty config {} (AC-18)', async () => {
    const manifest: HarnessManifest = {
      shared: {},
      agents: [
        {
          name: 'test-agent',
          entry: 'minimal.rill',
          extensions: {},
        },
      ],
    };

    const harness = await composeHarness(manifest, {
      basePath: FIXTURE_DIR,
      config: {},
    });

    try {
      expect(harness.agents.has('test-agent')).toBe(true);
      expect(harness.sharedExtensions).toEqual({});
    } finally {
      await harness.dispose();
    }
  });
});
