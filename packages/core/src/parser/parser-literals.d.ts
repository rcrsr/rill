/**
 * Parser Extension: Literal Parsing
 * Strings, numbers, booleans, tuples, dicts, and closures
 */
import type { ClosureNode, ClosureParamNode, DictEntryNode, DictNode, ExpressionNode, InterpolationNode, LiteralNode, ListSpreadNode, BodyNode, SourceLocation, StringLiteralNode, TupleNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseLiteral(): LiteralNode;
        parseString(): StringLiteralNode;
        parseStringParts(raw: string, baseLocation: SourceLocation, isTokenMultiline: boolean): (string | InterpolationNode)[];
        parseInterpolationExpr(source: string, baseLocation: SourceLocation): InterpolationNode;
        unescapeBraces(s: string): string;
        parseTupleOrDict(): TupleNode | DictNode;
        parseTuple(start: SourceLocation): TupleNode;
        parseTupleElement(): ExpressionNode | ListSpreadNode;
        parseDict(start: SourceLocation): DictNode;
        parseDictEntry(): DictEntryNode;
        parseClosure(): ClosureNode;
        parseBody(): BodyNode;
        parseClosureParam(): ClosureParamNode;
    }
}
//# sourceMappingURL=parser-literals.d.ts.map