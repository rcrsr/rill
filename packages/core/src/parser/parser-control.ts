/**
 * Parser Extension: Control Flow Parsing
 * Conditionals, loops, and blocks
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  AssertNode,
  BlockNode,
  ConditionalNode,
  DictNode,
  DoWhileLoopNode,
  ErrorNode,
  ExpressionNode,
  GroupedExprNode,
  GuardBlockNode,
  PipeChainNode,
  PostfixExprNode,
  RecoveryErrorNode,
  RetryBlockNode,
  StringLiteralNode,
  TimeoutBlockNode,
  WhileLoopNode,
  BodyNode,
  StatementNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES, isPipeChainNode } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  isAtEnd,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  makeSpan,
  type ParserState,
} from './state.js';
import { checkWrittenOn, parseParenOptions } from './parser-options.js';
import { ERROR_IDS } from '../error-registry.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePipedConditional(): ConditionalNode;
    parseConditionalWithCondition(conditionBody: BodyNode): ConditionalNode;
    parseConditionalRest(
      condition: BodyNode | null,
      start: { line: number; column: number; offset: number }
    ): ConditionalNode;
    parseLoop(): DoWhileLoopNode;
    parseWhileLoop(): WhileLoopNode;
    parseLoopWithInput(seed: BodyNode): WhileLoopNode | DoWhileLoopNode;
    parseBlock(allowEmpty?: boolean): BlockNode;
    parseAssert(): AssertNode;
    parseError(requireMessage?: boolean): ErrorNode;
    parseGuardBlock(): GuardBlockNode | RecoveryErrorNode;
    parseRetryBlock(): RetryBlockNode | RecoveryErrorNode;
    parseTimeoutBlock(): TimeoutBlockNode;
    parseBody(): BodyNode;
  }
}

/**
 * Parse a conditional branch or loop body: a block, a grouped expression, a
 * break/return/yield chain, or a postfix expression.
 */
Parser.prototype.parseBody = function (this: Parser): BodyNode {
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    return this.parseBlock();
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    return this.parseGrouped();
  }

  if (
    check(this.state, TOKEN_TYPES.BREAK) ||
    check(this.state, TOKEN_TYPES.RETURN) ||
    check(this.state, TOKEN_TYPES.YIELD)
  ) {
    return this.parsePipeChain();
  }

  return this.parsePostfixExpr();
};

// ============================================================
// CONDITIONALS
// ============================================================

// Tokens that would continue a branch's postfix-expr into a wider
// binary/arithmetic/logical/comparison expression. The conditional-branch
// grammar restricts each branch to block | grouped-expr | postfix-expr, so
// parseBody() only ever returns one of those three shapes; it never
// produces a BinaryExpr itself. Without this check, a branch like
// `1 + 1` silently parses only the `1` as the then-branch and leaves
// `+ 1` dangling for the next construct to misparse (e.g. as part of a
// following unary `!` statement). Immediate adjacency (no intervening
// NEWLINE token) is required to trigger the error, so a branch legitimately
// ending at end-of-line is unaffected.
const BRANCH_CONTINUATION_TOKENS = [
  TOKEN_TYPES.PLUS,
  TOKEN_TYPES.MINUS,
  TOKEN_TYPES.STAR,
  TOKEN_TYPES.SLASH,
  TOKEN_TYPES.PERCENT,
  TOKEN_TYPES.EQ,
  TOKEN_TYPES.NE,
  TOKEN_TYPES.LT,
  TOKEN_TYPES.GT,
  TOKEN_TYPES.LE,
  TOKEN_TYPES.GE,
  TOKEN_TYPES.AND,
  TOKEN_TYPES.OR,
] as const;

/**
 * Raises a parse error when a just-parsed conditional branch is immediately
 * followed by a binary operator, which would only be reachable by parsing
 * the branch as a full expression instead of the grammar-restricted
 * block | grouped-expr | postfix-expr shape.
 */
function assertBranchShapeBoundary(state: ParserState): void {
  if (check(state, ...BRANCH_CONTINUATION_TOKENS)) {
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      'conditional branch must be a block, grouped expression, or postfix expression; wrap in parentheses',
      current(state).span.start
    );
  }
}

Parser.prototype.parsePipedConditional = function (
  this: Parser
): ConditionalNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');

  return this.parseConditionalRest(null, start);
};

