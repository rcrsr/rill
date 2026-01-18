/**
 * Variable Parsing
 * Variables and field access
 */
import type { BlockNode, PipeChainNode, VariableNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function setParseBlock(fn: (state: ParserState) => BlockNode): void;
export declare function setParsePipeChain(fn: (state: ParserState) => PipeChainNode): void;
export declare function parseVariable(state: ParserState): VariableNode;
//# sourceMappingURL=variables.d.ts.map