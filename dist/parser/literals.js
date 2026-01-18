/**
 * Literal Parsing
 * Strings, numbers, booleans, tuples, dicts, and closures
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { tokenize } from '../lexer/index.js';
import { createParserState, check, advance, expect, current, skipNewlines, makeSpan, } from './state.js';
import { isDictStart, FUNC_PARAM_TYPES, parseTypeName } from './helpers.js';
// Forward declarations - will be set by expressions.ts to break circular dependency
let parseExpressionFn;
let parseBlockFn;
let parseGroupedFn;
let parsePostfixExprFn;
let parsePipeChainFn;
export function setParseExpression(fn) {
    parseExpressionFn = fn;
}
export function setParseBlock(fn) {
    parseBlockFn = fn;
}
export function setParseGrouped(fn) {
    parseGroupedFn = fn;
}
export function setParsePostfixExpr(fn) {
    parsePostfixExprFn = fn;
}
export function setLiteralsParsePipeChain(fn) {
    parsePipeChainFn = fn;
}
// ============================================================
// LITERAL PARSING
// ============================================================
export function parseLiteral(state) {
    if (check(state, TOKEN_TYPES.STRING)) {
        return parseString(state);
    }
    if (check(state, TOKEN_TYPES.NUMBER)) {
        const token = advance(state);
        return {
            type: 'NumberLiteral',
            value: parseFloat(token.value),
            span: token.span,
        };
    }
    if (check(state, TOKEN_TYPES.TRUE)) {
        const token = advance(state);
        return { type: 'BoolLiteral', value: true, span: token.span };
    }
    if (check(state, TOKEN_TYPES.FALSE)) {
        const token = advance(state);
        return { type: 'BoolLiteral', value: false, span: token.span };
    }
    if (check(state, TOKEN_TYPES.LBRACKET)) {
        return parseTupleOrDict(state);
    }
    // Note: LPAREN no longer starts closures
    // Closures use |params| body syntax (handled by parseClosure)
    // LPAREN now starts grouped expressions (handled by parseGrouped in expressions.ts)
    const token = current(state);
    let hint = '';
    if (token.type === TOKEN_TYPES.ASSIGN) {
        hint = ". Hint: Use '->' for assignment, not '='";
    }
    else if (token.type === TOKEN_TYPES.EOF) {
        hint = '. Hint: Unexpected end of input';
    }
    throw new ParseError(`Expected literal, got: ${token.value}${hint}`, token.span.start);
}
// ============================================================
// STRING PARSING
// ============================================================
/**
 * Parse a string literal, handling interpolation expressions.
 * Interpolation uses {expr} syntax where expr is any valid expression.
 * Escaped braces \{ and \} produce literal braces.
 */
export function parseString(state) {
    const token = advance(state);
    const raw = token.value;
    // Parse interpolation expressions from the string content
    const parts = parseStringParts(raw, token.span.start);
    return {
        type: 'StringLiteral',
        parts,
        isHeredoc: raw.includes('\n'),
        span: token.span,
    };
}
/**
 * Split string content into literal segments and interpolation expressions.
 * Escape syntax: {{ → literal {, }} → literal }
 * Interpolation: {expr} where expr is any valid expression
 */
