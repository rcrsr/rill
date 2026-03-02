import type { RillValue } from '@rcrsr/rill';
import type { AgentManifest } from '@rcrsr/rill-agent-shared';
export type { AgentManifest };

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
  /** Which agent owns this session */
  readonly agentName: string;
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
  /**
   * Original agent manifest passed to composeAgent().
   * When provided alongside RILL_REGISTRY_URL, enables AHI dependency
   * extraction from manifest.extensions.ahi.config.agents.
   */
  readonly manifest?: AgentManifest | undefined;
  /**
   * Override the endpoint URL registered with the registry.
   * Defaults to `http://localhost:<port>` when absent.
   * Set to a LAN IP or public hostname for multi-host deployments.
   */
  readonly registryEndpoint?: string | undefined;
  /**
   * Per-extension config passed at compose time.
   * Keys are extension aliases; values are config objects.
   * When provided alongside RILL_REGISTRY_URL, `config['ahi']['agents']`
   * is used for AHI dependency extraction during registry registration.
   */
  readonly config?: Record<string, Record<string, unknown>> | undefined;
  /**
   * Per-agent concurrency caps. Keys are agent names; values are max concurrent sessions.
   * Only used in multi-agent mode (createAgentHost with Map).
   */
  readonly agentCaps?: Map<string, number> | undefined;
}

/**
 * Payload for triggering a script run.
 */
export interface RunRequest {
  readonly params?: Record<string, unknown>;
  /** Caller-provided correlation ID forwarded for in-process AHI chains (AC-20). */
  readonly correlationId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly timeout?: number | undefined;
  readonly trigger?:
    | 'http'
    | 'queue'
    | 'cron'
    | 'agent'
    | 'api'
    | 'manual'
    | {
        readonly type: 'agent';
        readonly agentName: string;
        readonly sessionId: string;
      };
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
