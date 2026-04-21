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
  GuardBlockNode,
  RecoveryErrorNode,
  RetryBlockNode,
  StringLiteralNode,
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
} from './state.js';
import { ATOM_NAME_SHAPE } from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parsePipedConditional(): ConditionalNode;
    parseConditionalWithCondition(conditionBody: BodyNode): ConditionalNode;
    parseConditionalRest(
      condition: BodyNode | null,
      start: { line: number; column: number; offset: number }
    ): ConditionalNode;
    parseLoop(
      condition: ExpressionNode | null
    ): WhileLoopNode | DoWhileLoopNode;
    parseLoopWithInput(condition: BodyNode): WhileLoopNode | DoWhileLoopNode;
    parseBlock(allowEmpty?: boolean): BlockNode;
    parseAssert(): AssertNode;
    parseError(requireMessage?: boolean): ErrorNode;
    parseGuardBlock(): GuardBlockNode | RecoveryErrorNode;
    parseRetryBlock(): RetryBlockNode | RecoveryErrorNode;
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

Parser.prototype.parseLoop = function (
  this: Parser,
  condition: ExpressionNode | null
): WhileLoopNode | DoWhileLoopNode {
  const start = condition
    ? condition.span.start
    : current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.AT, 'Expected @');

  let annotations: AnnotationArg[] | undefined;
  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state); // consume ^
    expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
    annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', 'RILL-P005');
  }

  const body = this.parseBody();

  // Check for do-while: @ body ? cond
  if (check(this.state, TOKEN_TYPES.QUESTION)) {
    advance(this.state);
    const doWhileCondition = this.parseBody();

    return {
      type: 'DoWhileLoop',
      input: condition,
      body,
      condition: doWhileCondition,
      annotations,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  // While loop: cond @ body - condition is required
  if (!condition) {
    throw new ParseError(
      'RILL-P004',
      "Bare '@' requires trailing condition: @ body ? cond (do-while)",
      start
    );
  }

  return {
    type: 'WhileLoop',
    condition,
    body,
    annotations,
    span: makeSpan(start, current(this.state).span.end),
  };
};

Parser.prototype.parseLoopWithInput = function (
  this: Parser,
  condition: BodyNode
): WhileLoopNode | DoWhileLoopNode {
  let conditionExpr: ExpressionNode;
  if (condition.type === 'PipeChain') {
    conditionExpr = condition;
  } else {
    conditionExpr = {
      type: 'PipeChain',
      head:
        condition.type === 'PostfixExpr'
          ? condition
          : {
              type: 'PostfixExpr',
              primary: condition,
              methods: [],
              defaultValue: null,
              span: condition.span,
            },
      pipes: [],
      terminator: null,
      span: condition.span,
    };
  }

  return this.parseLoop(conditionExpr);
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
    throw new ParseError('RILL-P004', 'Empty blocks are not allowed', start);
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
        'RILL-P004',
        'error statement requires string message',
        current(this.state).span.start
      );
    } else if (requireMessage) {
      // At boundary but message required (statement form, not pipe target)
      throw new ParseError(
        'RILL-P002',
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
      'RILL-P004',
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
      'RILL-P004',
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
        'RILL-P005',
        "Expected ']' to close on: option list",
        current(parser.state).span.start
      );
    }
    if (!check(parser.state, TOKEN_TYPES.ATOM)) {
      throw new ParseError(
        'RILL-P004',
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
    'RILL-P005'
  );

  skipNewlines(parser.state);
  const rangle = expect(
    parser.state,
    TOKEN_TYPES.GT,
    "Expected '>' to close option list",
    'RILL-P005'
  );

  if (hadInvalid) {
    const invalidEnd = rangle.span.end;
    // Record the error on the parser's error collection so
    // parseWithRecovery reports success: false for shape-invalid atoms
    // (EC-14). Without this push, parser.errors remains empty and the
    // caller incorrectly reports a successful parse despite a
    // RecoveryErrorNode in the AST.
    parser.state.errors.push(
      new ParseError('RILL-P004', invalidMessage, start)
    );
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
      'RILL-P004',
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
 * Parse a retry block: `retry<N> { body }` or `retry<N, on: list[#X]> { body }`.
 *
 * Enters with current token being RETRY_LANGLE (compound) or RETRY (bare).
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
        'RILL-P004',
        "Expected 'retry<N> { body }' or 'retry<N, on: list[#X]> { body }'",
        current(this.state).span.start
      );
    }
    advance(this.state); // consume `<`
  }

  skipNewlines(this.state);
  // Parse integer attempts.
  if (!check(this.state, TOKEN_TYPES.NUMBER)) {
    throw new ParseError(
      'RILL-P004',
      "Expected integer attempt count inside 'retry<N>'",
      current(this.state).span.start
    );
  }
  const attemptsToken = advance(this.state);
  const attempts = Number(attemptsToken.value);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new ParseError(
      'RILL-P004',
      `retry<N> attempt count must be a positive integer; got ${attemptsToken.value}`,
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
      'RILL-P005'
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
      'RILL-P004',
      'Expected { to start guard/retry body',
      current(parser.state).span.start
    );
  }
  void start;
  return parser.parseBlock(false);
}
