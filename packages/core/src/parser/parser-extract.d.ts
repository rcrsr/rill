/**
 * Parser Extension: Extraction Operator Parsing
 * Destructure, slice, spread, and closure chain
 */
import type { ClosureChainNode, DestructPatternNode, DestructureNode, SliceBoundNode, SliceNode, SpreadNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseClosureChain(): ClosureChainNode;
        parseDestructure(): DestructureNode;
        parseDestructPattern(): DestructPatternNode;
        parseSlice(): SliceNode;
        parseSliceBound(): SliceBoundNode;
        parseSpread(): SpreadNode;
        parseSpreadTarget(): SpreadNode;
    }
}
//# sourceMappingURL=parser-extract.d.ts.map