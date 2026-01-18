/**
 * Script Structure Parsing
 * Script, frontmatter, statements, and annotations
 */
import type { AnnotatedStatementNode, ScriptNode, StatementNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function parseScript(state: ParserState): ScriptNode;
/**
 * Parse a statement: optionally annotated pipe chain expression.
 * Annotations prefix statements with ^(key: value, ...) syntax.
 * Termination (capture/break/return) is now part of PipeChainNode.
 */
export declare function parseStatement(state: ParserState): StatementNode | AnnotatedStatementNode;
//# sourceMappingURL=script.d.ts.map