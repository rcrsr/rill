/**
 * Parser Extension: Closure Parsing
 * Closures, closure bodies and parameters, stream type constructors,
 * and yield validation
 */

import { Parser } from './parser.js';
import type {
  AnnotationArg,
  ClosureNode,
  ClosureParamNode,
  LiteralNode,
  BodyNode,
  TypeConstructorNode,
  TypeRef,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  peek,
  previous,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  makeSpan,
} from './state.js';
import { expectVariableName, VALID_TYPE_NAMES } from './helpers.js';
import { parseTypeRef, parseFieldArgList } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseClosure(): ClosureNode;
    parseBody(allowEmptyBlock?: boolean): BodyNode;
    parseClosureParam(): ClosureParamNode;
  }
}

// ============================================================
// CLOSURE PARSING
// ============================================================

/**
 * Parse a stream type constructor: stream(T):R
 *
 * Grammar: "stream" "(" [type-ref] ")" [":" type-ref]
 *
 * Chunk type goes in args[0], resolution type in args[1].
 * stream() → 0 args, stream(T) → 1 arg, stream(T):R → 2 args.
 *
 * @internal
 */
function parseStreamTypeConstructor(parser: Parser): TypeConstructorNode {
  const start = current(parser.state).span.start;
  advance(parser.state); // consume 'stream'

  if (!check(parser.state, TOKEN_TYPES.LPAREN)) {
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      'Expected type name in stream constructor',
      current(parser.state).span.start
    );
  }

  advance(parser.state); // consume '('

  const args = parseFieldArgList(parser.state);

  const rparen = expect(
    parser.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    ERROR_IDS.RILL_P005
  );

  // Check for resolution type: stream(T):R
  if (check(parser.state, TOKEN_TYPES.COLON)) {
    advance(parser.state); // consume ':'
    skipNewlines(parser.state);

    // Guard: resolution type must start with a valid type name
    if (!check(parser.state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        ERROR_IDS.RILL_P006,
        "Expected type name after ':' in stream type",
        current(parser.state).span.start
      );
    }

    // Parse the resolution type reference
    const resolutionType = parseTypeRef(parser.state);

    // Ensure positional alignment: args[0] = chunk, args[1] = ret.
    // When parens are empty (no chunk type), insert an 'any' placeholder
    // so the runtime correctly maps arg positions.
    if (args.length === 0) {
      args.push({ value: { kind: 'static', typeName: 'any' } });
    }
    args.push({ value: resolutionType });

    return {
      type: 'TypeConstructor',
      constructorName: 'stream',
      args,
      span: makeSpan(start, previous(parser.state).span.end),
    };
  }

  return {
    type: 'TypeConstructor',
    constructorName: 'stream',
    args,
    span: makeSpan(start, rparen.span.end),
  };
}

/**
 * Check whether a closure body contains any yield terminators at the
 * immediate level (not inside nested closures). Returns true if at
 * least one yield is found.
 * @internal
 */
function bodyContainsYield(body: BodyNode): boolean {
  if (body.type === 'PipeChain') {
    if (body.terminator?.type === 'Yield') return true;
    return false;
  }
  if (body.type === 'Block') {
    for (const stmt of body.statements) {
      const expr =
        stmt.type === 'AnnotatedStatement'
          ? stmt.statement.expression
          : stmt.expression;
      if (expr.terminator?.type === 'Yield') return true;
    }
    return false;
  }
  return false;
}

/**
 * Validate that yield nodes in a closure body are only present when
 * the closure has a stream return type. Throws RILL-P006 if yield
 * appears without :stream(T):R annotation.
 * @internal
 */
function validateYieldInClosure(
  body: BodyNode,
  returnTypeTarget: TypeRef | TypeConstructorNode | undefined,
  closureStart: { line: number; column: number; offset: number }
): void {
  if (!bodyContainsYield(body)) return;

  const isStream =
    returnTypeTarget !== undefined &&
    'type' in returnTypeTarget &&
    returnTypeTarget.type === 'TypeConstructor' &&
    returnTypeTarget.constructorName === 'stream';

  if (!isStream) {
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      "'yield' is only valid inside a stream closure",
      closureStart
    );
  }
}

/**
 * Parse the optional postfix `:type-target` after a closure body.
 *
 * Grammar: [ ":" , type-target ]
 * type-target = "stream" "(" [type-ref] ")" [":" type-ref] | type-ref
 *
 * Returns the parsed TypeRef, TypeConstructorNode, or undefined if absent.
 * Follows the same disambiguation logic as parsePostfixTypeOperation.
 * Extended for stream(T):R return type pattern.
 */
function parseClosureReturnTypeTarget(
  parser: Parser
): TypeRef | TypeConstructorNode | undefined {
  if (!skipNewlinesIfFollowedBy(parser.state, TOKEN_TYPES.COLON)) {
    return undefined;
  }
  advance(parser.state); // consume ':'
  skipNewlines(parser.state);

  // Stream type constructor: stream(T):R
  if (
    check(parser.state, TOKEN_TYPES.IDENTIFIER) &&
    current(parser.state).value === 'stream'
  ) {
    return parseStreamTypeConstructor(parser);
  }

  // Default: plain type name or dynamic type reference
  return parseTypeRef(parser.state);
}