Parser.prototype.parseConditionalWithCondition = function (
  this: Parser,
  conditionBody: BodyNode
): ConditionalNode {
  const start = conditionBody.span.start;
  expect(this.state, TOKEN_TYPES.QUESTION, 'Expected ?');

  return this.parseConditionalRest(conditionBody, start);
};

/**
 * Parses a conditional branch. A block branch may carry a `:T` assertion or
 * `:?T` check suffix, built in the same postfix shape as `$x:T`.
 */
function parseBranchBody(parser: Parser): BodyNode {
  const body = parser.parseBody();
  if (body.type !== 'Block' || !check(parser.state, TOKEN_TYPES.COLON)) {
    return body;
  }
  const operand: PostfixExprNode = {
    type: 'PostfixExpr',
    primary: body,
    methods: [],
    defaultValue: null,
    existenceCheck: null,
    span: body.span,
  };
  const typeOp = parser.parsePostfixTypeOperation(operand);
  return {
    type: 'PostfixExpr',
    primary: typeOp,
    methods: [],
    defaultValue: null,
    existenceCheck: null,
    span: typeOp.span,
  };
}

Parser.prototype.parseConditionalRest = function (
  this: Parser,
  condition: BodyNode | null,
  start: { line: number; column: number; offset: number }
): ConditionalNode {
  // A trailing `?` at end of line continues onto the then-branch on the
  // next line.
  skipNewlines(this.state);
  const thenBranch = parseBranchBody(this);
  assertBranchShapeBoundary(this.state);

  let elseBranch: BodyNode | ConditionalNode | null = null;
  skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.BANG);
  if (check(this.state, TOKEN_TYPES.BANG)) {
    advance(this.state);
    // A trailing `!` at end of line continues onto the else-branch on the
    // next line.
    skipNewlines(this.state);

    const elseBody = parseBranchBody(this);
    assertBranchShapeBoundary(this.state);

    // Site 5: Add newline lookahead before ? check for else-if
    if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION)) {
      elseBranch = this.parseConditionalWithCondition(elseBody);
    } else {
      elseBranch = elseBody;
    }
  }

  const end = elseBranch !== null ? elseBranch.span.end : thenBranch.span.end;

  return {
    type: 'Conditional',
    input: null,
    condition,
    thenBranch,
    elseBranch,
    span: makeSpan(start, end),
  };
};

// ============================================================
// LOOPS
// ============================================================

/**
 * Parse a do-while loop: `do [(limit: N)] { body } while ( cond )`.
 *
 * Precondition: current token is DO.
 * Produces a DoWhileLoopNode. `input` is null (set by parseLoopWithInput when
 * called from a pipe chain). Trailing `while (cond)` is required.
 */
