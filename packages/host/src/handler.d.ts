/**
 * createAgentHandler — serverless handler for Lambda deployment.
 * Translates API Gateway events to RunRequest and returns HandlerResponse.
 * No TCP server is started.
 */
import type { ComposedAgent } from './host.js';
export interface APIGatewayEvent {
    readonly httpMethod: string;
    readonly path: string;
    readonly headers: Record<string, string | undefined>;
    readonly body: string | null;
}
export interface LambdaContext {
    readonly functionName: string;
    readonly awsRequestId: string;
    getRemainingTimeInMillis(): number;
}
export interface HandlerResponse {
    readonly statusCode: number;
    readonly headers: Record<string, string>;
    readonly body: string;
}
export interface AgentHandler {
    (event: APIGatewayEvent, context: LambdaContext): Promise<HandlerResponse>;
}
/**
 * Returns a serverless handler function for Lambda deployment.
 * EC-4: agent null/undefined → TypeError('agent is required') thrown synchronously.
 * EC-5: Unhandled runtime error → 500 HandlerResponse (not thrown).
 * AC-8: No TCP server created.
 */
export declare function createAgentHandler(agent: ComposedAgent): AgentHandler;
//# sourceMappingURL=handler.d.ts.map