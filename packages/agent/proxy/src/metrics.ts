/**
 * Prometheus metrics for rill-agent-proxy.
 * Each proxy instance creates its own Registry (IC-40).
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// ============================================================
// TYPES
// ============================================================

/**
 * All Prometheus metric objects and the registry for one proxy instance.
 * IC-40: per-instance Registry prevents duplicate metric registration in tests.
 */
export interface ProxyMetrics {
  readonly requestsTotal: Counter<'agent' | 'status'>;
  readonly activeProcesses: Gauge<'agent'>;
  readonly requestDurationSeconds: Histogram<'agent'>;
  readonly spawnDurationSeconds: Histogram<'agent'>;
  readonly ahiCallsTotal: Counter<'source' | 'target'>;
  readonly concurrencyRejectionsTotal: Counter<'agent'>;
  readonly childErrorsTotal: Counter<'agent' | 'code'>;
  readonly registry: Registry;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create all proxy Prometheus metrics bound to a fresh per-instance Registry.
 *
 * IC-40: Uses `new Registry()` — never the prom-client global register.
 */
export function createProxyMetrics(): ProxyMetrics {
  const registry = new Registry();

  const requestsTotal = new Counter<'agent' | 'status'>({
    name: 'rill_proxy_requests_total',
    help: 'Total HTTP requests handled by the proxy',
    labelNames: ['agent', 'status'],
    registers: [registry],
  });

  const activeProcesses = new Gauge<'agent'>({
    name: 'rill_proxy_active_processes',
    help: 'Number of currently active child processes',
    labelNames: ['agent'],
    registers: [registry],
  });

  const requestDurationSeconds = new Histogram<'agent'>({
    name: 'rill_proxy_request_duration_seconds',
    help: 'End-to-end request duration in seconds',
    labelNames: ['agent'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const spawnDurationSeconds = new Histogram<'agent'>({
    name: 'rill_proxy_spawn_duration_seconds',
    help: 'Child process spawn and execution duration in seconds',
    labelNames: ['agent'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });

  const ahiCallsTotal = new Counter<'source' | 'target'>({
    name: 'rill_proxy_ahi_calls_total',
    help: 'Total agent-to-agent (AHI) calls mediated by the proxy',
    labelNames: ['source', 'target'],
    registers: [registry],
  });

  const concurrencyRejectionsTotal = new Counter<'agent'>({
    name: 'rill_proxy_concurrency_rejections_total',
    help: 'Requests rejected due to concurrency limits',
    labelNames: ['agent'],
    registers: [registry],
  });

  const childErrorsTotal = new Counter<'agent' | 'code'>({
    name: 'rill_proxy_child_errors_total',
    help: 'Child process errors by agent and error code',
    labelNames: ['agent', 'code'],
    registers: [registry],
  });

  return {
    requestsTotal,
    activeProcesses,
    requestDurationSeconds,
    spawnDurationSeconds,
    ahiCallsTotal,
    concurrencyRejectionsTotal,
    childErrorsTotal,
    registry,
  };
}
