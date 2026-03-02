// ============================================================
// PUBLIC TYPES
// ============================================================
export type {
  LifecyclePhase,
  LogLevel,
  SessionState,
  SessionRecord,
  AgentHostOptions,
  RunRequest,
  RunResponse,
  HealthStatus,
  HostErrorPhase,
} from './core/types.js';

// ============================================================
// ERRORS
// ============================================================
export { AgentHostError } from './core/errors.js';

// ============================================================
// AGENT HOST
// ============================================================
export type {
  AgentHost,
  ComposedAgent,
  AgentCard,
  AgentCapabilities,
  AgentSkill,
} from './host.js';
export { createAgentHost } from './host.js';

// ============================================================
// SERVERLESS HANDLER
// ============================================================
export type {
  APIGatewayEvent,
  LambdaContext,
  HandlerResponse,
  AgentHandler,
} from './handler.js';
export { createAgentHandler } from './handler.js';

// ============================================================
// COMPOSE
// ============================================================
export type { ComposeOptions, ComposedHarness } from './compose.js';
export { composeAgent, composeHarness } from './compose.js';

// ============================================================
// DISPATCH (stdio transport entry point)
// ============================================================
export type { DispatchOptions, DispatchResult } from './core/execution.js';
export { dispatch } from './core/execution.js';
