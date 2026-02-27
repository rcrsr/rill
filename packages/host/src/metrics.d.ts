/**
 * Prometheus metric definitions for rill-host.
 * Each AgentHost instance creates its own Registry via createMetrics().
 */
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
/**
 * All metric objects and the registry text exporter for one AgentHost instance.
 */
export interface MetricsBundle {
    readonly sessionsTotal: Counter<'state' | 'trigger' | 'agent'>;
    readonly sessionsActive: Gauge<'agent'>;
    readonly executionDurationSeconds: Histogram<'agent'>;
    readonly hostCallsTotal: Counter<'function'>;
    readonly hostCallErrorsTotal: Counter<'function'>;
    readonly stepsTotal: Counter;
    getMetricsText(): Promise<string>;
}
/**
 * Creates all rill-host Prometheus metrics bound to a single registry.
 * Pass an existing Registry for testing or multi-host isolation.
 * When no registry is provided, a fresh one is created.
 *
 * AC-16: sessionsTotal, sessionsActive, executionDurationSeconds carry
 *        an 'agent' label so /metrics output is filterable per agent.
 * AC-17: Each AgentHost calls createMetrics() with its own Registry,
 *        preventing duplicate metric registration across host instances.
 */
export declare function createMetrics(registry?: Registry): MetricsBundle;
//# sourceMappingURL=metrics.d.ts.map