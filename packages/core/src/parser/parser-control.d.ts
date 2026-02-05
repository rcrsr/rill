/**
 * Parser Extension: Control Flow Parsing
 * Conditionals, loops, and blocks
 */
import type { AssertNode, BlockNode, ConditionalNode, DoWhileLoopNode, ErrorNode, ExpressionNode, WhileLoopNode, BodyNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parsePipedConditional(): ConditionalNode;
        parseConditionalWithCondition(conditionBody: BodyNode): ConditionalNode;
        parseConditionalRest(condition: BodyNode | null, start: {
            line: number;
            column: number;
            offset: number;
        }): ConditionalNode;
        parseLoop(condition: ExpressionNode | null): WhileLoopNode | DoWhileLoopNode;
        parseLoopWithInput(condition: BodyNode): WhileLoopNode | DoWhileLoopNode;
        parseBlock(): BlockNode;
        parseAssert(): AssertNode;
        parseError(requireMessage?: boolean): ErrorNode;
    }
}
//# sourceMappingURL=parser-control.d.ts.map