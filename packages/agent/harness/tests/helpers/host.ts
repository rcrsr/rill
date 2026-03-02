/**
 * Test utilities for AgentHost integration tests.
 *
 * Mirrors the pattern from packages/core/tests/helpers/runtime.ts.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { composeAgent } from '@rcrsr/rill-agent-harness';
import type { ComposedAgent } from '../../src/index.js';
import type { AgentHost, AgentHostOptions } from '../../src/index.js';
import { createAgentHost } from '../../src/index.js';

// Absolute path to the minimal fixture script — resolved once at module load.
// Using an absolute path ensures composeAgent() finds the file regardless of
// what process.cwd() is at test time.
const FIXTURE_DIR = path.resolve(
  fileURLToPath(import.meta.url),
  '../../fixtures'
);

// ============================================================
// MOCK COMPOSED AGENT
// ============================================================

/**
 * Returns a minimal ComposedAgent for testing by calling composeAgent()
 * with a local manifest literal and the fixture directory as basePath.
 */
export async function mockComposedAgent(): Promise<ComposedAgent> {
  return composeAgent(
    {
      name: 'test-agent',
      version: '0.0.1',
      runtime: '@rcrsr/rill@*',
      entry: 'minimal.rill',
      modules: {},
      extensions: {},
      functions: {},
      assets: [],
    },
    { basePath: FIXTURE_DIR, config: {} }
  );
}

// ============================================================
// CREATE TEST HOST
// ============================================================

/**
 * Creates a fully initialized AgentHost in 'ready' state for testing.
 * createAgentHost() accepts a pre-composed agent; no init() call is needed.
 */
export async function createTestHost(
  options?: AgentHostOptions
): Promise<AgentHost> {
  return createAgentHost(await mockComposedAgent(), options);
}
