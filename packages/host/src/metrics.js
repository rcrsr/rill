/**
 * Prometheus metric definitions for rill-host.
 * Each AgentHost instance creates its own Registry via createMetrics().
 */
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
// ============================================================
// FACTORY
// ============================================================
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
export function createMetrics(registry) {
    const reg = registry ?? new Registry();
    const sessionsTotal = new Counter({
        name: 'rill_sessions_total',
        help: 'Total sessions created',
        labelNames: ['state', 'trigger', 'agent'],
        registers: [reg],
    });
    const sessionsActive = new Gauge({
        name: 'rill_sessions_active',
        help: 'Currently running sessions',
        labelNames: ['agent'],
        registers: [reg],
    });
    const executionDurationSeconds = new Histogram({
        name: 'rill_execution_duration_seconds',
        help: 'Script execution duration',
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        labelNames: ['agent'],
        registers: [reg],
    });
    const hostCallsTotal = new Counter({
        name: 'rill_host_calls_total',
        help: 'Host function invocations',
        labelNames: ['function'],
        registers: [reg],
    });
    const hostCallErrorsTotal = new Counter({
        name: 'rill_host_call_errors_total',
        help: 'Failed host function calls',
        labelNames: ['function'],
        registers: [reg],
    });
    const stepsTotal = new Counter({
        name: 'rill_steps_total',
        help: 'Total steps executed',
        registers: [reg],
    });
    return {
        sessionsTotal,
        sessionsActive,
        executionDurationSeconds,
        hostCallsTotal,
        hostCallErrorsTotal,
        stepsTotal,
        getMetricsText() {
            return reg.metrics();
        },
    };
}
//# sourceMappingURL=metrics.js.map