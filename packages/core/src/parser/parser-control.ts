/**
 * Parser Extension: Control Flow Parsing
 * Conditionals, loops, and blocks
 */

import { Parser } from './parser.js';
import type {
  AnnotatedStatementNode,
  AnnotationArg,
  AssertNode,
  AtomLiteralNode,
  BlockNode,
  ConditionalNode,
  DoWhileLoopNode,
  ErrorNode,
  ExpressionNode,
  GroupedExprNode,
  GuardBlockNode,
  NamedArgNode,
  NumberLiteralNode,
  PipeChainNode,
  PipeTargetNode,
  PostfixExprNode,
  RecoveryErrorNode,
  RetryBlockNode,
  StringLiteralNode,
  TimeoutBlockNode,
  WhileLoopNode,
  BodyNode,
  StatementNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  isAtEnd,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  makeSpan,
  reportError,
} from './state.js';
import { ATOM_NAME_SHAPE } from './helpers.js';
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
  }
}

type OnCodeListResult =
  | { kind: 'ok'; codes: AtomLiteralNode[] }
  | { kind: 'invalid'; node: RecoveryErrorNode };

// ============================================================
// CONDITIONALS
// ============================================================

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

Parser.prototype.parseConditionalRest = function (
  this: Parser,
  condition: BodyNode | null,
  start: { line: number; column: number; offset: number }
): ConditionalNode {
  const thenBranch = this.parseBody();

  let elseBranch: BodyNode | ConditionalNode | null = null;
  // Site 4: Add skipNewlines before ! check (safe because we're inside conditional)
  skipNewlines(this.state);
  if (check(this.state, TOKEN_TYPES.BANG)) {
    advance(this.state);

    const elseBody = this.parseBody();

    // Site 5: Add newline lookahead before ? check for else-if
    if (skipNewlinesIfFollowedBy(this.state, TOKEN_TYPES.QUESTION)) {
      elseBranch = this.parseConditionalWithCondition(elseBody);
    } else {
      elseBranch = elseBody;
    }
  }

  return {
    type: 'Conditional',
    input: null,
    condition,
    thenBranch,
    elseBranch,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// LOOPS
// ============================================================

/**
 * Parse construct options after `do<`.
 *
 * Precondition: DO_LANGLE token has already been consumed.
 * Grammar: `limit` `:` NUMBER `>`
 *
 * Validates that `limit` is a positive integer.
 * Returns a synthesized AnnotationArg[] equivalent to `^(limit: N)`.
 *
 * Error contracts (UXT-LOOP-1):
 *   EC-4: unknown option name  → RILL-P004
 *   EC-5: non-positive limit   → RILL-P004
 *   EC-6: missing `>`          → RILL-P005
 */
function parseConstructOptions(
  parser: Parser,
  start: { line: number; column: number; offset: number }
): AnnotationArg[] {
  skipNewlines(parser.state);

  // Require an identifier as the option name.
  if (!check(parser.state, TOKEN_TYPES.IDENTIFIER)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      `Parse error: unknown option \`${current(parser.state).value}\` for \`do\` construct (only \`limit\` accepted)`,
      current(parser.state).span.start
    );
  }

  const optionToken = advance(parser.state);
  if (optionToken.value !== 'limit') {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      `Parse error: unknown option \`${optionToken.value}\` for \`do\` construct (only \`limit\` accepted)`,
      optionToken.span.start
    );
  }

  expect(parser.state, TOKEN_TYPES.COLON, "Expected ':' after option name");
  skipNewlines(parser.state);

  if (!check(parser.state, TOKEN_TYPES.NUMBER)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Validation error: `limit` must be a positive integer',
      current(parser.state).span.start
    );
  }

  const numToken = advance(parser.state);
  const limitValue = Number(numToken.value);

  if (!Number.isInteger(limitValue) || limitValue < 1) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Validation error: `limit` must be a positive integer',
      numToken.span.start
    );
  }

  skipNewlines(parser.state);
  expect(
    parser.state,
    TOKEN_TYPES.GT,
    'Parse error: expected `>` to close `do` construct options',
    ERROR_IDS.RILL_P005
  );

  // Synthesise a NamedArgNode for `limit: N` matching the shape produced by
  // the legacy `^(limit: N)` annotation. The value must be an ExpressionNode
  // (= PipeChainNode) wrapping a NumberLiteralNode.
  const numLiteral: NumberLiteralNode = {
    type: 'NumberLiteral',
    value: limitValue,
    span: numToken.span,
  };
  const postfix: PostfixExprNode = {
    type: 'PostfixExpr',
    primary: numLiteral,
    methods: [],
    defaultValue: null,
    span: numToken.span,
  };
  const valueExpr: PipeChainNode = {
    type: 'PipeChain',
    head: postfix,
    pipes: [],
    terminator: null,
    span: numToken.span,
  };
  const namedArg: NamedArgNode = {
    type: 'NamedArg',
    name: 'limit',
    value: valueExpr,
    span: makeSpan(start, numToken.span.end),
  };

  return [namedArg];
}

