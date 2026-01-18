/**
 * Extraction Operator Parsing
 * Destructure, slice, and spread operators
 */
import type { DestructureNode, GroupedExprNode, PostfixExprNode, ClosureChainNode, SliceNode, SpreadNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function setParsePostfixExpr(fn: (state: ParserState) => PostfixExprNode): void;
export declare function setParseGrouped(fn: (state: ParserState) => GroupedExprNode): void;
/**
 * Parse sequential spread: @expr (when followed by variable or tuple, not block)
 * Examples: @$closures, @[$f, $g, $h]
 *
 * The spread target is a postfix expression (not a full pipe chain),
 * so `@$fn -> .method` parses as two separate pipe targets.
 */
export declare function parseClosureChain(state: ParserState): ClosureChainNode;
/**
 * Parse destructure: *<elem, elem, ...>
 * Examples:
 *   *<$a, $b, $c>           -- tuple positional
 *   *<name: $n, count: $c>  -- dict key-value
 *   *<$a, _, $c>            -- skip element
 *   *<*<$a, $b>, $c>        -- nested
 */
export declare function parseDestructure(state: ParserState): DestructureNode;
/**
 * Parse slice: /<start:stop:step>
 * All bounds are optional. Supports negative indices.
 * Examples:
 *   /<0:3>      -- elements 0, 1, 2
 *   /<:3>       -- first 3 elements
 *   /<2:>       -- from index 2 to end
 *   /<::2>      -- every 2nd element
 *   /<::-1>     -- reversed
 */
export declare function parseSlice(state: ParserState): SliceNode;
/**
 * Parse spread: *expr
 * Converts tuple/dict to args for unpacking at closure invocation.
 * Examples: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
 */
export declare function parseSpread(state: ParserState): SpreadNode;
/**
 * Parse spread as pipe target: -> *
 * Converts piped value to args.
 */
export declare function parseSpreadTarget(state: ParserState): SpreadNode;
//# sourceMappingURL=extraction.d.ts.map