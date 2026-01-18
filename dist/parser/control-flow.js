/**
 * Control Flow Parsing
 * Conditionals, loops, and blocks
 *
 * New loop syntax (v0.0.2):
 *   loop = [ simple-body ] , "@" , simple-body , [ "?" , simple-body ]
 *
 * Semantics (determined at runtime):
 *   - If input is bool and no trailing "?": while loop
 *   - If input is list and no trailing "?": for-each
 *   - If no input and no trailing "?": for-each over $
 *   - If trailing "? cond": do-while
 */
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, isAtEnd, skipNewlines, makeSpan, } from './state.js';
import { parseBody } from './literals.js';
// Forward declarations - will be set to break circular dependencies
let parseStatementFn;
export function setParseStatement(fn) {
    parseStatementFn = fn;
}
// ============================================================
// CONDITIONALS
// ============================================================
/**
 * Parse piped conditional: ? then_body [! else_body]
 * Called when bare `?` is seen (condition is implicit $).
 */
export function parsePipedConditional(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.QUESTION, 'Expected ?');
    return parseConditionalRest(state, null, start);
}
/**
 * Parse conditional after condition is already parsed: ? then_body [! else_body]
 * Called when we've parsed an expression and see `?` following it.
 */
export function parseConditionalWithCondition(state, conditionBody) {
    const start = conditionBody.span.start;
    expect(state, TOKEN_TYPES.QUESTION, 'Expected ?');
    return parseConditionalRest(state, conditionBody, start);
}
/**
 * Parse the rest of a conditional after `?` is consumed.
 * Grammar: then_body [! (conditional | else_body)]
 */
export function parseConditionalRest(state, condition, start) {
    // Parse then branch - can be block, grouped, or postfix-expr
    const thenBranch = parseBody(state);
    // Optional else clause with `!` (not `:`)
    let elseBranch = null;
    if (check(state, TOKEN_TYPES.BANG)) {
        advance(state);
        // Check if this is else-if (another condition followed by ?)
        // We need to parse a simple-body first, then check for ?
        const elseBody = parseBody(state);
        // If followed by ?, this is else-if chaining
        if (check(state, TOKEN_TYPES.QUESTION)) {
            elseBranch = parseConditionalWithCondition(state, elseBody);
        }
        else {
            elseBranch = elseBody;
        }
    }
    return {
        type: 'Conditional',
        input: null,
        condition,
        thenBranch,
        elseBranch,
        span: makeSpan(start, current(state).span.end),
    };
}
// ============================================================
// LOOPS
// ============================================================
/**
 * Parse loop starting with @: @ body [? cond]
 *
 * New syntax:
 *   @ body           - for-each over $
 *   @ body ? cond    - do-while (body first, then check)
 *
 * Called when bare `@` is seen (no input expression).
 */
export function parseLoop(state, input) {
    const start = input ? input.span.start : current(state).span.start;
    expect(state, TOKEN_TYPES.AT, 'Expected @');
    // Parse body - can be block, grouped, or postfix-expr
    const body = parseBody(state);
    // Check for do-while post-condition: @ body ? cond
    if (check(state, TOKEN_TYPES.QUESTION)) {
        advance(state); // consume ?
        const condition = parseBody(state);
        return {
            type: 'DoWhileLoop',
            input,
            body,
            condition,
            span: makeSpan(start, current(state).span.end),
        };
    }
    // Regular loop (for-each or while, determined at runtime)
    return {
        type: 'ForLoop',
        input,
        body,
        span: makeSpan(start, current(state).span.end),
    };
}
/**
 * Parse loop with input: input @ body
 *
 * New syntax:
 *   input @ body     - while (if input is bool) or for-each (if input is list)
 *
 * Called when we've parsed an expression and see `@` following it.
 */
export function parseLoopWithInput(state, input) {
    // Convert BodyNode to ExpressionNode (wrap if needed)
    let inputExpr;
    if (input.type === 'PipeChain') {
        inputExpr = input;
    }
    else {
        // Wrap in PipeChain
        inputExpr = {
            type: 'PipeChain',
            head: input.type === 'PostfixExpr'
                ? input
                : {
                    type: 'PostfixExpr',
                    primary: input,
                    methods: [],
                    span: input.span,
                },
            pipes: [],
            terminator: null,
            span: input.span,
        };
    }
    return parseLoop(state, inputExpr);
}
// ============================================================
// BLOCKS
// ============================================================
export function parseBlock(state) {
    const start = current(state).span.start;
    expect(state, TOKEN_TYPES.LBRACE, 'Expected {');
    skipNewlines(state);
    const statements = [];
    while (!check(state, TOKEN_TYPES.RBRACE) && !isAtEnd(state)) {
        statements.push(parseStatementFn(state));
        skipNewlines(state);
    }
    // Empty blocks are not allowed - blocks must contain at least one statement
    if (statements.length === 0) {
        throw new ParseError('Empty blocks are not allowed', start);
    }
    expect(state, TOKEN_TYPES.RBRACE, 'Expected }');
    return {
        type: 'Block',
        statements,
        span: makeSpan(start, current(state).span.end),
    };
}
//# sourceMappingURL=control-flow.js.map