import type { RillValue } from '@rcrsr/rill';

/**
 * Lifecycle phases for the AgentHost process.
 *
 * 'paused' is excluded — blocked pending core stepper serialization.
 */
export type LifecyclePhase = 'init' | 'ready' | 'running' | 'stopped';

/**
 * States a session can be in.
 *
 * 'paused' is retained for forward compatibility only.
 */
export type SessionState = 'running' | 'paused' | 'completed' | 'failed';

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
  value?: RillValue | undefined;
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
  readonly value?: RillValue | undefined;
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
