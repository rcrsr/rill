/**
 * AgentHost — core module that ties together lifecycle, sessions,
 * execution, observability, and HTTP serving.
 */
import type { AgentCard, AgentCapabilities, AgentSkill } from '@rcrsr/rill-compose';
export type { AgentCard, AgentCapabilities, AgentSkill };
import type { AgentHostOptions, LifecyclePhase, RunRequest, RunResponse, HealthStatus, SessionRecord } from './types.js';
export interface ComposedAgent {
    ast: import('@rcrsr/rill').ScriptNode;
    context: import('@rcrsr/rill').RuntimeContext;
    card: AgentCard;
    dispose(): Promise<void>;
    extensions: Record<string, import('@rcrsr/rill').ExtensionResult>;
}
export interface AgentHost {
    readonly phase: LifecyclePhase;
    run(input: RunRequest): Promise<RunResponse>;
    /**
     * Run a specific agent by name.
     * Used by ComposedHarness.bindHost() for in-process AHI routing.
     *
     * EC-6: agentName not in map → AgentHostError('agent "<name>" not found', 'init')
     */
    runForAgent(agentName: string, input: RunRequest): Promise<RunResponse>;
    stop(): Promise<void>;
    health(): HealthStatus;
    metrics(): Promise<string>;
    sessions(): Promise<SessionRecord[]>;
    listen(port?: number): Promise<void>;
    close(): Promise<void>;
    abortSession(id: string): boolean;
    getSession(id: string): Promise<SessionRecord | undefined>;
}
/**
 * Create an AgentHost for a single pre-composed agent.
 * Accepts a pre-composed agent; no init() step required.
 *
 * EC-1: agent null/undefined → TypeError('agent is required')
 */
export declare function createAgentHost(agent: ComposedAgent, options?: AgentHostOptions): AgentHost;
/**
 * Create an AgentHost for multiple pre-composed agents.
 * Routes are mounted under /:agentName/ prefix.
 *
 * EC-6: empty agents map → AgentHostError('agents map must not be empty', 'init')
 */
export declare function createAgentHost(agents: Map<string, ComposedAgent>, options?: AgentHostOptions): AgentHost;
//# sourceMappingURL=host.d.ts.map