function parseStringParts(raw, baseLocation) {
    const parts = [];
    let i = 0;
    let literalStart = 0;
    while (i < raw.length) {
        if (raw[i] === '{') {
            // Check for escaped brace {{ - skip and let unescapeBraces handle it
            if (raw[i + 1] === '{') {
                i += 2;
                continue;
            }
            // Found interpolation start - save preceding literal
            if (i > literalStart) {
                const literal = unescapeBraces(raw.slice(literalStart, i));
                if (literal)
                    parts.push(literal);
            }
            // Find matching closing brace (respecting nesting and escapes)
            const exprStart = i + 1;
            let depth = 1;
            i++;
            while (i < raw.length && depth > 0) {
                // Skip escaped braces inside interpolation
                if (raw[i] === '{' && raw[i + 1] === '{') {
                    i += 2;
                    continue;
                }
                if (raw[i] === '}' && raw[i + 1] === '}') {
                    i += 2;
                    continue;
                }
                if (raw[i] === '{')
                    depth++;
                else if (raw[i] === '}')
                    depth--;
                i++;
            }
            if (depth !== 0) {
                throw new ParseError("Unterminated string interpolation. Hint: Check for missing '}' in interpolation", baseLocation);
            }
            // Extract and parse the expression
            const exprSource = raw.slice(exprStart, i - 1);
            if (!exprSource.trim()) {
                throw new ParseError('Empty string interpolation', baseLocation);
            }
            const interpolation = parseInterpolationExpr(exprSource, baseLocation);
            parts.push(interpolation);
            literalStart = i;
        }
        else if (raw[i] === '}' && raw[i + 1] === '}') {
            // Skip escaped closing brace - let unescapeBraces handle it
            i += 2;
        }
        else {
            i++;
        }
    }
    // Add remaining literal segment
    if (literalStart < raw.length) {
        const literal = unescapeBraces(raw.slice(literalStart));
        if (literal)
            parts.push(literal);
    }
    // If no parts, return empty string
    if (parts.length === 0) {
        parts.push('');
    }
    return parts;
}
/**
 * Replace escaped brace sequences with actual braces.
 * {{ → { and }} → }
 */
function unescapeBraces(s) {
    return s.replaceAll('{{', '{').replaceAll('}}', '}');
}
/**
 * Parse an interpolation expression using sub-lexer/parser.
 */
