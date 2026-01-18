/**
 * Parser Helpers
 * Lookahead predicates and utility parsing functions
 * @internal This module contains internal parser utilities
 */
import type { BlockNode, PostfixExprNode, SourceSpan } from '../types.js';
import { type ParserState } from './state.js';
/** @internal */
export declare const VALID_TYPE_NAMES: readonly ["string", "number", "bool", "closure", "list", "dict", "tuple"];
/** @internal */
export declare const FUNC_PARAM_TYPES: readonly ["string", "number", "bool"];
/**
 * Check for function call: identifier(
 * @internal
 */
export declare function isHostCall(state: ParserState): boolean;
/**
 * Check for closure call: $name(
 * @internal
 */
export declare function isClosureCall(state: ParserState): boolean;
/**
 * Check for pipe invoke: $( (invoke pipe value as closure)
 * @internal
 */
export declare function canStartPipeInvoke(state: ParserState): boolean;
/**
 * Check for method call: .identifier
 * @internal
 */
export declare function isMethodCall(state: ParserState): boolean;
/**
 * Check for typed capture with arrow: $name:type ->
 * @internal
 */
export declare function isTypedCaptureWithArrow(state: ParserState): boolean;
/**
 * Check for inline capture: $name ->
 * @internal
 */
export declare function isInlineCaptureWithArrow(state: ParserState): boolean;
/**
 * Check for sequential spread target: @$ or @[ (not @{ which is for-loop)
 * @internal
 */
export declare function isClosureChainTarget(state: ParserState): boolean;
/**
 * Check for negative number: -42
 * @internal
 */
export declare function isNegativeNumber(state: ParserState): boolean;
/**
 * Check for dict start: identifier followed by colon
 * @internal
 */
export declare function isDictStart(state: ParserState): boolean;
/**
 * Check for method call with args (for field access termination): .identifier(
 * @internal
 */
export declare function isMethodCallWithArgs(state: ParserState): boolean;
/**
 * Check for literal start (not LPAREN - that's now grouping)
 * @internal
 */
export declare function isLiteralStart(state: ParserState): boolean;
/**
 * Check if current token can start an expression (for bare spread detection)
 * @internal
 */
export declare function canStartExpression(state: ParserState): boolean;
/**
 * Check for closure start: | or ||
 * - |params| body
 * - || body (no-param closure)
 * @internal
 */
export declare function isClosureStart(state: ParserState): boolean;
/**
 * Parse and validate a type name from an identifier token.
 * Throws ParseError if the type is not in the allowed list.
 * @internal
 */
export declare function parseTypeName<T extends string>(state: ParserState, validTypes: readonly T[]): T;
/**
 * Create a block containing a single boolean literal statement
 * @internal
 */
export declare function makeBoolLiteralBlock(value: boolean, span: SourceSpan): BlockNode;
/**
 * Wrap a PostfixExprNode in a block for use in conditionals
 * @internal
 */
export declare function wrapExprInBlock(expr: PostfixExprNode): BlockNode;
//# sourceMappingURL=helpers.d.ts.map