/**
 * Increment closureDepth, call fn(), decrement in finally.
 * Guards against depth counter leaks when parseBody throws.
 */
function withClosureDepth<T>(parser: Parser, fn: () => T): T {
  parser.closureDepth++;
  try {
    return fn();
  } finally {
    parser.closureDepth--;
  }
}

Parser.prototype.parseClosure = function (this: Parser): ClosureNode {
  const start = current(this.state).span.start;

  if (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
    skipNewlines(this.state);
    const body = withClosureDepth(this, () => this.parseBody(true));
    const returnTypeTarget = parseClosureReturnTypeTarget(this);
    validateYieldInClosure(body, returnTypeTarget, start);
    return {
      type: 'Closure',
      params: [],
      body,
      returnTypeTarget,
      // current() is intentional lookahead here, not the last-consumed-token
      // idiom: it reads the token position parseClosureReturnTypeTarget left
      // the cursor at after consuming the return type target.
      span: makeSpan(
        start,
        returnTypeTarget ? current(this.state).span.end : body.span.end
      ),
    };
  }

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
  skipNewlines(this.state);

  // Anonymous typed closure detection: |type| body, |$typeVar| body, or |type, type| body
  // Static: current is IDENTIFIER in VALID_TYPE_NAMES, next non-newline is PIPE_BAR or COMMA+type+PIPE_BAR
  // Dynamic: current is DOLLAR ($typeVar form), same terminal rules
  const isAnonymousTyped = (() => {
    // Helper: check whether the token at `offset` starts a valid type reference
    // (static type name or dynamic $typeVar). Parameterized types (LPAREN after
    // the name) are accepted — detection only needs the start token.
    const isTypeStart = (offset: number): boolean => {
      const tok = peek(this.state, offset);
      if (tok.type === TOKEN_TYPES.DOLLAR) return true;
      if (
        tok.type === TOKEN_TYPES.IDENTIFIER &&
        VALID_TYPE_NAMES.includes(
          tok.value as (typeof VALID_TYPE_NAMES)[number]
        )
      ) {
        return true;
      }
      return false;
    };

    // Helper: given the lookahead position of a COMMA following the first
    // type, check whether a second type start leads to a PIPE_BAR (with
    // optional newlines and an optional parameterized-type LPAREN escape).
    const checkSecondTypeThenPipe = (lookahead: number): boolean => {
      lookahead++;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      if (!isTypeStart(lookahead)) return false;
      // Advance past the second type token (DOLLAR = 2 tokens, IDENTIFIER = 1 token)
      lookahead +=
        peek(this.state, lookahead).type === TOKEN_TYPES.DOLLAR ? 2 : 1;
      // Parameterized second type: list(string), dict(name: type), etc.
      // LPAREN after the name means it is a parameterized type; accept and let parseTypeRef handle args.
      if (peek(this.state, lookahead).type === TOKEN_TYPES.LPAREN) return true;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      return peek(this.state, lookahead).type === TOKEN_TYPES.PIPE_BAR;
    };

    if (check(this.state, TOKEN_TYPES.DOLLAR)) {
      // Dynamic type ref: $identifier — offset 0=$, offset 1=name, offset 2+ skip newlines.
      let lookahead = 2;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      const afterFirst = peek(this.state, lookahead).type;
      if (afterFirst === TOKEN_TYPES.PIPE_BAR) return true;
      // Two-type: COMMA, optional newlines, second type start, optional newlines, PIPE_BAR
      if (afterFirst === TOKEN_TYPES.COMMA) {
        return checkSecondTypeThenPipe(lookahead);
      }
      return false;
    }
    if (
      check(this.state, TOKEN_TYPES.IDENTIFIER) &&
      VALID_TYPE_NAMES.includes(
        current(this.state).value as (typeof VALID_TYPE_NAMES)[number]
      )
    ) {
      // Parameterized type name: list(string), dict(name: type), etc.
      // Next token is LPAREN — this is an anonymous typed closure with type args.
      if (peek(this.state, 1).type === TOKEN_TYPES.LPAREN) {
        return true;
      }
      // Static type name: peek past any newlines to find PIPE_BAR or COMMA+type+PIPE_BAR
      let lookahead = 1;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      const afterFirst = peek(this.state, lookahead).type;
      if (afterFirst === TOKEN_TYPES.PIPE_BAR) return true;
      // Two-type: COMMA, optional newlines, second type start, optional newlines, PIPE_BAR
      if (afterFirst === TOKEN_TYPES.COMMA) {
        return checkSecondTypeThenPipe(lookahead);
      }
      return false;
    }
    return false;
  })();

  if (isAnonymousTyped) {
    const paramStart = current(this.state).span.start;
    const firstTypeRef = parseTypeRef(this.state, { allowTrailingPipe: true });

    // Two-type anonymous closure: |type, type|{ body }
    // Synthesizes params named '$' and '@' with their respective declared types.
    if (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      const secondParamStart = current(this.state).span.start;
      const secondTypeRef = parseTypeRef(this.state, {
        allowTrailingPipe: true,
      });
      expect(
        this.state,
        TOKEN_TYPES.PIPE_BAR,
        'Expected |',
        ERROR_IDS.RILL_P005
      );
      skipNewlines(this.state);
      const body = withClosureDepth(this, () => this.parseBody(true));
      const returnTypeTarget = parseClosureReturnTypeTarget(this);
      validateYieldInClosure(body, returnTypeTarget, start);
      const firstParam: ClosureParamNode = {
        type: 'ClosureParam',
        name: '$',
        typeRef: firstTypeRef,
        defaultValue: null,
        span: makeSpan(paramStart, secondParamStart),
      };
      const secondParam: ClosureParamNode = {
        type: 'ClosureParam',
        name: '@',
        typeRef: secondTypeRef,
        defaultValue: null,
        span: makeSpan(secondParamStart, current(this.state).span.start),
      };
      return {
        type: 'Closure',
        params: [firstParam, secondParam],
        body,
        returnTypeTarget,
        // current() is intentional lookahead here, not the last-consumed-token
        // idiom: it reads the token position parseClosureReturnTypeTarget left
        // the cursor at after consuming the return type target.
        span: makeSpan(
          start,
          returnTypeTarget ? current(this.state).span.end : body.span.end
        ),
      };
    }

    // Single-type anonymous closure: |type|{ body }
    // Synthesizes one param named '$' with the declared type.
    expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', ERROR_IDS.RILL_P005);
    skipNewlines(this.state);
    const body = withClosureDepth(this, () => this.parseBody(true));
    const returnTypeTarget = parseClosureReturnTypeTarget(this);
    validateYieldInClosure(body, returnTypeTarget, start);
    const param: ClosureParamNode = {
      type: 'ClosureParam',
      name: '$',
      typeRef: firstTypeRef,
      defaultValue: null,
      span: makeSpan(paramStart, current(this.state).span.start),
    };
    return {
      type: 'Closure',
      params: [param],
      body,
      returnTypeTarget,
      // current() is intentional lookahead here, not the last-consumed-token
      // idiom: it reads the token position parseClosureReturnTypeTarget left
      // the cursor at after consuming the return type target.
      span: makeSpan(
        start,
        returnTypeTarget ? current(this.state).span.end : body.span.end
      ),
    };
  }

  const params: ClosureParamNode[] = [];
  if (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
    params.push(this.parseClosureParam());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      params.push(this.parseClosureParam());
    }
  }

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', ERROR_IDS.RILL_P005);
  skipNewlines(this.state);

  const body = withClosureDepth(this, () => this.parseBody(true));
  const returnTypeTarget = parseClosureReturnTypeTarget(this);
  validateYieldInClosure(body, returnTypeTarget, start);

  return {
    type: 'Closure',
    params,
    body,
    returnTypeTarget,
    // current() is intentional lookahead here, not the last-consumed-token
    // idiom: it reads the token position parseClosureReturnTypeTarget left
    // the cursor at after consuming the return type target.
    span: makeSpan(
      start,
      returnTypeTarget ? current(this.state).span.end : body.span.end
    ),
  };
};

