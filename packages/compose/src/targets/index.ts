import type {
  AgentManifest,
  BuildTarget,
  ManifestExtension,
} from '../schema.js';
import type { ResolvedExtension } from '../resolve.js';
import type { AgentCard } from '../card.js';

// ============================================================
// RESOLVED MANIFEST
// ============================================================

/**
 * AgentManifest extended with resolution metadata.
 * Written to agent.json in the build output (FR-BUILD-11).
 *
 * Uses Omit to override the required `extensions` field from AgentManifest
 * with an optional version that carries resolvedVersion metadata.
 */
export type ResolvedManifest = Omit<AgentManifest, 'extensions'> & {
  readonly extensions?: Record<
    string,
    ManifestExtension & { readonly resolvedVersion: string }
  >;
  readonly requiredEnvVars?: readonly string[];
};

// ============================================================
// BUILD CONTEXT
// ============================================================

/**
 * Inputs provided to a TargetBuilder.build() call.
 */
export interface BuildContext {
  readonly manifest: AgentManifest;
  readonly extensions: ResolvedExtension[];
  readonly outputDir: string;
  readonly manifestDir: string;
  readonly env: Record<string, string | undefined>;
}

// ============================================================
// BUILD RESULT
// ============================================================

/**
 * Outputs returned from a successful TargetBuilder.build() call.
 */
export interface BuildResult {
  readonly outputPath: string;
  readonly target: BuildTarget;
  readonly card: AgentCard;
  readonly resolvedManifest: ResolvedManifest;
}

// ============================================================
// TARGET BUILDER INTERFACE
// ============================================================

/**
 * Implemented by each deployment target (container, lambda, worker, local).
 */
export interface TargetBuilder {
  readonly target: BuildTarget;
  build(context: BuildContext): Promise<BuildResult>;
}

// ============================================================
// DISPATCH
// ============================================================

/**
 * Dispatches a build to the correct TargetBuilder for the given target.
 *
 * @param target - Deployment target identifier
 * @param context - Build inputs
 * @returns Build result from the selected builder
 * @throws ComposeError for target-specific failures
 */
export async function build(
  target: BuildTarget,
  context: BuildContext
): Promise<BuildResult> {
  // Import lazily to avoid loading unused builder code at module init time.
  const { containerBuilder } = await import('./container.js');
  const { lambdaBuilder } = await import('./lambda.js');
  const { workerBuilder } = await import('./worker.js');
  const { localBuilder } = await import('./local.js');

  const builders: Record<BuildTarget, TargetBuilder> = {
    container: containerBuilder,
    lambda: lambdaBuilder,
    worker: workerBuilder,
    local: localBuilder,
  };

  const builder = builders[target];
  return builder.build(context);
}