Parser.prototype.parseLoop = function (this: Parser): DoWhileLoopNode {
  const start = current(this.state).span.start;

  // Consume `do`; parse optional construct options.
  expect(this.state, TOKEN_TYPES.DO, 'Expected `do`');
  const options = parseParenOptions(this, 'do');

  // A newline between `do`/`do(opts)` and the body block is allowed.
  skipNewlines(this.state);
  const body = this.parseBlock();

  // Require trailing `while (cond)`.
  skipNewlines(this.state);
  if (!check(this.state, TOKEN_TYPES.WHILE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: `do { body }` requires trailing `while (cond)` in post-loop form',
      current(this.state).span.start
    );
  }
  advance(this.state); // consume `while`

  if (!check(this.state, TOKEN_TYPES.LPAREN)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: `while` requires `(condition)` before `do`',
      current(this.state).span.start
    );
  }
  advance(this.state); // consume `(`
  skipNewlines(this.state);
  const condition = this.parseExpression();
  skipNewlines(this.state);
  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);

  // parseExpression() itself only ever produces PipeChainNode on a
  // successful parse; PartialExpressionNode is only emitted by the
  // statement-level recovery salvage in parseScript(), never from here.
  if (!isPipeChainNode(condition)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: expected a complete expression in `while` condition',
      current(this.state).span.start
    );
  }

  return {
    type: 'DoWhileLoop',
    input: null,
    body,
    condition,
    options,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

/**
 * Parse a while loop: `while ( cond ) do [(limit: N)] { body }`.
 *
 * Precondition: current token is WHILE.
 * Produces a WhileLoopNode. `do` / `do(limit: N)` is required on the same
 * line as `while (cond)`. Across a newline, a bare `{ body }` is accepted
 * as shorthand for `do { body }`: `while (cond)\n{ body }` and
 * `while (cond)\ndo { body }` parse to equivalent nodes. `while (cond) {
 * body }` on one line still requires `do`.
 *
 * Error contracts:
 *   missing `(cond)`        → RILL-P004
 *   missing `do` and no `{` → RILL-P004
 */
Parser.prototype.parseWhileLoop = function (this: Parser): WhileLoopNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume `while`

  // Require `( cond )`.
  if (!check(this.state, TOKEN_TYPES.LPAREN)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: `while` requires `(condition)` before `do`',
      current(this.state).span.start
    );
  }
  advance(this.state); // consume `(`
  skipNewlines(this.state);
  const condition: ExpressionNode = this.parseExpression();
  skipNewlines(this.state);
  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);

  // `do` / `do(opts)` is required, except when a newline separates
  // `while (cond)` from a bare `{` block: `while (cond)\n{ body }` is then
  // accepted as shorthand for `while (cond)\ndo { body }` — the two forms
  // parse to equivalent nodes. On the same line, `do` still stays
  // mandatory: `while (cond) { body }` remains a RILL-P004 error.
  const hadNewlineBeforeDo = check(this.state, TOKEN_TYPES.NEWLINE);
  const bareBlockFollowsNewline =
    hadNewlineBeforeDo &&
    skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.LBRACE);
  if (!bareBlockFollowsNewline) {
    skipNewlines(this.state);
  }

  if (
    !check(this.state, TOKEN_TYPES.DO) &&
    !(bareBlockFollowsNewline && check(this.state, TOKEN_TYPES.LBRACE))
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: expected `do` after `while (cond)`',
      current(this.state).span.start
    );
  }

  let options: DictNode | null = null;
  if (check(this.state, TOKEN_TYPES.DO)) {
    advance(this.state); // consume `do`
    options = parseParenOptions(this, 'do');
  }
  // else: bare `{` stands in for `do {` — nothing to consume here.

  // A newline between `do`/`do(opts)` and the body block is allowed.
  skipNewlines(this.state);
  const body = this.parseBlock();

  return {
    type: 'WhileLoop',
    condition,
    body,
    options,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

/**
 * Thin dispatcher: routes a pipe-seeded loop to parseWhileLoop or parseLoop
 * based on the next token.
 *
 * - WHILE token  → parseWhileLoop(); seed is threaded into the condition head
 *   so the seed value is the initial $ when the condition first evaluates.
 * - DO → parseLoop(); seed threads into DoWhileLoopNode.input.
 */
Parser.prototype.parseLoopWithInput = function (
  this: Parser,
  seed: BodyNode
): WhileLoopNode | DoWhileLoopNode {
  if (check(this.state, TOKEN_TYPES.WHILE)) {
    const node = this.parseWhileLoop();

    // Thread seed into WhileLoopNode.condition as the pipe head.
    // Wrap the existing condition in a GroupedExprNode so it can serve as a
    // PipeTargetNode (GroupedExprNode is in the PipeTargetNode union).
    // parseWhileLoop() currently only produces a PipeChainNode condition;
    // PartialExpressionNode is reserved for parser error recovery.
    if (!isPipeChainNode(node.condition)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        'Parse error: expected a complete expression in `while` condition',
        node.condition.span.start
      );
    }
    const wrappedCondition: GroupedExprNode = {
      type: 'GroupedExpr',
      expression: node.condition,
      span: node.condition.span,
    };

    let newCondition: PipeChainNode;
    if (seed.type === 'PipeChain') {
      // Seed is already a PipeChainNode — use its head directly and append
      // the wrapped condition as the next pipe stage.
      newCondition = {
        type: 'PipeChain',
        head: seed.head,
        pipes: [...seed.pipes, wrappedCondition],
        terminator: null,
        span: makeSpan(seed.span.start, node.condition.span.end),
      };
    } else {
      // Non-PipeChain BodyNode variants (BlockNode, GroupedExprNode,
      // PostfixExprNode) are all valid PrimaryNode members.
      const seedHead: PostfixExprNode =
        seed.type === 'PostfixExpr'
          ? seed
          : {
              type: 'PostfixExpr',
              primary: seed,
              methods: [],
              defaultValue: null,
              span: seed.span,
            };
      newCondition = {
        type: 'PipeChain',
        head: seedHead,
        pipes: [wrappedCondition],
        terminator: null,
        span: makeSpan(seed.span.start, node.condition.span.end),
      };
    }

    return { ...node, condition: newCondition };
  }

  // DO: parse the do-while body then attach seed as input.
  const node = this.parseLoop();

  // Build the seed as ExpressionNode to satisfy DoWhileLoopNode.input type.
  let seedExpr: ExpressionNode;
  if (seed.type === 'PipeChain') {
    seedExpr = seed;
  } else {
    const head: PostfixExprNode =
      seed.type === 'PostfixExpr'
        ? seed
        : {
            type: 'PostfixExpr',
            primary: seed,
            methods: [],
            defaultValue: null,
            span: seed.span,
          };
    seedExpr = {
      type: 'PipeChain',
      head,
      pipes: [],
      terminator: null,
      span: seed.span,
    };
  }

  return {
    ...node,
    input: seedExpr,
  };
};

