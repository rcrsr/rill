/**
 * Parser Extension: Collection Operator Parsing
 * each, map, fold, filter
 */
import { Parser } from './parser.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, expect, current, makeSpan, peek } from './state.js';
import { isClosureStart, parseBareHostCall } from './helpers.js';
// ============================================================
// COLLECTION OPERATOR BODY
// ============================================================
Parser.prototype.parseIteratorBody = function () {
    if (isClosureStart(this.state)) {
        return this.parseClosure();
    }
    if (check(this.state, TOKEN_TYPES.LBRACE)) {
        return this.parseBlock();
    }
    if (check(this.state, TOKEN_TYPES.LPAREN)) {
        return this.parseGrouped();
    }
    if (check(this.state, TOKEN_TYPES.DOLLAR) ||
        check(this.state, TOKEN_TYPES.PIPE_VAR)) {
        return this.parseVariable();
    }
    if (check(this.state, TOKEN_TYPES.STAR)) {
        return this.parseSpread();
    }
    // Method shorthand: .method applies method to each element
    if (check(this.state, TOKEN_TYPES.DOT)) {
        return this.parsePostfixExpr();
    }
    // Bare function name: func or ns::func (no parens)
    if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
        return parseBareHostCall(this.state);
    }
    throw new ParseError('RILL-P001', `Expected collection body (closure, block, grouped, variable, spread, method, or function), got: ${current(this.state).value}`, current(this.state).span.start);
};
Parser.prototype.hasAccumulatorPrefix = function () {
    if (!check(this.state, TOKEN_TYPES.LPAREN)) {
        return false;
    }
    let depth = 1;
    let i = 1;
    while (depth > 0) {
        const token = peek(this.state, i);
        if (!token)
            return false;
        if (token.type === TOKEN_TYPES.LPAREN)
            depth++;
        else if (token.type === TOKEN_TYPES.RPAREN)
            depth--;
        i++;
    }
    const afterParen = peek(this.state, i);
    if (!afterParen)
        return false;
    return (afterParen.type === TOKEN_TYPES.LBRACE ||
        afterParen.type === TOKEN_TYPES.PIPE_BAR ||
        afterParen.type === TOKEN_TYPES.OR ||
        afterParen.type === TOKEN_TYPES.LPAREN);
};
// ============================================================
// EACH
// ============================================================
Parser.prototype.parseEachExpr = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.EACH, 'Expected each');
    let accumulator = null;
    if (this.hasAccumulatorPrefix()) {
        accumulator = this.parseGrouped().expression;
    }
    const body = this.parseIteratorBody();
    return {
        type: 'EachExpr',
        body,
        accumulator,
        span: makeSpan(start, current(this.state).span.end),
    };
};
// ============================================================
// MAP
// ============================================================
Parser.prototype.parseMapExpr = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.MAP, 'Expected map');
    const body = this.parseIteratorBody();
    return {
        type: 'MapExpr',
        body,
        span: makeSpan(start, current(this.state).span.end),
    };
};
// ============================================================
// FOLD
// ============================================================
Parser.prototype.parseFoldExpr = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.FOLD, 'Expected fold');
    let accumulator = null;
    if (this.hasAccumulatorPrefix()) {
        accumulator = this.parseGrouped().expression;
    }
    const body = this.parseIteratorBody();
    return {
        type: 'FoldExpr',
        body,
        accumulator,
        span: makeSpan(start, current(this.state).span.end),
    };
};
// ============================================================
// FILTER
// ============================================================
Parser.prototype.parseFilterExpr = function () {
    const start = current(this.state).span.start;
    expect(this.state, TOKEN_TYPES.FILTER, 'Expected filter');
    const body = this.parseIteratorBody();
    return {
        type: 'FilterExpr',
        body,
        span: makeSpan(start, current(this.state).span.end),
    };
};
//# sourceMappingURL=parser-collect.js.map