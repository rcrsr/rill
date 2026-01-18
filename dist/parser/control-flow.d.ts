/**
 * Control Flow Parsing
 * Conditionals, loops, and blocks
 *
 * New loop syntax (v0.0.2):
 *   loop = [ simple-body ] , "@" , simple-body , [ "?" , simple-body ]
 *
 * Semantics (determined at runtime):
 *   - If input is bool and no trailing "?": while loop
 *   - If input is list and no trailing "?": for-each
 *   - If no input and no trailing "?": for-each over $
 *   - If trailing "? cond": do-while
 */
import type { AnnotatedStatementNode, BlockNode, ConditionalNode, DoWhileLoopNode, ExpressionNode, ForLoopNode, BodyNode, StatementNode } from '../types.js';
import { type ParserState } from './state.js';
export declare function setParseStatement(fn: (state: ParserState) => StatementNode | AnnotatedStatementNode): void;
/**
 * Parse piped conditional: ? then_body [! else_body]
 * Called when bare `?` is seen (condition is implicit $).
 */
export declare function parsePipedConditional(state: ParserState): ConditionalNode;
/**
 * Parse conditional after condition is already parsed: ? then_body [! else_body]
 * Called when we've parsed an expression and see `?` following it.
 */
export declare function parseConditionalWithCondition(state: ParserState, conditionBody: BodyNode): ConditionalNode;
/**
 * Parse the rest of a conditional after `?` is consumed.
 * Grammar: then_body [! (conditional | else_body)]
 */
export declare function parseConditionalRest(state: ParserState, condition: BodyNode | null, start: {
    line: number;
    column: number;
    offset: number;
}): ConditionalNode;
/**
 * Parse loop starting with @: @ body [? cond]
 *
 * New syntax:
 *   @ body           - for-each over $
 *   @ body ? cond    - do-while (body first, then check)
 *
 * Called when bare `@` is seen (no input expression).
 */
export declare function parseLoop(state: ParserState, input: ExpressionNode | null): ForLoopNode | DoWhileLoopNode;
/**
 * Parse loop with input: input @ body
 *
 * New syntax:
 *   input @ body     - while (if input is bool) or for-each (if input is list)
 *
 * Called when we've parsed an expression and see `@` following it.
 */
export declare function parseLoopWithInput(state: ParserState, input: BodyNode): ForLoopNode | DoWhileLoopNode;
export declare function parseBlock(state: ParserState): BlockNode;
//# sourceMappingURL=control-flow.d.ts.map