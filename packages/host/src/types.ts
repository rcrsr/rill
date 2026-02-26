import type { RillTypeName, RillValue } from '@rcrsr/rill';

/**
 * Log verbosity for AgentHost.
 *
 * - 'silent' — no output
 * - 'info'   — lifecycle events only
 * - 'debug'  — lifecycle events + per-session trace
 */
export type LogLevel = 'silent' | 'info' | 'debug';

/** Lifecycle phases for the AgentHost process. */
export type LifecyclePhase = 'init' | 'ready' | 'running' | 'stopped';

/** States a session can be in. */
export type SessionState = 'running' | 'completed' | 'failed';

/**
 * Persistent record for a single script execution session.
 */
export interface SessionRecord {
  readonly id: string;
  state: SessionState;
  /** Date.now() at creation */
  readonly startTime: number;
  /** Set on completion */
  durationMs: number | undefined;
  /** Incremented per onStepEnd */
  stepCount: number;
  variables: Record<string, RillValue>;
  readonly trigger: RunRequest['trigger'];
  readonly correlationId: string;
  /** Execution or delivery error */
  error?: string | undefined;
  /** Set when state === 'completed' */
  result?: RillValue | undefined;
}

/**
 * Configuration options for AgentHost.
 *
 * Defaults:
 * - port: 3000
 * - healthPath: '/healthz'
 * - readyPath: '/readyz'
 * - metricsPath: '/metrics'
 * - drainTimeout: 30000
 * - sessionTtl: 3600000
 * - maxConcurrentSessions: 10
 * - responseTimeout: 30000
 * - logLevel: 'info'
 */
export interface AgentHostOptions {
  readonly port?: number | undefined;
  readonly healthPath?: string | undefined;
  readonly readyPath?: string | undefined;
  readonly metricsPath?: string | undefined;
  readonly drainTimeout?: number | undefined;
  readonly sessionTtl?: number | undefined;
  readonly maxConcurrentSessions?: number | undefined;
  readonly responseTimeout?: number | undefined;
  readonly logLevel?: LogLevel | undefined;
  readonly stateBackend?: StateBackend | undefined;
}

/**
 * Payload for triggering a script run.
 */
export interface RunRequest {
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly trigger?: 'http' | 'queue' | 'cron' | 'agent' | 'api' | 'manual';
  readonly callback?: string | undefined;
}

/**
 * Response returned after initiating or completing a run.
 */
export interface RunResponse {
  readonly sessionId: string;
  readonly correlationId: string;
  readonly state: 'running' | 'completed' | 'failed';
  readonly result?: RillValue | undefined;
  readonly durationMs?: number | undefined;
}

/**
 * Snapshot of host health for the /healthz endpoint.
 */
export interface HealthStatus {
  readonly phase: LifecyclePhase;
  readonly uptimeSeconds: number;
  readonly activeSessions: number;
  readonly extensions: Record<string, 'connected' | 'error'>;
}

/**
 * Phases in which a HostError can originate.
 */
export type HostErrorPhase =
  | 'init'
  | 'lifecycle'
  | 'capacity'
  | 'session'
  | 'signal';

/**
 * Full checkpoint data captured at a specific execution step.
 */
export interface CheckpointData {
  readonly id: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly timestamp: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
  readonly pipeResult: RillValue;
  readonly variables: Record<string, RillValue>;
  readonly variableTypes: Record<string, RillTypeName>;
  readonly extensionState: Record<string, unknown>;
}

/**
 * Lightweight checkpoint summary for listing without full payload.
 */
export interface CheckpointSummary {
  readonly id: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly timestamp: number;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

/**
 * Persisted state for a session, stored by a StateBackend.
 */
export interface PersistedSessionState {
  readonly sessionId: string;
  readonly agentName: string;
  readonly state: SessionState;
  readonly startTime: number;
  readonly lastActivity: number;
  readonly metadata: Record<string, unknown>;
}

/**
 * Pluggable backend for persisting session and checkpoint state.
 */
export interface StateBackend {
  connect(): Promise<void>;
  close(): Promise<void>;

  saveCheckpoint(checkpoint: CheckpointData): Promise<void>;
  loadCheckpoint(sessionId: string): Promise<CheckpointData | null>;
  listCheckpoints(
    agentName: string,
    options?: { limit?: number }
  ): Promise<CheckpointSummary[]>;
  deleteCheckpoint(id: string): Promise<void>;

  getSession(sessionId: string): Promise<PersistedSessionState | null>;
  putSession(sessionId: string, state: PersistedSessionState): Promise<void>;
}