Parser.prototype.parseBody = function (
  this: Parser,
  allowEmptyBlock?: boolean
): BodyNode {
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    return this.parseBlock(allowEmptyBlock);
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

Parser.prototype.parseClosureParam = function (this: Parser): ClosureParamNode {
  const start = current(this.state).span.start;

  let annotations: AnnotationArg[] | undefined = undefined;

  // Parse parameter annotations before the name: ^(annots) name : type = default
  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state); // consume ^
    expect(this.state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
    annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', ERROR_IDS.RILL_P005);
  }

  const nameToken = expectVariableName(this.state, 'Expected parameter name');

  if (
    VALID_TYPE_NAMES.includes(
      nameToken.value as (typeof VALID_TYPE_NAMES)[number]
    )
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P003,
      `Reserved type keyword cannot be used as parameter name: ${nameToken.value}`,
      nameToken.span.start
    );
  }

  let typeRef: TypeRef | null = null;
  let defaultValue: LiteralNode | null = null;

  skipNewlines(this.state);
  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    skipNewlines(this.state);
    typeRef = parseTypeRef(this.state, {
      allowTrailingPipe: true,
      parseLiteral: () => this.parseLiteral(),
    });
  }

  skipNewlines(this.state);
  if (check(this.state, TOKEN_TYPES.ASSIGN)) {
    advance(this.state);
    skipNewlines(this.state);
    defaultValue = this.parseLiteral();
  }

  return {
    type: 'ClosureParam',
    name: nameToken.value,
    typeRef,
    defaultValue,
    annotations,
    span: makeSpan(start, previous(this.state).span.end),
  };
};