/**
 * Parse a do-while loop: `do [<limit: N>] { body } while ( cond )`.
 *
 * Precondition: current token is DO or DO_LANGLE.
 * Produces a DoWhileLoopNode. `input` is null (set by parseLoopWithInput when
 * called from a pipe chain). Trailing `while (cond)` is required (EC-3).
 */
Parser.prototype.parseLoop = function (this: Parser): DoWhileLoopNode {
  const start = current(this.state).span.start;

  // Consume `do` or `do<`; parse optional construct options.
  let annotations: AnnotationArg[] | undefined;
  if (check(this.state, TOKEN_TYPES.DO_LANGLE)) {
    advance(this.state); // consume do<
    annotations = parseConstructOptions(this, start);
  } else {
    expect(this.state, TOKEN_TYPES.DO, 'Expected `do`');
  }

  const body = this.parseBlock();

  // Require trailing `while (cond)` — EC-3.
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
  const condition = this.parseExpression();
  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);

  return {
    type: 'DoWhileLoop',
    input: null,
    body,
    condition,
    annotations,
    span: makeSpan(start, current(this.state).span.end),
  };
};

/**
 * Parse a while loop: `while ( cond ) do [<limit: N>] { body }`.
 *
 * Precondition: current token is WHILE.
 * Produces a WhileLoopNode. Trailing `do` / `do<limit: N>` is required.
 *
 * Error contracts (UXT-LOOP-1):
 *   EC-1: missing `(cond)`  → RILL-P004
 *   EC-2: missing `do`      → RILL-P004
 */
Parser.prototype.parseWhileLoop = function (this: Parser): WhileLoopNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume `while`

  // Require `( cond )` — EC-1.
  if (!check(this.state, TOKEN_TYPES.LPAREN)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: `while` requires `(condition)` before `do`',
      current(this.state).span.start
    );
  }
  advance(this.state); // consume `(`
  const condition: ExpressionNode = this.parseExpression();
  expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);

  skipNewlines(this.state);

  // Require `do` or `do<opts>` — EC-2.
  if (
    !check(this.state, TOKEN_TYPES.DO) &&
    !check(this.state, TOKEN_TYPES.DO_LANGLE)
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Parse error: expected `do` after `while (cond)`',
      current(this.state).span.start
    );
  }

  let annotations: AnnotationArg[] | undefined;
  if (check(this.state, TOKEN_TYPES.DO_LANGLE)) {
    const doStart = current(this.state).span.start;
    advance(this.state); // consume do<
    annotations = parseConstructOptions(this, doStart);
  } else {
    advance(this.state); // consume `do`
  }

  const body = this.parseBlock();

  return {
    type: 'WhileLoop',
    condition,
    body,
    annotations,
    span: makeSpan(start, current(this.state).span.end),
  };
};

