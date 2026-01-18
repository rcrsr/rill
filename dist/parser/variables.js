/**
 * Variable Parsing
 * Variables and field access
 */
import { TOKEN_TYPES } from '../types.js';
import { check, advance, expect, makeSpan } from './state.js';
import { isMethodCallWithArgs, VALID_TYPE_NAMES, parseTypeName, } from './helpers.js';
// Circular dependency: these will be injected by expressions.ts
let parseBlockFn = null;
let parsePipeChainFn = null;
export function setParseBlock(fn) {
    parseBlockFn = fn;
}
export function setParsePipeChain(fn) {
    parsePipeChainFn = fn;
}
// ============================================================
// VARIABLE PARSING
// ============================================================
export function parseVariable(state) {
    const start = state.tokens[state.pos].span.start;
    if (check(state, TOKEN_TYPES.PIPE_VAR)) {
        advance(state);
        return makeVariableWithAccess(null, true, start, state);
    }
    const dollarToken = expect(state, TOKEN_TYPES.DOLLAR, 'Expected $');
    // Special case: $@ is the accumulator variable (used in each/fold with block form)
    if (dollarToken.value === '$@') {
        return makeVariableWithAccess('@', false, start, state);
    }
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
    return makeVariableWithAccess(nameToken.value, false, start, state);
}
/**
 * Parse variable with field access, bracket access, existence checks, and defaults.
 */
function makeVariableWithAccess(name, isPipeVar, start, state) {
    // Parse mixed dot and bracket access chain (unified, ordered)
    const { accessChain, existenceCheck } = parseAccessChain(state);
    // Parse optional default value: ?? default
    let defaultValue = null;
    if (check(state, TOKEN_TYPES.NULLISH_COALESCE) && !existenceCheck) {
        advance(state); // consume ??
        defaultValue = parseDefaultValue(state);
    }
    // Separate for backward compatibility (deprecated)
    const fields = accessChain.filter((a) => !('accessKind' in a));
    const brackets = accessChain.filter((a) => 'accessKind' in a && a.accessKind === 'bracket');
    return {
        type: 'Variable',
        name,
        isPipeVar,
        accessChain,
        fieldAccess: fields,
        bracketAccess: brackets,
        defaultValue,
        existenceCheck,
        span: makeSpan(start, start), // Updated later
    };
}
/**
 * Parse mixed access chain: dot-based field access and bracket-based index access.
 * Returns unified accessChain maintaining the order of accesses.
 * Also detects existence checks (.?).
 */
function parseAccessChain(state) {
    const accessChain = [];
    let existenceCheck = null;
    while (check(state, TOKEN_TYPES.DOT, TOKEN_TYPES.DOT_QUESTION, TOKEN_TYPES.LBRACKET)) {
        // Check if this is a method call (has parens after identifier)
        if (check(state, TOKEN_TYPES.DOT) && isMethodCallWithArgs(state)) {
            break;
        }
        // Bracket access: [expr]
        if (check(state, TOKEN_TYPES.LBRACKET)) {
            advance(state); // consume [
            if (!parsePipeChainFn) {
                throw new Error('parsePipeChain not injected');
            }
            const expression = parsePipeChainFn(state);
            expect(state, TOKEN_TYPES.RBRACKET, 'Expected ] after index expression');
            accessChain.push({ accessKind: 'bracket', expression });
            continue;
        }
        // Check for existence check: .?
        if (check(state, TOKEN_TYPES.DOT_QUESTION)) {
            advance(state); // consume .?
            const finalAccess = parseFieldAccessElement(state);
            if (!finalAccess) {
                break; // Invalid, stop parsing
            }
            // Check for type constraint: &type
            let typeName = null;
            if (check(state, TOKEN_TYPES.AMPERSAND)) {
                advance(state); // consume &
                typeName = parseTypeName(state, VALID_TYPE_NAMES);
            }
            existenceCheck = { finalAccess, typeName };
            break; // Existence check must be at end
        }
        // Dot access: .field
        advance(state); // consume .
        const access = parseFieldAccessElement(state);
        if (!access) {
            break;
        }
        accessChain.push(access);
    }
    return { accessChain, existenceCheck };
}
/**
 * Parse a single field access element (dot-based, no numeric indices).
 * Returns null if no valid element found.
 * Note: Numeric indices use bracket syntax [0], [-1] instead of dot.
 */
