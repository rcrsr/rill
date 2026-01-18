/**
 * Function and Method Parsing
 * Function calls, method calls, closure calls, and invoke expressions
 */
import type { ExpressionNode, HostCallNode, PipeInvokeNode, MethodCallNode, ClosureCallNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function setParseExpression(fn: (state: ParserState) => ExpressionNode): void;
/**
 * Parse a comma-separated list of arguments.
 * Assumes the opening paren has already been consumed.
 * Does NOT consume the closing paren.
 */
export declare function parseArgumentList(state: ParserState): ExpressionNode[];
export declare function parseHostCall(state: ParserState): HostCallNode;
/** Parse closure call: $fn(args) - invokes closure stored in variable */
export declare function parseClosureCall(state: ParserState): ClosureCallNode;
/** Parse invoke expression: $() or $(args) - invokes pipe value as closure */
export declare function parsePipeInvoke(state: ParserState): PipeInvokeNode;
export declare function parseMethodCall(state: ParserState): MethodCallNode;
//# sourceMappingURL=functions.d.ts.map