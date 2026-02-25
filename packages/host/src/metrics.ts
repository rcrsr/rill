/**
 * Prometheus metric definitions for rill-host.
 * Uses a dedicated Registry (not the default global registry).
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// ============================================================
// REGISTRY
// ============================================================

const registry = new Registry();

// ============================================================
// METRICS
// ============================================================

/**
 * Total sessions created, labeled by state and trigger.
 */
export const sessionsTotal = new Counter<'state' | 'trigger'>({
  name: 'rill_sessions_total',
  help: 'Total sessions created',
  labelNames: ['state', 'trigger'],
  registers: [registry],
});

/**
 * Number of sessions currently running.
 */
export const sessionsActive = new Gauge({
  name: 'rill_sessions_active',
  help: 'Currently running sessions',
  registers: [registry],
});

/**
 * Script execution duration in seconds.
 * Buckets cover 5ms to 10s range.
 */
export const executionDurationSeconds = new Histogram({
  name: 'rill_execution_duration_seconds',
  help: 'Script execution duration',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * Total host function invocations, labeled by function name.
 */
export const hostCallsTotal = new Counter<'function'>({
  name: 'rill_host_calls_total',
  help: 'Host function invocations',
  labelNames: ['function'],
  registers: [registry],
});

/**
 * Failed host function calls, labeled by function name.
 */
export const hostCallErrorsTotal = new Counter<'function'>({
  name: 'rill_host_call_errors_total',
  help: 'Failed host function calls',
  labelNames: ['function'],
  registers: [registry],
});

/**
 * Total steps executed across all sessions.
 */
export const stepsTotal = new Counter({
  name: 'rill_steps_total',
  help: 'Total steps executed',
  registers: [registry],
});

// ============================================================
// TEXT EXPORT
// ============================================================

/**
 * Returns Prometheus text format for all rill_* metrics.
 * Used by the /metrics HTTP endpoint.
 */
export async function getMetricsText(): Promise<string> {
  return registry.metrics();
}