function parseFieldAccessElement(state) {
    // Variable as key: $identifier
    if (check(state, TOKEN_TYPES.DOLLAR)) {
        advance(state); // consume $
        const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name after .$');
        return { kind: 'variable', variableName: nameToken.value };
    }
    // Computed expression or alternatives: (expr) or (a || b)
    if (check(state, TOKEN_TYPES.LPAREN)) {
        return parseComputedOrAlternatives(state);
    }
    // Block returning key: {block}
    if (check(state, TOKEN_TYPES.LBRACE)) {
        if (!parseBlockFn) {
            throw new Error('parseBlock not injected');
        }
        const block = parseBlockFn(state);
        return { kind: 'block', block };
    }
    // Identifier (literal field)
    if (check(state, TOKEN_TYPES.IDENTIFIER)) {
        return { kind: 'literal', field: advance(state).value };
    }
    return null;
}
/**
 * Parse computed expression .(expr) or alternatives .(a || b).
 */
function parseComputedOrAlternatives(state) {
    advance(state); // consume (
    // Look ahead to detect alternatives pattern: identifier || identifier
    // Alternatives are a sequence of identifiers separated by ||
    const alternatives = tryParseAlternatives(state);
    if (alternatives) {
        expect(state, TOKEN_TYPES.RPAREN, 'Expected ) after alternatives');
        return { kind: 'alternatives', alternatives };
    }
    // Otherwise, parse as computed expression
    if (!parsePipeChainFn) {
        throw new Error('parsePipeChain not injected');
    }
    const expression = parsePipeChainFn(state);
    expect(state, TOKEN_TYPES.RPAREN, 'Expected ) after expression');
    return { kind: 'computed', expression };
}
/**
 * Try to parse alternatives: a || b || c
 * Returns array of identifiers if successful, null otherwise.
 */
function tryParseAlternatives(state) {
    // Save position for backtracking
    const savedPos = state.pos;
    const alternatives = [];
    // First identifier
    if (!check(state, TOKEN_TYPES.IDENTIFIER)) {
        return null;
    }
    alternatives.push(advance(state).value);
    // Must have at least one ||
    if (!check(state, TOKEN_TYPES.OR)) {
        // Not alternatives pattern, backtrack
        state.pos = savedPos;
        return null;
    }
    // Parse remaining: || identifier
    while (check(state, TOKEN_TYPES.OR)) {
        advance(state); // consume ||
        if (!check(state, TOKEN_TYPES.IDENTIFIER)) {
            // Invalid alternatives pattern, backtrack
            state.pos = savedPos;
            return null;
        }
        alternatives.push(advance(state).value);
    }
    // Must end with )
    if (!check(state, TOKEN_TYPES.RPAREN)) {
        // Not a valid alternatives pattern, backtrack
        state.pos = savedPos;
        return null;
    }
    return alternatives;
}
/**
 * Parse default value after ??.
 * Can be: block, grouped expression, or simple expression.
 */
function parseDefaultValue(state) {
    if (check(state, TOKEN_TYPES.LBRACE)) {
        if (!parseBlockFn) {
            throw new Error('parseBlock not injected');
        }
        return parseBlockFn(state);
    }
    if (!parsePipeChainFn) {
        throw new Error('parsePipeChain not injected');
    }
    // Parse a simple expression (not a full pipe chain to avoid ambiguity)
    return parsePipeChainFn(state);
}
//# sourceMappingURL=variables.js.map