function parseInterpolationExpr(source, baseLocation) {
    // Tokenize the expression
    const tokens = tokenize(source);
    // Filter out newlines and comments for expression parsing
    const filtered = tokens.filter((t) => t.type !== TOKEN_TYPES.NEWLINE && t.type !== TOKEN_TYPES.COMMENT);
    if (filtered.length === 0 || filtered[0]?.type === TOKEN_TYPES.EOF) {
        throw new ParseError('Empty string interpolation', baseLocation);
    }
    // Parse as expression
    const subState = createParserState(filtered);
    const expression = parseExpressionFn(subState);
    // Verify all tokens consumed (except EOF)
    if (subState.tokens[subState.pos]?.type !== TOKEN_TYPES.EOF) {
        throw new ParseError(`Unexpected token in interpolation: ${subState.tokens[subState.pos]?.value}`, baseLocation);
    }
    return {
        type: 'Interpolation',
        expression,
        span: expression.span,
    };
}
// ============================================================
// TUPLE & DICT PARSING
// ============================================================
export function parseTupleOrDict(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.LBRACKET, 'Expected [');
    skipNewlines(state);
    // Empty tuple
    if (check(state, TOKEN_TYPES.RBRACKET)) {
        advance(state);
        return {
            type: 'Tuple',
            elements: [],
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Empty dict [:]
    if (check(state, TOKEN_TYPES.COLON) &&
        state.tokens[state.pos + 1]?.type === TOKEN_TYPES.RBRACKET) {
        advance(state); // :
        advance(state); // ]
        return {
            type: 'Dict',
            entries: [],
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Check if dict (identifier followed by :)
    if (isDictStart(state)) {
        return parseDict(state, start);
    }
    // Tuple
    return parseTuple(state, start);
}
function parseTuple(state, start) {
    const elements = [];
    elements.push(parseExpressionFn(state));
    skipNewlines(state);
    while (check(state, TOKEN_TYPES.COMMA)) {
        advance(state);
        skipNewlines(state);
        if (check(state, TOKEN_TYPES.RBRACKET))
            break;
        elements.push(parseExpressionFn(state));
        skipNewlines(state);
    }
    expect(state, TOKEN_TYPES.RBRACKET, 'Expected ]');
    return {
        type: 'Tuple',
        elements,
        span: makeSpan(start, current(state).span.end),
    };
}
function parseDict(state, start) {
    const entries = [];
    entries.push(parseDictEntry(state));
    skipNewlines(state);
    while (check(state, TOKEN_TYPES.COMMA)) {
        advance(state);
        skipNewlines(state);
        if (check(state, TOKEN_TYPES.RBRACKET))
            break;
        entries.push(parseDictEntry(state));
        skipNewlines(state);
    }
    expect(state, TOKEN_TYPES.RBRACKET, 'Expected ]');
    return {
        type: 'Dict',
        entries,
        span: makeSpan(start, current(state).span.end),
    };
}
function parseDictEntry(state) {
    const start = current(state).span.start;
    const keyToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected key');
    expect(state, TOKEN_TYPES.COLON, 'Expected :');
    const value = parseExpressionFn(state);
    return {
        type: 'DictEntry',
        key: keyToken.value,
        value,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// FUNCTION LITERAL PARSING
// ============================================================
/**
 * Parse closure: |params| body or || body
 * Params can be: |x|, |x: string|, |x: string = "default"|
 *
 * Body can be:
 * - Simple: |x| $x (postfix-expr)
 * - Grouped: |x| ($x * 2) (compound expression)
 * - Block: |x| { $a ↵ $b } (multiple statements)
 */
export function parseClosure(state) {
    const start = current(state).span.start;
    // Handle || as no-param closure
    if (check(state, TOKEN_TYPES.OR)) {
        advance(state); // consume ||
        const body = parseBody(state);
        return {
            type: 'Closure',
            params: [],
            body,
            span: makeSpan(start, body.span.end),
        };
    }
    // Handle |params| body
    expect(state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
    const params = [];
    if (!check(state, TOKEN_TYPES.PIPE_BAR)) {
        params.push(parseClosureParam(state));
        while (check(state, TOKEN_TYPES.COMMA)) {
            advance(state); // consume comma
            params.push(parseClosureParam(state));
        }
    }
    expect(state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
    // Parse simple-body: block, grouped, or postfix-expr
    const body = parseBody(state);
    return {
        type: 'Closure',
        params,
        body,
        span: makeSpan(start, body.span.end),
    };
}
/**
 * Parse simple-body: block, grouped, or postfix-expr
 * No naked compound expressions — arithmetic/pipes/booleans must be grouped.
 *
 * Used by: closures, conditionals, loops
 */
export function parseBody(state) {
    // Block: { ... }
    if (check(state, TOKEN_TYPES.LBRACE)) {
        return parseBlockFn(state);
    }
    // Grouped: ( ... ) - compound expressions go here
    if (check(state, TOKEN_TYPES.LPAREN)) {
        return parseGroupedFn(state);
    }
    // Bare break/return: these become pipe chains with implicit $ head
    // Examples: break, return
    if (check(state, TOKEN_TYPES.BREAK) || check(state, TOKEN_TYPES.RETURN)) {
        return parsePipeChainFn(state);
    }
    // Parse postfix-expr (compound expressions like pipes must be grouped)
    return parsePostfixExprFn(state);
}
/**
 * Parse function parameter: name, name: type, name = default, or name: type = default
 * Type can be inferred from default value when not explicitly specified.
 */
function parseClosureParam(state) {
    const start = current(state).span.start;
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected parameter name');
    let typeName = null;
    let defaultValue = null;
    // Optional type annotation
    if (check(state, TOKEN_TYPES.COLON)) {
        advance(state);
        typeName = parseTypeName(state, FUNC_PARAM_TYPES);
    }
    // Optional default value (with or without type annotation)
    if (check(state, TOKEN_TYPES.ASSIGN)) {
        advance(state);
        defaultValue = parseLiteral(state);
    }
    return {
        type: 'ClosureParam',
        name: nameToken.value,
        typeName,
        defaultValue,
        span: makeSpan(start, current(state).span.end),
    };
}
//# sourceMappingURL=literals.js.map