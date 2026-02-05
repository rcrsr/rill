/**
 * Parser Extension: Script Parsing
 * Script, frontmatter, statements, and annotations
 */
import type { AnnotatedStatementNode, AnnotationArg, RecoveryErrorNode, FrontmatterNode, ScriptNode, StatementNode } from '../types.js';
declare module './parser.js' {
    interface Parser {
        parseScript(): ScriptNode;
        parseFrontmatter(): FrontmatterNode;
        parseStatement(): StatementNode | AnnotatedStatementNode;
        parseAnnotatedStatement(): AnnotatedStatementNode;
        parseAnnotationArgs(): AnnotationArg[];
        parseAnnotationArg(): AnnotationArg;
        recoverToNextStatement(startLocation: {
            line: number;
            column: number;
            offset: number;
        }, message: string): RecoveryErrorNode;
    }
}
//# sourceMappingURL=parser-script.d.ts.map