/**
 * Parser Extension: Function Parsing
 * Function calls, method calls, closure calls, and type operations
 */
import type { ClosureCallNode, ExpressionNode, HostCallNode, MethodCallNode, PipeInvokeNode, PrimaryNode, SourceSpan, TypeAssertionNode, TypeCheckNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseArgumentList(): ExpressionNode[];
        parseHostCall(): HostCallNode;
        parseClosureCall(): ClosureCallNode;
        parsePipeInvoke(): PipeInvokeNode;
        parseMethodCall(receiverSpan?: SourceSpan | null): MethodCallNode;
        parseTypeOperation(): TypeAssertionNode | TypeCheckNode;
        parsePostfixTypeOperation(primary: PrimaryNode, start: {
            line: number;
            column: number;
            offset: number;
        }): TypeAssertionNode | TypeCheckNode;
    }
}
//# sourceMappingURL=parser-functions.d.ts.map