/**
 * Thin dispatcher: routes a pipe-seeded loop to parseWhileLoop or parseLoop
 * based on the next token.
 *
 * - WHILE token  → parseWhileLoop(); seed is threaded into the condition head
 *   so the seed value is the initial $ when the condition first evaluates.
 * - DO / DO_LANGLE → parseLoop(); seed threads into DoWhileLoopNode.input.
 */
Parser.prototype.parseLoopWithInput = function (
  this: Parser,
  seed: BodyNode
): WhileLoopNode | DoWhileLoopNode {
  if (check(this.state, TOKEN_TYPES.WHILE)) {
    const node = this.parseWhileLoop();

    // IR-5: Thread seed into WhileLoopNode.condition as the pipe head.
    // Wrap the existing condition in a GroupedExprNode so it can serve as a
    // PipeTargetNode (GroupedExprNode is in the PipeTargetNode union).
    const wrappedCondition: GroupedExprNode = {
      type: 'GroupedExpr',
      expression: node.condition,
      span: node.condition.span,
    };

    let newCondition: ExpressionNode;
    if (seed.type === 'PipeChain') {
      // Seed is already a PipeChainNode — use its head directly and append
      // the wrapped condition as the next pipe stage.
      newCondition = {
        type: 'PipeChain',
        head: seed.head,
        pipes: [...seed.pipes, wrappedCondition as PipeTargetNode],
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
        pipes: [wrappedCondition as PipeTargetNode],
        terminator: null,
        span: makeSpan(seed.span.start, node.condition.span.end),
      };
    }

    return { ...node, condition: newCondition };
  }

  // DO or DO_LANGLE: parse the do-while body then attach seed as input.
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
  skipNewlines(this.state);

  const statements: (StatementNode | AnnotatedStatementNode)[] = [];
  while (!check(this.state, TOKEN_TYPES.RBRACE) && !isAtEnd(this.state)) {
    statements.push(this.parseStatement());
    skipNewlines(this.state);
  }

  if (statements.length === 0 && !allowEmpty) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Empty blocks are not allowed',
      start
    );
  }

  const rbrace = expect(this.state, TOKEN_TYPES.RBRACE, 'Expected }');

  return {
    type: 'Block',
    statements,
    span: makeSpan(start, rbrace.span.end),
  };
};

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
    span: makeSpan(start, current(this.state).span.end),
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
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// GUARD / RETRY BLOCKS (task 1.4)
// ============================================================

/**
 * Parse the `<on: list[#X, #Y, ...]>` option list that may follow `guard` or
 * `retry<N,`. Returns either the collected atoms or a RecoveryErrorNode when
 * any atom fails the strict shape check (EC-14).
 *
 * Assumes the opening `<` has NOT yet been consumed by the caller; caller
 * decides based on whether the compound lexer token (GUARD_LBRACE /
 * RETRY_LANGLE) was emitted.
 *
 * Grammar: `<` `on` `:` `list[` atom (`,` atom)* `]` `>`
 */
