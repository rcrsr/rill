import { z } from 'zod';
import { ManifestValidationError, type ManifestIssue } from './errors.js';

// ============================================================
// SEMVER AND RUNTIME PATTERNS
// ============================================================

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
const RUNTIME_RE = /^@rcrsr\/rill@.+$/;

// ============================================================
// NESTED SCHEMA DEFINITIONS
// ============================================================

const manifestExtensionSchema = z
  .object({
    package: z.string(),
    version: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    resolvedVersion: z.string().optional(),
  })
  .strict();

const manifestHostOptionsSchema = z
  .object({
    timeout: z.number().optional(),
    maxCallStackDepth: z.number().default(100),
    requireDescriptions: z.boolean().default(false),
  })
  .strict();

const manifestDeployOptionsSchema = z
  .object({
    port: z.number().optional(),
    healthPath: z.string().default('/health'),
    stateBackend: z.string().optional(),
  })
  .strict();

// ============================================================
// AGENT SKILL SCHEMA
// ============================================================

const agentSkillSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    tags: z.array(z.string()).optional(),
    examples: z.array(z.string()).optional(),
    inputModes: z.array(z.string()).optional(),
    outputModes: z.array(z.string()).optional(),
  })
  .strict();

// ============================================================
// AGENT MANIFEST SCHEMA
// ============================================================

const agentManifestSchema = z
  .object({
    name: z.string(),
    version: z.string().superRefine((v, ctx) => {
      if (!SEMVER_RE.test(v)) {
        ctx.addIssue({ code: 'custom', message: `invalid semver "${v}"` });
      }
    }),
    runtime: z.string().superRefine((v, ctx) => {
      if (!RUNTIME_RE.test(v)) {
        ctx.addIssue({
          code: 'custom',
          message: `expected @rcrsr/rill@{range}`,
        });
      }
    }),
    entry: z.string(),
    modules: z.record(z.string(), z.string()).default({}),
    extensions: z.record(z.string(), manifestExtensionSchema).default({}),
    functions: z.record(z.string(), z.string()).default({}),
    assets: z.array(z.string()).default([]),
    description: z.string().optional(),
    skills: z.array(agentSkillSchema).default([]),
    host: manifestHostOptionsSchema.optional(),
    deploy: manifestDeployOptionsSchema.optional(),
  })
  .strict();

// ============================================================
// EXPORTED TYPES
// ============================================================

export type ManifestExtension = z.infer<typeof manifestExtensionSchema>;
export type ManifestHostOptions = z.infer<typeof manifestHostOptionsSchema>;
export type ManifestDeployOptions = z.infer<typeof manifestDeployOptionsSchema>;
export type AgentSkill = z.infer<typeof agentSkillSchema>;
export type AgentManifest = z.infer<typeof agentManifestSchema>;

/**
 * Deployment target environment for an agent build.
 * Determines which compatibility checks are applied during composition.
 */
export type BuildTarget = 'container' | 'lambda' | 'worker' | 'local';

// ============================================================
// ISSUE CONVERSION
// ============================================================

/**
 * Converts a zod issue path array to a dot-notation string prefixed with "manifest.".
 * Examples: ["name"] → "manifest.name", ["extensions", "llm", "package"] → "manifest.extensions.llm.package"
 */
function toManifestPath(path: ReadonlyArray<string | number | symbol>): string {
  if (path.length === 0) return 'manifest';
  return 'manifest.' + path.map(String).join('.');
}

/**
 * Derives the actual type name from a zod invalid_type issue message.
 * Parses "Invalid input: expected {type}, received {actual}" → "{actual}".
 */
function parseReceivedType(message: string): string {
  const match = /received (\w+)/.exec(message);
  return match?.[1] ?? 'unknown';
}

/**
 * Converts a single zod issue to a ManifestIssue with spec-compliant message formatting.
 */
function zodIssueToManifestIssue(issue: z.core.$ZodIssue): ManifestIssue {
  const path = toManifestPath(issue.path);

  if (issue.code === 'invalid_type') {
    const received = parseReceivedType(issue.message);
    if (received === 'undefined') {
      return { path, message: `${path} is required` };
    }
    return {
      path,
      message: `${path}: expected ${issue.expected}, got ${received}`,
    };
  }

  if (issue.code === 'unrecognized_keys') {
    // Report each unknown key as a separate issue path
    const keys = (issue as z.core.$ZodIssueUnrecognizedKeys).keys;
    const keyPath = keys.length === 1 ? `${path}.${keys[0]}` : path;
    return { path: keyPath, message: `${keyPath}: unknown field` };
  }

  // custom issues (semver, runtime format) carry their message directly
  return { path, message: `${path}: ${issue.message}` };
}

// ============================================================
// VALIDATE MANIFEST
// ============================================================

/**
 * Parses and validates raw JSON against the AgentManifest zod schema.
 * Returns the validated manifest on success.
 * Throws ManifestValidationError with structured field paths on failure.
 */
export function validateManifest(json: unknown): AgentManifest {
  const result = agentManifestSchema.safeParse(json);

  if (result.success) {
    return result.data;
  }

  const issues: ManifestIssue[] = result.error.issues.map(
    zodIssueToManifestIssue
  );
  const firstPath = issues[0]?.path ?? 'manifest';
  const firstMessage = issues[0]?.message ?? 'manifest validation failed';

  throw new ManifestValidationError(firstMessage, issues, firstPath);
}
