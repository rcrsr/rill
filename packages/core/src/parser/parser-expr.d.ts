/**
 * Parser Extension: Expression Parsing
 * Expressions, precedence chain, pipe chains, and pipe targets
 */
import type { ArithHead, BlockNode, CaptureNode, ConditionalNode, DoWhileLoopNode, ExpressionNode, WhileLoopNode, GroupedExprNode, InvokeNode, PipeChainNode, PipeTargetNode, PostfixExprNode, PrimaryNode, SourceLocation, SourceSpan, UnaryExprNode } from '../types.js';
/** Constructs valid as both primary expressions and pipe targets */
type CommonConstruct = ConditionalNode | WhileLoopNode | DoWhileLoopNode | BlockNode | GroupedExprNode;
declare module './parser.js' {
    interface Parser {
        parseExpression(): ExpressionNode;
        parsePipeChain(): PipeChainNode;
        parsePostfixExpr(): PostfixExprNode;
        parsePostfixExprBase(): PostfixExprNode;
        parsePrimary(): PrimaryNode;
        parsePipeTarget(): PipeTargetNode;
        parseCapture(): CaptureNode;
        parseGrouped(): GroupedExprNode;
        parseCommonConstruct(): CommonConstruct | null;
        parseLogicalOr(): ArithHead;
        parseLogicalAnd(): ArithHead;
        parseComparison(): ArithHead;
        parseAdditive(): ArithHead;
        parseMultiplicative(): ArithHead;
        parseUnary(): UnaryExprNode | PostfixExprNode;
        parseInvoke(): InvokeNode;
        implicitPipeVar(span: {
            start: SourceLocation;
            end: SourceLocation;
        }): PostfixExprNode;
        isComparisonOp(): boolean;
        tokenToComparisonOp(tokenType: string): '==' | '!=' | '<' | '>' | '<=' | '>=';
        wrapConditionalInPostfixExpr(conditional: ConditionalNode, span: SourceSpan): PostfixExprNode;
        wrapLoopInPostfixExpr(loop: WhileLoopNode | DoWhileLoopNode, span: SourceSpan): PostfixExprNode;
    }
}
export {};
//# sourceMappingURL=parser-expr.d.ts.map