function parseOnOptionList(
  parser: Parser,
  start: { line: number; column: number; offset: number }
): OnCodeListResult {
  // Opening `<` already consumed for GUARD (bare) path; we consume `on:`.
  skipNewlines(parser.state);
  if (
    !check(parser.state, TOKEN_TYPES.IDENTIFIER) ||
    current(parser.state).value !== 'on'
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected 'on:' inside guard/retry option list",
      current(parser.state).span.start
    );
  }
  advance(parser.state); // consume 'on'
  expect(parser.state, TOKEN_TYPES.COLON, "Expected ':' after 'on'");
  skipNewlines(parser.state);

  // Require the compound `list[` lexer token (no whitespace between keyword
  // and bracket); bare `[` is not accepted as the spec syntax is
  // `list[#X, ...]`.
  if (!check(parser.state, TOKEN_TYPES.LIST_LBRACKET)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected 'list[' in on: option list",
      current(parser.state).span.start
    );
  }
  const listOpen = advance(parser.state); // consume list[
  skipNewlines(parser.state);

  const codes: AtomLiteralNode[] = [];
  let hadInvalid = false;
  let invalidMessage = '';
  void listOpen;

  while (!check(parser.state, TOKEN_TYPES.RBRACKET)) {
    if (check(parser.state, TOKEN_TYPES.EOF)) {
      throw new ParseError(
        ERROR_IDS.RILL_P005,
        "Expected ']' to close on: option list",
        current(parser.state).span.start
      );
    }
    if (!check(parser.state, TOKEN_TYPES.ATOM)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        'on: option list entries must be atom literals (e.g. #NAME)',
        current(parser.state).span.start
      );
    }
    const atomToken = advance(parser.state);
    if (!ATOM_NAME_SHAPE.test(atomToken.value)) {
      hadInvalid = true;
      invalidMessage = `Invalid atom name '#${atomToken.value}' in on: option list`;
    } else {
      codes.push({
        type: 'AtomLiteral',
        name: atomToken.value,
        span: atomToken.span,
      });
    }
    skipNewlines(parser.state);
    if (check(parser.state, TOKEN_TYPES.COMMA)) {
      advance(parser.state);
      skipNewlines(parser.state);
    } else {
      break;
    }
  }

  expect(
    parser.state,
    TOKEN_TYPES.RBRACKET,
    "Expected ']' to close on: option list",
    ERROR_IDS.RILL_P005
  );

  skipNewlines(parser.state);
  const rangle = expect(
    parser.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close option list",
    ERROR_IDS.RILL_P005
  );

  if (hadInvalid) {
    const invalidEnd = rangle.span.end;
    // Record the error on the parser's error collection so
    // parseWithRecovery reports success: false for shape-invalid atoms
    // (EC-14). Without this push, parser.errors remains empty and the
    // caller incorrectly reports a successful parse despite a
    // RecoveryErrorNode in the AST.
    reportError(parser.state, ERROR_IDS.RILL_P004, invalidMessage, start);
    return {
      kind: 'invalid',
      node: {
        type: 'RecoveryError',
        message: invalidMessage,
        text: parser.state.source.slice(start.offset, invalidEnd.offset),
        span: makeSpan(start, invalidEnd),
      },
    };
  }

  return { kind: 'ok', codes };
}

/**
 * Parse a guard block: `guard { body }` or `guard<on: list[#X]> { body }`.
 *
 * Enters with current token being GUARD_LBRACE (compound, no option list)
 * or GUARD (bare keyword, option list follows). Returns a RecoveryErrorNode
 * per EC-14 if any atom in the option list fails the strict shape check.
 */
Parser.prototype.parseGuardBlock = function (
  this: Parser
): GuardBlockNode | RecoveryErrorNode {
  const start = current(this.state).span.start;

  // Form 1: `guard{` — no option list; the compound token consumes `guard`
  // but leaves `{` in the stream? Actually the compound-lbrace lexer
  // recognises `guard{` as a single token, so we advance past it and then
  // continue parsing the block body manually (LBRACE has already been
  // consumed virtually). We still need the block parser. Strategy: replace
  // GUARD_LBRACE with LBRACE semantics by treating it as the block opener.
  if (check(this.state, TOKEN_TYPES.GUARD_LBRACE)) {
    advance(this.state); // consume guard{
    const body = parseGuardOrRetryBody(this, start);
    return {
      type: 'GuardBlock',
      body,
      span: makeSpan(start, body.span.end),
    };
  }

  // Form 2a: `guard { body }` — bare GUARD keyword with whitespace
  // before `{`. The lexer emits GUARD + LBRACE (rather than the
  // compound GUARD_LBRACE) when any whitespace separates the two.
  // Treat this as the no-option-list path.
  expect(this.state, TOKEN_TYPES.GUARD, "Expected 'guard'");
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    const body = parseGuardOrRetryBody(this, start);
    return {
      type: 'GuardBlock',
      body,
      span: makeSpan(start, body.span.end),
    };
  }
  // Form 2b: `guard<...> { body }` — bare GUARD keyword then `<on: ...>`.
  if (!check(this.state, TOKEN_TYPES.LT)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected '<on: list[#X, ...]> { body }' or 'guard { body }'",
      current(this.state).span.start
    );
  }
  advance(this.state); // consume `<`
  const onResult = parseOnOptionList(this, start);
  if (onResult.kind === 'invalid') {
    // Still consume the body so recovery leaves the stream in a sane state.
    if (check(this.state, TOKEN_TYPES.LBRACE)) {
      this.parseBlock(true);
    }
    return onResult.node;
  }

  const body = parseGuardOrRetryBody(this, start);
  return {
    type: 'GuardBlock',
    body,
    onCodes: onResult.codes,
    span: makeSpan(start, body.span.end),
  };
};