// ============================================================
// BLOCKS
// ============================================================

Parser.prototype.parseBlock = function (
  this: Parser,
  allowEmpty?: boolean
): BlockNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LBRACE, 'Expected {');
  return parseBlockStatements(this, start, allowEmpty === true);
};

/**
 * Parse the statements of a block up to and including the closing `}`.
 * The opening `{` has already been consumed; `start` is its position.
 */
function parseBlockStatements(
  parser: Parser,
  start: { line: number; column: number; offset: number },
  allowEmpty: boolean
): BlockNode {
  skipNewlines(parser.state);

  const statements: (StatementNode | AnnotatedStatementNode)[] = [];
  while (!check(parser.state, TOKEN_TYPES.RBRACE) && !isAtEnd(parser.state)) {
    statements.push(parser.parseStatement());
    skipNewlines(parser.state);
  }

  if (statements.length === 0 && !allowEmpty) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Empty blocks are not allowed',
      start
    );
  }

  const rbrace = expect(parser.state, TOKEN_TYPES.RBRACE, 'Expected }');

  return {
    type: 'Block',
    statements,
    span: makeSpan(start, rbrace.span.end),
  };
}

// ============================================================
// ASSERT
// ============================================================

Parser.prototype.parseAssert = function (this: Parser): AssertNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.ASSERT, 'Expected assert');

  // Parse condition as a body (block, grouped expr, or pipe chain)
  // For grouped expressions, this stops at the closing paren
  // For other expressions, parse the full pipe chain
  let condition: ExpressionNode;
  if (
    check(this.state, TOKEN_TYPES.LPAREN) ||
    check(this.state, TOKEN_TYPES.LBRACE)
  ) {
    // For grouped expr or block, parseBody stops at the delimiter
    const body = this.parseBody();
    if (body.type === 'PipeChain') {
      condition = body;
    } else if (body.type === 'PostfixExpr') {
      // Already a PostfixExpr, wrap in PipeChain
      condition = {
        type: 'PipeChain',
        head: body,
        pipes: [],
        terminator: null,
        span: body.span,
      };
    } else {
      // Wrap Block/GroupedExpr in a PipeChain
      condition = {
        type: 'PipeChain',
        head: {
          type: 'PostfixExpr',
          primary: body,
          methods: [],
          defaultValue: null,
          span: body.span,
        },
        pipes: [],
        terminator: null,
        span: body.span,
      };
    }
  } else {
    // For non-delimited expressions, parse the full expression
    condition = this.parseExpression();
  }

  let message: StringLiteralNode | null = null;
  if (check(this.state, TOKEN_TYPES.STRING)) {
    message = this.parseString();
  }

  return {
    type: 'Assert',
    condition,
    message,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

// ============================================================
// ERROR
// ============================================================

Parser.prototype.parseError = function (
  this: Parser,
  requireMessage = false
): ErrorNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.ERROR, 'Expected error');

  // Message is optional when used as pipe target: "msg" -> error
  // Required when used as direct statement: error "msg"
  let message: StringLiteralNode | null = null;

  if (check(this.state, TOKEN_TYPES.STRING)) {
    // String literal provided - parse it
    message = this.parseString();
  } else {
    // No string literal after error keyword
    const atBoundary =
      isAtEnd(this.state) ||
      check(this.state, TOKEN_TYPES.NEWLINE) ||
      check(this.state, TOKEN_TYPES.RBRACE) ||
      check(this.state, TOKEN_TYPES.RPAREN);

    if (!atBoundary) {
      // Non-string, non-delimiter token after error - invalid token type
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        'error statement requires string message',
        current(this.state).span.start
      );
    } else if (requireMessage) {
      // At boundary but message required (statement form, not pipe target)
      throw new ParseError(
        ERROR_IDS.RILL_P002,
        'Unexpected end of input, expected string',
        start
      );
    }
    // else: at statement boundary without message (valid pipe target form)
  }

  return {
    type: 'Error',
    message,
    span: makeSpan(start, previous(this.state).span.end),
  };
};

