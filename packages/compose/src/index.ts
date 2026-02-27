// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  ComposePhase,
  ManifestIssue,
  AgentManifest,
  BuildTarget,
  ManifestExtension,
  ManifestHostOptions,
  ManifestDeployOptions,
  InputParamDescriptor,
  InputSchema,
  OutputSchema,
  EnvSource,
  HarnessManifest,
  HarnessAgentEntry,
  ExtensionFactory,
  AgentCard,
  AgentCapabilities,
  AgentSkill,
  ResolvedExtension,
  ResolveOptions,
  InitOptions,
  ComposeOptions,
  ComposedAgent,
  ComposedHarness,
  AgentRunner,
} from './compose.js';

// ============================================================
// ERRORS
// ============================================================
export { ComposeError, ManifestValidationError } from './compose.js';

// ============================================================
// VALIDATION
// ============================================================
export {
  validateManifest,
  validateHarnessManifest,
  detectManifestType,
} from './compose.js';

// ============================================================
// EXTENSIONS
// ============================================================
export { resolveExtensions } from './compose.js';

// ============================================================
// COMPATIBILITY
// ============================================================
export { checkTargetCompatibility } from './compose.js';

// ============================================================
// PROJECT INIT
// ============================================================
export { initProject } from './compose.js';

// ============================================================
// COMPOSE
// ============================================================
export { composeAgent, composeHarness } from './compose.js';