/**
 * Parse a retry block: `retry<limit: N> { body }` or `retry<limit: N, on: list[#X]> { body }`.
 *
 * Enters with current token being RETRY_LANGLE (compound) or RETRY (bare).
 * The `limit:` named argument is required; bare `retry<N>` is a parse error.
 * Returns a RecoveryErrorNode when an atom in the on: list fails the strict
 * shape check (EC-14).
 */
Parser.prototype.parseRetryBlock = function (
  this: Parser
): RetryBlockNode | RecoveryErrorNode {
  const start = current(this.state).span.start;

  // Both RETRY_LANGLE and RETRY + `<` lead into the same `<N[, on: ...]>`
  // body. Consume the opener uniformly.
  if (check(this.state, TOKEN_TYPES.RETRY_LANGLE)) {
    advance(this.state); // consume retry<
  } else {
    expect(this.state, TOKEN_TYPES.RETRY, "Expected 'retry'");
    if (!check(this.state, TOKEN_TYPES.LT)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        "Expected 'retry<limit: N> { body }' or 'retry<limit: N, on: list[#X]> { body }'",
        current(this.state).span.start
      );
    }
    advance(this.state); // consume `<`
  }

  skipNewlines(this.state);
  // Require the `limit:` named argument before the integer attempt count.
  if (
    !check(this.state, TOKEN_TYPES.IDENTIFIER) ||
    current(this.state).value !== 'limit'
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected 'limit:' inside 'retry<...>'",
      current(this.state).span.start
    );
  }
  advance(this.state); // consume 'limit'
  expect(
    this.state,
    TOKEN_TYPES.COLON,
    "Expected ':' after 'limit'",
    ERROR_IDS.RILL_P004
  );
  skipNewlines(this.state);
  // Parse integer attempts.
  if (!check(this.state, TOKEN_TYPES.NUMBER)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected integer attempt count inside 'retry<limit: N>'",
      current(this.state).span.start
    );
  }
  const attemptsToken = advance(this.state);
  const attempts = Number(attemptsToken.value);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      `retry<limit: N> attempt count must be a positive integer; got ${attemptsToken.value}`,
      attemptsToken.span.start
    );
  }

  skipNewlines(this.state);

  let onCodes: AtomLiteralNode[] | undefined = undefined;

  if (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state); // consume `,`
    const onResult = parseOnOptionList(this, start);
    if (onResult.kind === 'invalid') {
      if (check(this.state, TOKEN_TYPES.LBRACE)) {
        this.parseBlock(true);
      }
      return onResult.node;
    }
    onCodes = onResult.codes;
  } else {
    expect(
      this.state,
      TOKEN_TYPES.GT,
      "Expected '>' to close retry attempt list",
      ERROR_IDS.RILL_P005
    );
  }

  skipNewlines(this.state);
  const body = parseGuardOrRetryBody(this, start);
  return {
    type: 'RetryBlock',
    attempts,
    body,
    onCodes,
    span: makeSpan(start, body.span.end),
  };
};

