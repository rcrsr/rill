/**
 * Expression Parsing
 * Primary expressions, postfix expressions, pipe chains, and pipe targets
 */
import type { CaptureNode, ExpressionNode, GroupedExprNode, PipeChainNode, PipeTargetNode, PostfixExprNode, PrimaryNode, SourceLocation } from '../types.js';
import { type ParserState } from './state.js';
export declare function parseExpression(state: ParserState): ExpressionNode;
export declare function parsePipeChain(state: ParserState): PipeChainNode;
export declare function parsePostfixExpr(state: ParserState): PostfixExprNode;
export declare function parsePrimary(state: ParserState): PrimaryNode;
export declare function parsePipeTarget(state: ParserState): PipeTargetNode;
export declare function parseCapture(state: ParserState): CaptureNode;
export declare function makePipeChain(primary: PrimaryNode, start: SourceLocation): PipeChainNode;
/**
 * Grouped expression: ( expression )
 * Single-expression block with () delimiters.
 * Provides scoping — captures inside are local.
 *
 * Note: Boolean operators (&&, ||, !) are only supported in while loop
 * conditions @(condition), not in general grouped expressions.
 */
export declare function parseGrouped(state: ParserState): GroupedExprNode;
//# sourceMappingURL=expressions.d.ts.map