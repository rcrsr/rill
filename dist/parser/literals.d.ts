/**
 * Literal Parsing
 * Strings, numbers, booleans, tuples, dicts, and closures
 */
import type { BlockNode, DictNode, ExpressionNode, ClosureNode, GroupedExprNode, LiteralNode, PipeChainNode, PostfixExprNode, BodyNode, StringLiteralNode, TupleNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function setParseExpression(fn: (state: ParserState) => ExpressionNode): void;
export declare function setParseBlock(fn: (state: ParserState) => BlockNode): void;
export declare function setParseGrouped(fn: (state: ParserState) => GroupedExprNode): void;
export declare function setParsePostfixExpr(fn: (state: ParserState) => PostfixExprNode): void;
export declare function setLiteralsParsePipeChain(fn: (state: ParserState) => PipeChainNode): void;
export declare function parseLiteral(state: ParserState): LiteralNode;
/**
 * Parse a string literal, handling interpolation expressions.
 * Interpolation uses {expr} syntax where expr is any valid expression.
 * Escaped braces \{ and \} produce literal braces.
 */
export declare function parseString(state: ParserState): StringLiteralNode;
export declare function parseTupleOrDict(state: ParserState): TupleNode | DictNode;
/**
 * Parse closure: |params| body or || body
 * Params can be: |x|, |x: string|, |x: string = "default"|
 *
 * Body can be:
 * - Simple: |x| $x (postfix-expr)
 * - Grouped: |x| ($x * 2) (compound expression)
 * - Block: |x| { $a ↵ $b } (multiple statements)
 */
export declare function parseClosure(state: ParserState): ClosureNode;
/**
 * Parse simple-body: block, grouped, or postfix-expr
 * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
 *
 * Used by: closures, conditionals, loops
 */
export declare function parseBody(state: ParserState): BodyNode;
//# sourceMappingURL=literals.d.ts.map