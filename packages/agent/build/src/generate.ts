import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type HarnessType, getTemplate } from './templates.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

export type { HarnessType };

export interface GenerateHarnessOptions {
  readonly outputPath?: string | undefined;
}

export interface GenerateHarnessResult {
  readonly outputPath: string;
  readonly harnessType: HarnessType;
  readonly agentCount: number;
}

// ============================================================
// CONSTANTS
// ============================================================

const VALID_HARNESS_TYPES: readonly HarnessType[] = [
  'http',
  'stdio',
  'gateway',
  'worker',
];

// ============================================================
// IMPLEMENTATION
// ============================================================

/**
 * Generate a harness entry point for a built agent bundle.
 *
 * Reads bundle.json from bundleDir, validates handlers.js exists,
 * writes ESM JavaScript to outputPath (default: <bundleDir>/harness.js).
 *
 * @param bundleDir - Path to the bundle output directory
 * @param harnessType - One of 'http' | 'stdio' | 'gateway' | 'worker'
 * @param options - Optional outputPath override
 * @returns GenerateHarnessResult with outputPath, harnessType, agentCount
 * @throws Error for missing dirs/files, invalid harness type, or write failures
 */
export async function generateHarness(
  bundleDir: string,
  harnessType: HarnessType,
  options?: GenerateHarnessOptions
): Promise<GenerateHarnessResult> {
  const absBundleDir = path.resolve(bundleDir);

  // EC-1: Bundle dir missing
  try {
    await access(absBundleDir);
  } catch {
    throw new Error(`Bundle directory not found: ${absBundleDir}`);
  }

  // EC-4: Invalid harness type
  if (!(VALID_HARNESS_TYPES as readonly string[]).includes(harnessType)) {
    throw new Error(
      `Invalid harness type: ${String(harnessType)}. Valid types: ${VALID_HARNESS_TYPES.join(', ')}`
    );
  }

  // EC-2: bundle.json missing
  const bundleJsonPath = path.join(absBundleDir, 'bundle.json');
  let bundleJson: string;
  try {
    bundleJson = await readFile(bundleJsonPath, 'utf-8');
  } catch {
    throw new Error(`bundle.json not found: ${bundleJsonPath}`);
  }

  // EC-3: handlers.js missing
  const handlersPath = path.join(absBundleDir, 'handlers.js');
  try {
    await access(handlersPath);
  } catch {
    throw new Error(`handlers.js not found: ${handlersPath}`);
  }

  // Count agents from bundle.json
  const agentCount = countAgents(bundleJson, bundleJsonPath);

  // Determine output path
  const outputPath =
    options?.outputPath ?? path.join(absBundleDir, 'harness.js');
  const absOutputPath = path.resolve(outputPath);

  // EC-5: Output path not writable
  const template = getTemplate(harnessType);
  try {
    await writeFile(absOutputPath, template, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot write harness to ${absOutputPath}: ${msg}`, {
      cause: err,
    });
  }

  return { outputPath: absOutputPath, harnessType, agentCount };
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function countAgents(bundleJson: string, bundleJsonPath: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundleJson);
  } catch {
    throw new Error(`Failed to parse bundle.json: ${bundleJsonPath}`);
  }

  if (parsed === null || typeof parsed !== 'object') {
    return 1;
  }

  const bundle = parsed as Record<string, unknown>;
  const agents = bundle['agents'];

  if (agents === null || agents === undefined) {
    return 1;
  }

  if (Array.isArray(agents)) {
    return agents.length;
  }

  if (typeof agents === 'object') {
    return Object.keys(agents as object).length;
  }

  return 1;
}
