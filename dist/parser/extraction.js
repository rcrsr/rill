/**
 * Extraction Operator Parsing
 * Destructure, slice, and spread operators
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan, } from './state.js';
import { canStartExpression, isDictStart, isNegativeNumber, VALID_TYPE_NAMES, parseTypeName, } from './helpers.js';
import { parseVariable } from './variables.js';
// Forward declarations - will be set to break circular dependencies
let parsePostfixExprFn;
let parseGroupedFn;
export function setParsePostfixExpr(fn) {
    parsePostfixExprFn = fn;
}
export function setParseGrouped(fn) {
    parseGroupedFn = fn;
}
// ============================================================
// SEQUENTIAL SPREAD
// ============================================================
/**
 * Parse sequential spread: @expr (when followed by variable or tuple, not block)
 * Examples: @$closures, @[$f, $g, $h]
 *
 * The spread target is a postfix expression (not a full pipe chain),
 * so `@$fn -> .method` parses as two separate pipe targets.
 */
export function parseClosureChain(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.AT, 'Expected @');
    // Parse the target as a postfix expression (not full pipe chain)
    const postfix = parsePostfixExprFn(state);
    const target = {
        type: 'PipeChain',
        head: postfix,
        pipes: [],
        terminator: null,
        span: postfix.span,
    };
    return {
        type: 'ClosureChain',
        target,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// DESTRUCTURE
// ============================================================
/**
 * Parse destructure: *<elem, elem, ...>
 * Examples:
 *   *<$a, $b, $c>           -- tuple positional
 *   *<name: $n, count: $c>  -- dict key-value
 *   *<$a, _, $c>            -- skip element
 *   *<*<$a, $b>, $c>        -- nested
 */
export function parseDestructure(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.STAR_LT, 'Expected *<');
    const elements = [];
    if (!check(state, TOKEN_TYPES.GT)) {
        elements.push(parseDestructPattern(state));
        while (check(state, TOKEN_TYPES.COMMA)) {
            advance(state);
            if (check(state, TOKEN_TYPES.GT))
                break;
            elements.push(parseDestructPattern(state));
        }
    }
    expect(state, TOKEN_TYPES.GT, 'Expected >');
    return {
        type: 'Destructure',
        elements,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse a single destructure element:
 *   $var or $var:type     -- variable (positional)
 *   key: $var             -- key-value (dict)
 *   _                     -- skip
 *   *<...>                -- nested destructure
 */
function parseDestructPattern(state) {
    const start = current(state).span.start;
    // Nested destructure: *<...>
    if (check(state, TOKEN_TYPES.STAR_LT)) {
        const nested = parseDestructure(state);
        return {
            type: 'DestructPattern',
            kind: 'nested',
            name: null,
            key: null,
            typeName: null,
            nested,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Skip placeholder: _
    if (check(state, TOKEN_TYPES.IDENTIFIER) && current(state).value === '_') {
        advance(state);
        return {
            type: 'DestructPattern',
            kind: 'skip',
            name: null,
            key: null,
            typeName: null,
            nested: null,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Key-value: identifier : $var
    if (isDictStart(state)) {
        const keyToken = advance(state);
        advance(state); // consume :
        expect(state, TOKEN_TYPES.DOLLAR, 'Expected $');
        const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        let typeName = null;
        if (check(state, TOKEN_TYPES.COLON)) {
            advance(state);
            typeName = parseTypeName(state, VALID_TYPE_NAMES);
        }
        return {
            type: 'DestructPattern',
            kind: 'keyValue',
            name: nameToken.value,
            key: keyToken.value,
            typeName,
            nested: null,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Variable: $var or $var:type
    expect(state, TOKEN_TYPES.DOLLAR, 'Expected $, identifier:, or _');
    const nameToken = expect(state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
    let typeName = null;
    if (check(state, TOKEN_TYPES.COLON)) {
        advance(state);
        typeName = parseTypeName(state, VALID_TYPE_NAMES);
    }
    return {
        type: 'DestructPattern',
        kind: 'variable',
        name: nameToken.value,
        key: null,
        typeName,
        nested: null,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// SLICE
// ============================================================
/**
 * Parse slice: /<start:stop:step>
 * All bounds are optional. Supports negative indices.
 * Examples:
 *   /<0:3>      -- elements 0, 1, 2
 *   /<:3>       -- first 3 elements
 *   /<2:>       -- from index 2 to end
 *   /<::2>      -- every 2nd element
 *   /<::-1>     -- reversed
 */
export function parseSlice(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.SLASH_LT, 'Expected /<');
    // Parse start:stop:step
    let sliceStart = null;
    let sliceStop = null;
    let sliceStep = null;
    // Start bound (optional)
    if (!check(state, TOKEN_TYPES.COLON)) {
        sliceStart = parseSliceBound(state);
    }
    expect(state, TOKEN_TYPES.COLON, 'Expected :');
    // Stop bound (optional)
    if (!check(state, TOKEN_TYPES.COLON) && !check(state, TOKEN_TYPES.GT)) {
        sliceStop = parseSliceBound(state);
    }
    // Step (optional, requires second colon)
    if (check(state, TOKEN_TYPES.COLON)) {
        advance(state);
        if (!check(state, TOKEN_TYPES.GT)) {
            sliceStep = parseSliceBound(state);
        }
    }
    expect(state, TOKEN_TYPES.GT, 'Expected >');
    return {
        type: 'Slice',
        start: sliceStart,
        stop: sliceStop,
        step: sliceStep,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse a slice bound: number, variable, or arithmetic expression
 */
function parseSliceBound(state) {
    // Negative number
    if (isNegativeNumber(state)) {
        const start = current(state).span.start;
        advance(state); // consume -
        const numToken = advance(state);
        return {
            type: 'NumberLiteral',
            value: -parseFloat(numToken.value),
            span: makeSpan(start, numToken.span.end),
        };
    }
    // Positive number
    if (check(state, TOKEN_TYPES.NUMBER)) {
        const token = advance(state);
        return {
            type: 'NumberLiteral',
            value: parseFloat(token.value),
            span: token.span,
        };
    }
    // Variable
    if (check(state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
        return parseVariable(state);
    }
    // Grouped expression: ( expr )
    if (check(state, TOKEN_TYPES.LPAREN)) {
        return parseGroupedFn(state);
    }
    throw new ParseError(`Expected slice bound (number, variable, or grouped expression), got: ${current(state).value}`, current(state).span.start);
}
// ============================================================
// SPREAD
// ============================================================
/**
 * Parse spread: *expr
 * Converts tuple/dict to args for unpacking at closure invocation.
 * Examples: *[1, 2, 3], *$tuple, *[x: 1, y: 2]
 */
export function parseSpread(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.STAR, 'Expected *');
    // Bare * (no operand) means $ -> * (implied pipe value spread)
    // This allows: @ { * } as shorthand for @ { $ -> * }
    if (!canStartExpression(state)) {
        return {
            type: 'Spread',
            operand: null, // null indicates use $ implicitly
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Parse the operand (postfix expression)
    const operand = parsePostfixExprFn(state);
    // Wrap the postfix expr in a pipe chain for the expression node
    const operandExpr = {
        type: 'PipeChain',
        head: operand,
        pipes: [],
        terminator: null,
        span: operand.span,
    };
    return {
        type: 'Spread',
        operand: operandExpr,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse spread as pipe target: -> *
 * Converts piped value to args.
 */
export function parseSpreadTarget(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.STAR, 'Expected *');
    return {
        type: 'Spread',
        operand: null, // null indicates pipe target form (uses $ implicitly)
        span: makeSpan(start, current(state).span.end),
    };
}
//# sourceMappingURL=extraction.js.map