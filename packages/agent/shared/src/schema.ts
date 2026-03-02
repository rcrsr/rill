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
  })
  .strict();

// ============================================================
// INPUT / OUTPUT DESCRIPTOR TYPES (declared before schemas for z.lazy annotation)
// ============================================================

export type InputParamDescriptor = {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  required?: boolean | undefined;
  description?: string | undefined;
  default?: unknown;
};

export type OutputSchema = {
  type: 'string' | 'number' | 'bool' | 'list' | 'dict';
  description?: string | undefined;
  fields?: Record<string, OutputSchema> | undefined;
};

// ============================================================
// INPUT / OUTPUT DESCRIPTOR SCHEMAS
// ============================================================

export const inputParamDescriptorSchema = z
  .object({
    type: z.enum(['string', 'number', 'bool', 'list', 'dict']),
    required: z.boolean().optional(),
    description: z.string().optional(),
    default: z.unknown().optional(),
  })
  .strict();

export const outputSchemaSchema: z.ZodType<OutputSchema> = z.lazy(() =>
  z
    .object({
      type: z.enum(['string', 'number', 'bool', 'list', 'dict']),
      description: z.string().optional(),
      fields: z.record(z.string(), outputSchemaSchema).optional(),
    })
    .strict()
);

export const inputSchemaSchema = z.record(
  z.string(),
  inputParamDescriptorSchema
);

export type InputSchema = z.infer<typeof inputSchemaSchema>;

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
    input: inputSchemaSchema.optional(),
    output: outputSchemaSchema.optional(),
  })
  .strict();

// ============================================================
// HARNESS SCHEMAS
// ============================================================

export const harnessAgentEntrySchema = z
  .object({
    name: z.string(),
    entry: z.string(),
    modules: z.record(z.string(), z.string()).optional(),
    extensions: z.record(z.string(), manifestExtensionSchema).optional(),
    maxConcurrency: z.number().optional(),
    input: inputSchemaSchema.optional(),
    output: outputSchemaSchema.optional(),
  })
  .strict();

export const harnessManifestSchema = z
  .object({
    host: z
      .object({
        port: z.number().optional(),
        maxConcurrency: z.number().optional(),
      })
      .strict()
      .optional(),
    shared: z.record(z.string(), manifestExtensionSchema).default({}),
    agents: z.array(harnessAgentEntrySchema).min(1),
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
export type HarnessAgentEntry = z.infer<typeof harnessAgentEntrySchema>;
export type HarnessManifest = z.infer<typeof harnessManifestSchema>;

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
// MANIFEST TYPE DETECTION
// ============================================================

/**
 * Detects whether raw input is an agent manifest or a harness manifest.
 * Returns 'harness' if raw is an object containing an 'agents' key.
 * Returns 'agent' for all other inputs including null, undefined, and primitives.
 * Never throws.
 */
export function detectManifestType(raw: unknown): 'agent' | 'harness' {
  if (typeof raw === 'object' && raw !== null && 'agents' in raw) {
    return 'harness';
  }
  return 'agent';
}

// ============================================================
// VALIDATE HARNESS MANIFEST
// ============================================================

/**
 * Parses and validates raw JSON against the HarnessManifest zod schema.
 * After schema validation, runs custom refinements:
 *   - Duplicate agent names (EC-4)
 *   - Per-agent maxConcurrency sum exceeds host cap (EC-5)
 *   - Namespace collision between shared and per-agent extensions (EC-6)
 * Returns the validated manifest on success.
 * Throws ManifestValidationError with structured field paths on failure.
 */
export function validateHarnessManifest(json: unknown): HarnessManifest {
  const result = harnessManifestSchema.safeParse(json);

  if (!result.success) {
    const issues: ManifestIssue[] = result.error.issues.map(
      zodIssueToManifestIssue
    );
    const firstPath = issues[0]?.path ?? 'manifest';
    const firstMessage = issues[0]?.message ?? 'manifest validation failed';
    throw new ManifestValidationError(firstMessage, issues, firstPath);
  }

  const manifest = result.data;

  // EC-4: Duplicate agent names
  const seen = new Set<string>();
  for (const agent of manifest.agents) {
    if (seen.has(agent.name)) {
      const path = 'manifest.agents';
      const message = `Duplicate agent name: '${agent.name}'`;
      throw new ManifestValidationError(message, [{ path, message }], path);
    }
    seen.add(agent.name);
  }

  // EC-5: Sum of per-agent maxConcurrency exceeds host.maxConcurrency
  const hostCap = manifest.host?.maxConcurrency;
  if (hostCap !== undefined) {
    const sum = manifest.agents.reduce(
      (acc, a) => acc + (a.maxConcurrency ?? 0),
      0
    );
    if (sum > hostCap) {
      const path = 'manifest.host.maxConcurrency';
      const message = `Sum of agent maxConcurrency (${sum}) exceeds host.maxConcurrency (${hostCap})`;
      throw new ManifestValidationError(message, [{ path, message }], path);
    }
  }

  // EC-6: Namespace collision between shared extensions and per-agent extensions
  const sharedKeys = new Set(Object.keys(manifest.shared));
  for (const agent of manifest.agents) {
    if (!agent.extensions) continue;
    for (const ns of Object.keys(agent.extensions)) {
      if (sharedKeys.has(ns)) {
        const path = `manifest.agents.${agent.name}.extensions.${ns}`;
        const message = `Namespace collision on extension '${ns}' between shared and agent '${agent.name}'`;
        throw new ManifestValidationError(message, [{ path, message }], path);
      }
    }
  }

  return manifest;
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
