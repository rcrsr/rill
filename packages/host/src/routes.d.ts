/**
 * HTTP route definitions for rill-host.
 *
 * Registers all endpoints on a Hono app instance.
 */
import type { Hono } from 'hono';
import type { InputSchema } from '@rcrsr/rill-compose';
import type { AgentCard } from './host.js';
import type { LifecyclePhase, RunRequest, RunResponse, HealthStatus, SessionRecord } from './types.js';
/**
 * A single field-level issue found by validateInputParams().
 */
export interface InputValidationIssue {
    readonly param: string;
    readonly message: string;
}
/**
 * Response body shape for a 400 returned when input params fail validation.
 */
export interface InputValidationErrorBody {
    readonly error: 'invalid params';
    readonly fields: readonly InputValidationIssue[];
}
/**
 * Validates params against an InputSchema.
 *
 * - Returns [] when all required params are present and all types match.
 * - Returns ALL failures in a single call — does NOT short-circuit.
 * - Checks required params first, then type mismatches (both can appear).
 * - Issues appear in manifest declaration order (key order of inputSchema).
 * - Missing optional params produce NO issue.
 * - Extra params not in inputSchema produce NO issue (permissive mode).
 * - undefined params is treated as {} — all required params missing.
 * - null for a required param fails the required check.
 */
export declare function validateInputParams(params: Record<string, unknown> | undefined, inputSchema: InputSchema): InputValidationIssue[];
/**
 * Returns a new params object with defaults from inputSchema injected for
 * absent keys. Never mutates the original params object.
 *
 * - Caller-provided values always take precedence.
 * - Params not in inputSchema pass through unchanged.
 * - null is a valid default and will be injected.
 */
export declare function injectDefaults(params: Record<string, unknown>, inputSchema: InputSchema): Record<string, unknown>;
/**
 * A single buffered SSE event for replay to late-connecting clients.
 */
export interface SseEvent {
    readonly event: string;
    readonly data: string;
}
/**
 * Holds the two Maps that host.ts populates during execution
 * and route handlers read from to serve SSE clients.
 */
export interface SseStore {
    readonly eventBuffers: Map<string, SseEvent[]>;
    readonly subscribers: Map<string, (event: SseEvent) => void>;
}
/**
 * Minimal host surface needed by route handlers.
 * Defined locally to avoid circular imports with host.ts.
 * The full AgentHost satisfies this structurally.
 */
export interface RouteHost {
    readonly phase: LifecyclePhase;
    run(input: RunRequest): Promise<RunResponse>;
    stop(): Promise<void>;
    health(): HealthStatus;
    metrics(): Promise<string>;
    sessions(): Promise<SessionRecord[]>;
    /** Delegates to SessionManager.abort(). Returns false if not found or already terminal. */
    abortSession(id: string): boolean;
    /** Delegates to SessionManager.get(). Returns undefined if not found or TTL elapsed. */
    getSession(id: string): Promise<SessionRecord | undefined>;
}
/**
 * Register all HTTP routes on the Hono app.
 *
 * @param app - Hono application instance
 * @param host - Minimal host interface
 * @param card - AgentCard for /.well-known/agent-card.json
 * @param sseStore - Shared SSE event buffers and subscriber callbacks
 * @param inputSchema - Optional input parameter schema for POST /run validation
 */
export declare function registerRoutes(app: Hono, host: RouteHost, card: AgentCard, sseStore: SseStore, inputSchema?: InputSchema | undefined): void;
//# sourceMappingURL=routes.d.ts.map