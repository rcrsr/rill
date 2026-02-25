/**
 * Test utilities for AgentHost integration tests.
 *
 * Mirrors the pattern from packages/core/tests/helpers/runtime.ts.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AgentManifest } from '@rcrsr/rill-compose';
import type { AgentHost, AgentHostOptions } from '../../src/index.js';
import { createAgentHost } from '../../src/index.js';

// Absolute path to the minimal fixture script — resolved once at module load.
// Using an absolute path ensures composeAgent() finds the file regardless of
// what process.cwd() is at test time.
const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures'
);

const MINIMAL_ENTRY = path.join(FIXTURE_DIR, 'minimal.rill');

// ============================================================
// MOCK MANIFEST
// ============================================================

/**
 * Returns a minimal valid AgentManifest for testing.
 * All optional collection fields use empty defaults.
 */
export function mockManifest(): AgentManifest {
  return {
    name: 'test-agent',
    version: '0.0.1',
    runtime: '@rcrsr/rill@*',
    entry: MINIMAL_ENTRY,
    modules: {},
    extensions: {},
    functions: {},
    assets: [],
  };
}

// ============================================================
// CREATE TEST HOST
// ============================================================

/**
 * Creates a fully initialized AgentHost in 'ready' state for testing.
 * Calls init() before returning so the host is ready to run scripts.
 */
export async function createTestHost(
  options?: AgentHostOptions
): Promise<AgentHost> {
  const host = createAgentHost(mockManifest(), options);
  await host.init();
  return host;
}