// ============================================================
// GUARD / RETRY BLOCKS
// ============================================================

/**
 * Parse a guard block: `guard { body }`, `guard(on: #X) { body }`, or
 * `guard(on: list[#X, #Y]) { body }`.
 *
 * Enters with current token being GUARD_LBRACE (compound, no options) or
 * GUARD (bare keyword; a parenthesized option list may follow).
 */
Parser.prototype.parseGuardBlock = function (
  this: Parser
): GuardBlockNode | RecoveryErrorNode {
  const start = current(this.state).span.start;

  // `guard{` — the compound token already consumed the `{`, so parse the
  // block statements directly. The body starts at the `{`, which is the last
  // character of the token.
  if (check(this.state, TOKEN_TYPES.GUARD_LBRACE)) {
    const tokenEnd = advance(this.state).span.end;
    const braceStart = {
      line: tokenEnd.line,
      column: tokenEnd.column - 1,
      offset: tokenEnd.offset - 1,
    };
    const body = parseBlockStatements(this, braceStart, false);
    return {
      type: 'GuardBlock',
      body,
      options: null,
      span: makeSpan(start, body.span.end),
    };
  }

  expect(this.state, TOKEN_TYPES.GUARD, "Expected 'guard'");
  const options = parseParenOptions(this, 'guard');
  const invalidOn = checkWrittenOn(this, options, start);
  if (invalidOn !== null) return invalidOn;
  const body = parseGuardOrRetryBody(this);
  return {
    type: 'GuardBlock',
    body,
    options,
    span: makeSpan(start, body.span.end),
  };
};

/**
 * Parse a retry block: `retry(attempts: N) { body }`,
 * `retry(attempts: N, on: #X) { body }`, or
 * `retry(attempts: N, on: list[#X]) { body }`.
 *
 * Enters with current token being RETRY. The options are checked against the
 * `retry` options type when the block runs, so `retry { body }` and
 * `retry() { body }` parse and halt there.
 */
Parser.prototype.parseRetryBlock = function (
  this: Parser
): RetryBlockNode | RecoveryErrorNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.RETRY, "Expected 'retry'");
  const options = parseParenOptions(this, 'retry');
  const invalidOn = checkWrittenOn(this, options, start);
  if (invalidOn !== null) return invalidOn;
  const body = parseGuardOrRetryBody(this);
  return {
    type: 'RetryBlock',
    body,
    options,
    span: makeSpan(start, body.span.end),
  };
};

/**
 * Parse the `{ body }` that follows a guard/retry header. Unlike
 * parser-level generic blocks the body is required.
 */
function parseGuardOrRetryBody(parser: Parser): BlockNode {
  if (!check(parser.state, TOKEN_TYPES.LBRACE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Expected { to start guard/retry body',
      current(parser.state).span.start
    );
  }
  return parser.parseBlock(false);
}

// ============================================================
// TIMEOUT BLOCK
// ============================================================

/**
 * Parse a timeout block:
 *   timeout(total: duration, idle: duration) { body }
 *
 * Enters with the cursor on the identifier `timeout`, where atTimeoutBlock
 * holds. Either, both (in any order), or neither key may appear, and a dict
 * may be spread in. The options type is checked when the block runs. The body
 * starts on the line where the options end.
 */
Parser.prototype.parseTimeoutBlock = function (this: Parser): TimeoutBlockNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume `timeout`

  const options = parseParenOptions(this, 'timeout');
  if (options === null) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected '(' after 'timeout'",
      current(this.state).span.start
    );
  }

  if (!check(this.state, TOKEN_TYPES.LBRACE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected '{ body }' after 'timeout(...)'",
      current(this.state).span.start
    );
  }

  const body = this.parseBlock(false);

  return {
    type: 'TimeoutBlock',
    options,
    body,
    span: makeSpan(start, body.span.end),
  } satisfies TimeoutBlockNode;
};
