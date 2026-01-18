/**
 * Script Structure Parsing
 * Script, frontmatter, statements, and annotations
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, isAtEnd, skipNewlines, makeSpan, } from './state.js';
import { parseExpression } from './expressions.js';
import { setParseStatement } from './control-flow.js';
// ============================================================
// SCRIPT PARSING
// ============================================================
export function parseScript(state) {
    const start = current(state).span.start;
    skipNewlines(state);
    // Optional frontmatter
    let frontmatter = null;
    if (check(state, TOKEN_TYPES.FRONTMATTER_DELIM)) {
        frontmatter = parseFrontmatter(state);
    }
    skipNewlines(state);
    // Statements
    const statements = [];
    while (!isAtEnd(state)) {
        skipNewlines(state);
        if (isAtEnd(state))
            break;
        if (state.recoveryMode) {
            // Recovery mode: catch errors and create ErrorNode
            const stmtStart = current(state).span.start;
            try {
                statements.push(parseStatement(state));
            }
            catch (err) {
                if (err instanceof ParseError) {
                    state.errors.push(err);
                    // Create ErrorNode and skip to next statement boundary
                    const errorNode = recoverToNextStatement(state, stmtStart, err.message);
                    statements.push(errorNode);
                }
                else {
                    throw err; // Re-throw non-parse errors
                }
            }
        }
        else {
            // Normal mode: let errors propagate
            statements.push(parseStatement(state));
        }
        skipNewlines(state);
    }
    return {
        type: 'Script',
        frontmatter,
        statements,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Recovery helper: skip tokens until we find a likely statement boundary.
 * Returns an ErrorNode containing the skipped content.
 * @internal
 */
function recoverToNextStatement(state, startLocation, message) {
    const startOffset = startLocation.offset;
    let endOffset = startOffset;
    // Skip tokens until we hit a newline or EOF (statement boundary)
    while (!isAtEnd(state) && !check(state, TOKEN_TYPES.NEWLINE)) {
        endOffset = current(state).span.end.offset;
        advance(state);
    }
    // Extract the skipped text from source
    const text = state.source.slice(startOffset, endOffset);
    return {
        type: 'Error',
        message,
        text,
        span: makeSpan(startLocation, current(state).span.start),
    };
}
// ============================================================
// FRONTMATTER PARSING
// ============================================================
function parseFrontmatter(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.FRONTMATTER_DELIM, 'Expected ---');
    skipNewlines(state);
    // Collect all content until next ---
    let content = '';
    while (!check(state, TOKEN_TYPES.FRONTMATTER_DELIM) && !isAtEnd(state)) {
        const token = advance(state);
        content += token.value;
    }
    expect(state, TOKEN_TYPES.FRONTMATTER_DELIM, 'Expected closing ---');
    return {
        type: 'Frontmatter',
        content: content.trim(),
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// STATEMENT PARSING
// ============================================================
/**
 * Parse a statement: optionally annotated pipe chain expression.
 * Annotations prefix statements with ^(key: value, ...) syntax.
 * Termination (capture/break/return) is now part of PipeChainNode.
 */
export function parseStatement(state) {
    const start = current(state).span.start;
    // Check for annotation prefix: ^(...)
    if (check(state, TOKEN_TYPES.CARET)) {
        return parseAnnotatedStatement(state);
    }
    const expression = parseExpression(state);
    return {
        type: 'Statement',
        expression,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// ANNOTATION PARSING
// ============================================================
/**
 * Parse an annotated statement: ^(key: value, ...) statement
 * Annotations modify operational parameters for statements.
 */
function parseAnnotatedStatement(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.CARET, 'Expected ^');
    expect(state, TOKEN_TYPES.LPAREN, 'Expected (');
    const annotations = parseAnnotationArgs(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected )');
    // Parse the inner statement (which could also be annotated)
    const statement = parseStatement(state);
    // If inner is annotated, wrap it; otherwise use directly
    const innerStatement = statement.type === 'AnnotatedStatement'
        ? {
            type: 'Statement',
            expression: statement.statement.expression,
            span: statement.span,
        }
        : statement;
    return {
        type: 'AnnotatedStatement',
        annotations,
        statement: innerStatement,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse annotation arguments: key: value, *spread, ...
 */
function parseAnnotationArgs(state) {
    const args = [];
    if (check(state, TOKEN_TYPES.RPAREN)) {
        return args; // Empty annotation list
    }
    args.push(parseAnnotationArg(state));
    while (check(state, TOKEN_TYPES.COMMA)) {
        advance(state); // consume comma
        if (check(state, TOKEN_TYPES.RPAREN))
            break; // trailing comma
        args.push(parseAnnotationArg(state));
    }
    return args;
}
/**
 * Parse a single annotation argument: named (key: value) or spread (*expr)
 */
function parseAnnotationArg(state) {
    const start = current(state).span.start;
    // Spread argument: *expr
    if (check(state, TOKEN_TYPES.STAR)) {
        advance(state); // consume *
        const expression = parseExpression(state);
        return {
            type: 'SpreadArg',
            expression,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Named argument: key: value
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected annotation name');
    expect(state, TOKEN_TYPES.COLON, 'Expected :');
    const value = parseExpression(state);
    return {
        type: 'NamedArg',
        name: nameToken.value,
        value,
        span: makeSpan(start, current(state).span.end),
    };
}
// Wire up the circular dependency
setParseStatement(parseStatement);
//# sourceMappingURL=script.js.map