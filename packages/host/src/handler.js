/**
 * createAgentHandler — serverless handler for Lambda deployment.
 * Translates API Gateway events to RunRequest and returns HandlerResponse.
 * No TCP server is started.
 */
import { randomUUID } from 'node:crypto';
import { execute, createRuntimeContext } from '@rcrsr/rill';
import { SessionManager } from './session.js';
import { createMetrics } from './metrics.js';
// ============================================================
// DEFAULTS
// ============================================================
const DEFAULTS = {
    maxConcurrentSessions: 10,
    sessionTtl: 3600000,
};
// ============================================================
// FACTORY
// ============================================================
/**
 * Returns a serverless handler function for Lambda deployment.
 * EC-4: agent null/undefined → TypeError('agent is required') thrown synchronously.
 * EC-5: Unhandled runtime error → 500 HandlerResponse (not thrown).
 * AC-8: No TCP server created.
 */
export function createAgentHandler(agent) {
    if (agent == null) {
        throw new TypeError('agent is required');
    }
    const sessionManager = new SessionManager({
        maxConcurrentSessions: DEFAULTS.maxConcurrentSessions,
        sessionTtl: DEFAULTS.sessionTtl,
    });
    const metrics = createMetrics();
    return async function handler(event, _context) {
        // Translate API Gateway event to RunRequest
        const input = buildRunRequest(event);
        // Prune expired sessions before creating a new one
        sessionManager.prune();
        const correlationId = randomUUID();
        try {
            const record = sessionManager.create(input, correlationId, agent.card.name);
            const sessionId = record.id;
            metrics.sessionsActive.labels({ agent: agent.card.name }).inc();
            const sessionController = sessionManager.getController(sessionId);
            const controller = sessionController;
            const observability = {
                onStepEnd() {
                    metrics.stepsTotal.inc();
                    record.stepCount++;
                },
                onHostCall(event) {
                    metrics.hostCallsTotal.labels({ function: event.name }).inc();
                },
            };
            const baseContext = agent.context;
            const sessionContext = createRuntimeContext({
                ...(input.params !== undefined && {
                    variables: input.params,
                }),
                ...(baseContext.timeout !== undefined && {
                    timeout: baseContext.timeout,
                }),
                observability,
                signal: controller.signal,
                maxCallStackDepth: baseContext.maxCallStackDepth,
                metadata: {
                    correlationId,
                    sessionId: record.id,
                    agentName: agent.card.name,
                    ...(input.timeout !== undefined && {
                        timeoutDeadline: String(Date.now() + input.timeout),
                    }),
                },
            });
            for (const [name, fn] of baseContext.functions) {
                sessionContext.functions.set(name, fn);
            }
            const executionStart = Date.now();
            try {
                const result = await execute(agent.ast, sessionContext);
                const durationMs = Date.now() - executionStart;
                metrics.executionDurationSeconds
                    .labels({ agent: agent.card.name })
                    .observe(durationMs / 1000);
                record.state = 'completed';
                record.durationMs = durationMs;
                record.result = result.result;
                record.variables = result.variables;
                metrics.sessionsActive.labels({ agent: agent.card.name }).dec();
                metrics.sessionsTotal
                    .labels({
                    state: 'completed',
                    trigger: typeof input.trigger === 'object'
                        ? input.trigger.type
                        : (input.trigger ?? 'api'),
                    agent: agent.card.name,
                })
                    .inc();
                const responseBody = JSON.stringify({
                    sessionId,
                    correlationId,
                    state: 'completed',
                    result: result.result,
                    durationMs,
                });
                return {
                    statusCode: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: responseBody,
                };
            }
            catch (err) {
                const durationMs = Date.now() - executionStart;
                metrics.executionDurationSeconds
                    .labels({ agent: agent.card.name })
                    .observe(durationMs / 1000);
                record.state = 'failed';
                record.durationMs = durationMs;
                record.error = err instanceof Error ? err.message : String(err);
                console.error(`[rill-host] session ${sessionId} failed: ${record.error}`);
                metrics.sessionsActive.labels({ agent: agent.card.name }).dec();
                metrics.sessionsTotal
                    .labels({
                    state: 'failed',
                    trigger: typeof input.trigger === 'object'
                        ? input.trigger.type
                        : (input.trigger ?? 'api'),
                    agent: agent.card.name,
                })
                    .inc();
                const errorMessage = err instanceof Error ? err.message : String(err);
                const errorCode = err != null &&
                    typeof err === 'object' &&
                    'code' in err &&
                    typeof err.code === 'string'
                    ? err.code
                    : 'RUNTIME_ERROR';
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: errorMessage, code: errorCode }),
                };
            }
        }
        catch (err) {
            // Errors from sessionManager.create() (capacity) or other setup errors
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorCode = err != null &&
                typeof err === 'object' &&
                'code' in err &&
                typeof err.code === 'string'
                ? err.code
                : 'SETUP_ERROR';
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: errorMessage, code: errorCode }),
            };
        }
    };
}
// ============================================================
// HELPERS
// ============================================================
/**
 * Translates an API Gateway event body into a RunRequest.
 * Body is expected to be JSON. Invalid or absent body yields empty params.
 */
function buildRunRequest(event) {
    if (event.body === null || event.body === '') {
        return { trigger: 'http' };
    }
    try {
        const parsed = JSON.parse(event.body);
        if (parsed !== null &&
            typeof parsed === 'object' &&
            !Array.isArray(parsed)) {
            const body = parsed;
            const request = { trigger: 'http' };
            if (body['params'] !== undefined &&
                body['params'] !== null &&
                typeof body['params'] === 'object' &&
                !Array.isArray(body['params'])) {
                request.params = body['params'];
            }
            if (typeof body['timeout'] === 'number') {
                request.timeout = body['timeout'];
            }
            if (typeof body['callback'] === 'string') {
                request.callback = body['callback'];
            }
            return request;
        }
    }
    catch {
        // Malformed JSON — return trigger only
    }
    return { trigger: 'http' };
}
//# sourceMappingURL=handler.js.map