/**
 * Parse the `{ body }` that follows a guard/retry header. Unlike
 * parser-level generic blocks the body is required.
 */
function parseGuardOrRetryBody(
  parser: Parser,
  start: { line: number; column: number; offset: number }
): BlockNode {
  if (!check(parser.state, TOKEN_TYPES.LBRACE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      'Expected { to start guard/retry body',
      current(parser.state).span.start
    );
  }
  void start;
  return parser.parseBlock(false);
}

// ============================================================
// TIMEOUT BLOCK (task 1.2)
// ============================================================

/**
 * Parse a timeout block:
 *   timeout<total: duration> { body }
 *   timeout<idle: duration>  { body }
 *
 * Enters with current token being TIMEOUT_LANGLE (compound `timeout<`).
 * Exactly one of `total:` or `idle:` must appear — both together is a
 * compile-time parse error (EC-4). The duration is parsed as a primary
 * expression so that `>` is not consumed as a comparison operator. To use
 * a richer expression (e.g. a method chain or arithmetic), wrap it in
 * parentheses — `parsePrimary` accepts `(expression)` as a grouped primary,
 * so `timeout<total: ($d -> .multiply(2))> { ... }` parses as expected.
 */
Parser.prototype.parseTimeoutBlock = function (this: Parser): TimeoutBlockNode {
  const start = current(this.state).span.start;
  advance(this.state); // consume timeout<

  skipNewlines(this.state);

  // Parse exactly one kind key: `total` or `idle`.
  if (
    !check(this.state, TOKEN_TYPES.IDENTIFIER) ||
    (current(this.state).value !== 'total' &&
      current(this.state).value !== 'idle')
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected 'total:' or 'idle:' inside 'timeout<...>'",
      current(this.state).span.start
    );
  }

  const kindToken = advance(this.state);
  const kind = kindToken.value as 'total' | 'idle';

  expect(
    this.state,
    TOKEN_TYPES.COLON,
    `Expected ':' after '${kind}' inside 'timeout<...>'`,
    ERROR_IDS.RILL_P004
  );
  skipNewlines(this.state);

  // Parse the duration as a primary expression to avoid consuming `>`.
  const durationPrimary = this.parsePrimary();

  // Wrap in PostfixExprNode + PipeChainNode to produce a full ExpressionNode.
  const primarySpan = durationPrimary.span;
  const postfixNode = {
    type: 'PostfixExpr' as const,
    primary: durationPrimary,
    methods: [],
    defaultValue: null,
    span: primarySpan,
  };
  const duration: ExpressionNode = {
    type: 'PipeChain' as const,
    head: postfixNode,
    pipes: [],
    terminator: null,
    span: primarySpan,
  };

  skipNewlines(this.state);

  // EC-4: reject second kind key before the closing `>`.
  if (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state); // consume `,`
    skipNewlines(this.state);
    if (
      check(this.state, TOKEN_TYPES.IDENTIFIER) &&
      (current(this.state).value === 'total' ||
        current(this.state).value === 'idle')
    ) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        "timeout<> accepts exactly one kind key; found both 'total' and 'idle'",
        current(this.state).span.start
      );
    }
    // Any other trailing content is also an error.
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "timeout<> accepts exactly one option ('total' or 'idle')",
      current(this.state).span.start
    );
  }

  expect(
    this.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close 'timeout<...>'",
    ERROR_IDS.RILL_P005
  );

  skipNewlines(this.state);

  if (!check(this.state, TOKEN_TYPES.LBRACE)) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected '{ body }' after 'timeout<...>'",
      current(this.state).span.start
    );
  }

  const body = this.parseBlock(false);

  return {
    type: 'TimeoutBlock',
    kind,
    duration,
    body,
    span: makeSpan(start, body.span.end),
  } satisfies TimeoutBlockNode;
};
