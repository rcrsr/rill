/**
 * Parser Extension: Collection Operator Parsing
 * each, map, fold, filter
 */
import type { EachExprNode, FilterExprNode, FoldExprNode, IteratorBody, MapExprNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseIteratorBody(): IteratorBody;
        hasAccumulatorPrefix(): boolean;
        parseEachExpr(): EachExprNode;
        parseMapExpr(): MapExprNode;
        parseFoldExpr(): FoldExprNode;
        parseFilterExpr(): FilterExprNode;
    }
}
//# sourceMappingURL=parser-collect.d.ts.map