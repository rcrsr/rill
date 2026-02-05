/**
 * Parser Extension: Variable Parsing
 * Variables and access chains
 */
import type { ExistenceCheck, FieldAccess, PropertyAccess, BodyNode, SourceLocation, VariableNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseVariable(): VariableNode;
        makeVariableWithAccess(name: string | null, isPipeVar: boolean, start: SourceLocation): VariableNode;
        parseAccessChain(): {
            accessChain: PropertyAccess[];
            existenceCheck: ExistenceCheck | null;
        };
        parseFieldAccessElement(isExistenceCheck?: boolean): FieldAccess | null;
        parseComputedOrAlternatives(isExistenceCheck?: boolean): FieldAccess;
        tryParseAlternatives(): string[] | null;
        parseDefaultValue(): BodyNode;
    }
}
//# sourceMappingURL=parser-variables.d.ts.map