/**
 * Signal handlers for graceful shutdown and immediate abort.
 *
 * Register once during listen(). Not idempotent.
 */
/**
 * Minimal host shape required by signal handlers.
 * The full AgentHost satisfies this structurally.
 * Defined locally to avoid a circular import with host.ts.
 */
interface SignalHost {
    stop(): Promise<void>;
}
/**
 * Register SIGTERM and SIGINT handlers on the current process.
 * Call once during listen(). Not idempotent.
 *
 * SIGTERM: stop accepting sessions, drain up to drainTimeout ms,
 *   exit 0 (clean) or exit 1 (timeout).
 * SIGINT: abort all sessions immediately, exit 1.
 */
export declare function registerSignalHandlers(host: SignalHost, drainTimeout: number): void;
export {};
//# sourceMappingURL=signals.d.ts.map