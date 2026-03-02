export type {
  AgentManifest,
  HarnessManifest,
  HarnessAgentEntry,
  ManifestExtension,
  ManifestHostOptions,
  ManifestDeployOptions,
  InputParamDescriptor,
  InputSchema,
  OutputSchema,
  EnvSource,
  BuildTarget,
  AgentSkill,
} from './schema.js';

export {
  validateManifest,
  validateHarnessManifest,
  detectManifestType,
} from './schema.js';

export type { ComposePhase, ManifestIssue } from './errors.js';
export { ComposeError, ManifestValidationError } from './errors.js';

export type { AgentCard, AgentCapabilities } from './card.js';
export { generateAgentCard } from './card.js';

export type { ComposedAgent } from './composed-agent.js';

export type { InterpolationResult } from './interpolate.js';
export { interpolateEnv } from './interpolate.js';

export { loadEnv } from './env.js';

export type { ResolvedExtension, ResolveOptions } from './resolve.js';
export { resolveExtensions } from './resolve.js';

export type {
  RunRequest,
  RunResponse,
  HandlerContext,
  ComposedHandler,
  ComposedHandlerMap,
} from './handler.js';

export type {
  InProcessRunRequest,
  InProcessRunResponse,
  AgentRunner,
} from './runner.js';

export { checkTargetCompatibility } from './compat.js';
