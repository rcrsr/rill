/**
 * Parser Extension: Extraction Operator Parsing
 * Destructure, slice, spread, and closure chain
 */
import { Parser } from './parser.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan } from './state.js';
import { canStartExpression, isDictStart, isNegativeNumber, VALID_TYPE_NAMES, parseTypeName, } from './helpers.js';
// ============================================================
// CLOSURE CHAIN
// ============================================================
Parser.prototype.parseClosureChain = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.AT, 'Expected @');
    const postfix = this.parsePostfixExpr();
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
        span: makeSpan(start, current(this.state).span.end),
    };
};
// ============================================================
// DESTRUCTURE
// ============================================================
Parser.prototype.parseDestructure = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.STAR_LT, 'Expected *<');
    const elements = [];
    if (!check(this.state, TOKEN_TYPES.GT)) {
        elements.push(this.parseDestructPattern());
        while (check(this.state, TOKEN_TYPES.COMMA)) {
            advance(this.state);
            if (check(this.state, TOKEN_TYPES.GT))
                break;
            elements.push(this.parseDestructPattern());
        }
    }
    expect(this.state, TOKEN_TYPES.GT, 'Expected >');
    return {
        type: 'Destructure',
        elements,
        span: makeSpan(start, current(this.state).span.end),
    };
};
Parser.prototype.parseDestructPattern = function () {
    const start = current(this.state).span.start;
    if (check(this.state, TOKEN_TYPES.STAR_LT)) {
        const nested = this.parseDestructure();
        return {
            type: 'DestructPattern',
            kind: 'nested',
            name: null,
            key: null,
            typeName: null,
            nested,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    if (check(this.state, TOKEN_TYPES.IDENTIFIER) &&
        current(this.state).value === '_') {
        advance(this.state);
        return {
            type: 'DestructPattern',
            kind: 'skip',
            name: null,
            key: null,
            typeName: null,
            nested: null,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    if (isDictStart(this.state)) {
        const keyToken = advance(this.state);
        advance(this.state);
        expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
        const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
        let typeName = null;
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
        }
        return {
            type: 'DestructPattern',
            kind: 'keyValue',
            name: nameToken.value,
            key: keyToken.value,
            typeName,
            nested: null,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $, identifier:, or _');
    const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, 'Expected variable name');
    let typeName = null;
    if (check(this.state, TOKEN_TYPES.COLON)) {
        advance(this.state);
        typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
    }
    return {
        type: 'DestructPattern',
        kind: 'variable',
        name: nameToken.value,
        key: null,
        typeName,
        nested: null,
        span: makeSpan(start, current(this.state).span.end),
    };
};
// ============================================================
// SLICE
// ============================================================
Parser.prototype.parseSlice = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.SLASH_LT, 'Expected /<');
    let sliceStart = null;
    let sliceStop = null;
    let sliceStep = null;
    // Handle :: as shorthand for empty start and stop (e.g., /<::2> means [::2])
    if (check(this.state, TOKEN_TYPES.DOUBLE_COLON)) {
        advance(this.state); // consume ::
        // Both start and stop are empty, parse step if present
        if (!check(this.state, TOKEN_TYPES.GT)) {
            sliceStep = this.parseSliceBound();
        }
    }
    else {
        // Normal parsing: start:stop:step
        if (!check(this.state, TOKEN_TYPES.COLON)) {
            sliceStart = this.parseSliceBound();
        }
        expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
        // Detect deprecated capture arrow in slice context
        if (check(this.state, TOKEN_TYPES.CAPTURE_ARROW)) {
            throw new ParseError('RILL-P006', 'Capture arrow cannot appear in slice context', current(this.state).span.start);
        }
        if (!check(this.state, TOKEN_TYPES.COLON) &&
            !check(this.state, TOKEN_TYPES.GT)) {
            sliceStop = this.parseSliceBound();
        }
        if (check(this.state, TOKEN_TYPES.COLON)) {
            advance(this.state);
            if (!check(this.state, TOKEN_TYPES.GT)) {
                sliceStep = this.parseSliceBound();
            }
        }
    }
    expect(this.state, TOKEN_TYPES.GT, 'Expected >');
    return {
        type: 'Slice',
        start: sliceStart,
        stop: sliceStop,
        step: sliceStep,
        span: makeSpan(start, current(this.state).span.end),
    };
};
Parser.prototype.parseSliceBound = function () {
    if (isNegativeNumber(this.state)) {
        const start = current(this.state).span.start;
        advance(this.state);
        const numToken = advance(this.state);
        return {
            type: 'NumberLiteral',
            value: -parseFloat(numToken.value),
            span: makeSpan(start, numToken.span.end),
        };
    }
    if (check(this.state, TOKEN_TYPES.NUMBER)) {
        const token = advance(this.state);
        return {
            type: 'NumberLiteral',
            value: parseFloat(token.value),
            span: token.span,
        };
    }
    if (check(this.state, TOKEN_TYPES.DOLLAR, TOKEN_TYPES.PIPE_VAR)) {
        return this.parseVariable();
    }
    if (check(this.state, TOKEN_TYPES.LPAREN)) {
        return this.parseGrouped();
    }
    throw new ParseError('RILL-P001', `Expected slice bound (number, variable, or grouped expression), got: ${current(this.state).value}`, current(this.state).span.start);
};
// ============================================================
// SPREAD
// ============================================================
Parser.prototype.parseSpread = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.STAR, 'Expected *');
    if (!canStartExpression(this.state)) {
        return {
            type: 'Spread',
            operand: null,
            span: makeSpan(start, current(this.state).span.end),
        };
    }
    const operand = this.parsePostfixExpr();
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
        span: makeSpan(start, current(this.state).span.end),
    };
};
Parser.prototype.parseSpreadTarget = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.STAR, 'Expected *');
    return {
        type: 'Spread',
        operand: null,
        span: makeSpan(start, current(this.state).span.end),
    };
};
//# sourceMappingURL=parser-extract.js.map