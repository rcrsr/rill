/**
 * Configuration types and loader for rill-agent-proxy.
 */

import { readFileSync } from 'node:fs';

// ============================================================
// TYPES
// ============================================================

/** Log verbosity level. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Per-request concurrency and queue settings. */
export interface ConcurrencyConfig {
  /** Maximum total concurrent requests across all agents. Default: 10. */
  readonly maxConcurrent: number;
  /** Maximum concurrent requests per agent. Default: 5. */
  readonly maxConcurrentPerAgent: number;
  /** Maximum queued requests (0 = reject immediately when full). Default: 0. */
  readonly queueSize: number;
  /** Milliseconds before a request times out. Default: 60000. */
  readonly requestTimeoutMs: number;
}

/** Top-level proxy server configuration. */
export interface ProxyConfig {
  /** TCP port to listen on. Default: 3000. */
  readonly port?: number | undefined;
  /** Host address to bind. Default: '0.0.0.0'. */
  readonly host?: string | undefined;
  /** Required path to the directory containing agent bundles. */
  readonly bundlesDir: string;
  /** Concurrency and queue tuning. Defaults applied per field. */
  readonly concurrency?: ConcurrencyConfig | undefined;
  /** Per-agent config passed into agent runtime. */
  readonly agentConfig?:
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined;
  /** Minimum log level. Default: 'info'. */
  readonly logLevel?: LogLevel | undefined;
  /** Service registry URL for agent discovery. */
  readonly registryUrl?: string | undefined;
  /** Milliseconds to wait for in-flight requests during shutdown. Default: 30000. */
  readonly drainTimeoutMs?: number | undefined;
}

// ============================================================
// DEFAULTS
// ============================================================

export const DEFAULT_PORT = 3000;
export const DEFAULT_HOST = '0.0.0.0';
export const DEFAULT_DRAIN_TIMEOUT_MS = 30000;
export const DEFAULT_CONCURRENCY: ConcurrencyConfig = {
  maxConcurrent: 10,
  maxConcurrentPerAgent: 5,
  queueSize: 0,
  requestTimeoutMs: 60000,
};

// ============================================================
// LOADER
// ============================================================

/**
 * Load proxy configuration from a JSON file.
 *
 * AC-52: Throws Error if file not found, JSON is invalid, or bundlesDir is missing.
 * The caller is responsible for process.exit(1) on error.
 */
export function loadConfig(path: string): ProxyConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new Error(`Config file not found: ${path}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in config file ${path}: ${msg}`, {
      cause: err,
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Config must be a JSON object, got: ${JSON.stringify(parsed)}`
    );
  }

  const config = parsed as Record<string, unknown>;

  if (!('bundlesDir' in config) || typeof config['bundlesDir'] !== 'string') {
    throw new Error(`Config is missing required field "bundlesDir" in ${path}`);
  }

  return config as unknown as ProxyConfig;
}
