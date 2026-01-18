/**
 * Boolean Expression Parsing - Circular Dependency Helpers
 *
 * This module only contains setter functions for breaking circular dependencies.
 * Boolean/logical operators (&&, ||, !) are now part of the main expression grammar
 * in expressions.ts.
 */
import type { BlockNode, GroupedExprNode } from '../types.js';
import type { ParserState } from './state.js';
declare let parseGroupedFn: (state: ParserState) => GroupedExprNode;
export declare function setParseGrouped(fn: (state: ParserState) => GroupedExprNode): void;
declare let parseBlockFn: (state: ParserState) => BlockNode;
export declare function setParseBlock(fn: (state: ParserState) => BlockNode): void;
export { parseGroupedFn, parseBlockFn };
//# sourceMappingURL=boolean.d.ts.map