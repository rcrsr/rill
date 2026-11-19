/**
 * Parser Extension: Function Literal Parsing
 * The fn literal and fn type value, closure bodies, and yield validation
 */

import { Parser } from './parser.js';
import type {
  BlockNode,
  ClosureNode,
  ClosureParamNode,
  FnTypeNode,
  SourceLocation,
  TypeRef,
} from '../types.js';
import { ParseError, TOKEN_TYPES, unnamedParamsRead } from '../types.js';
import { check, current, makeSpan, peek, previous } from './state.js';
import { isLiteralStart } from './helpers.js';
import { parseFnSignature, scriptTypeOpts } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseFnForm(): ClosureNode | FnTypeNode;
  }
}

// ============================================================
// FN LITERAL PARSING
// ============================================================

/**
 * Check whether a closure body contains any yield terminators at the
 * immediate level (not inside nested closures). Returns true if at
 * least one yield is found.
 * @internal
 */
function bodyContainsYield(body: BlockNode): boolean {
  for (const stmt of body.statements) {
    const expr =
      stmt.type === 'AnnotatedStatement'
        ? stmt.statement.expression
        : stmt.expression;
    if (expr.terminator?.type === 'Yield') return true;
  }
  return false;
}

/**
 * Validate that yield nodes in a closure body are only present when
 * the closure has a stream return type. Throws RILL-P006 if yield
 * appears without a `:stream(T):R` result type.
 * @internal
 */
function validateYieldInClosure(
  body: BlockNode,
  returnTypeTarget: TypeRef | undefined,
  closureStart: SourceLocation
): void {
  if (!bodyContainsYield(body)) return;

  const isStream =
    returnTypeTarget?.kind === 'static' &&
    returnTypeTarget.typeName === 'stream';

  if (!isStream) {
    throw new ParseError(
      ERROR_IDS.RILL_P006,
      "'yield' is only valid inside a stream closure",
      closureStart
    );
  }
}

/**
 * Increment closureDepth, call fn(), decrement in finally.
 * Guards against depth counter leaks when the body parse throws.
 */
function withClosureDepth<T>(parser: Parser, fn: () => T): T {
  parser.closureDepth++;
  try {
    return fn();
  } finally {
    parser.closureDepth--;
  }
}

/**
 * True when the cursor, on the same line as the fn signature, starts an
 * expression: the removed bare-body form `fn(x) $x * 2`.
 */
function startsBodyExpression(parser: Parser): boolean {
  return (
    isLiteralStart(parser.state) ||
    check(
      parser.state,
      TOKEN_TYPES.DOLLAR,
      TOKEN_TYPES.PIPE_VAR,
      TOKEN_TYPES.IDENTIFIER,
      TOKEN_TYPES.ATOM,
      TOKEN_TYPES.MINUS
    )
  );
}

/**
 * The params of a bare `fn { body }`: one for each of `$` and `$@` the body
 * reads, in that order.
 */
function inferUnnamedParams(
  body: BlockNode,
  fnSpan: ClosureParamNode['span']
): ClosureParamNode[] {
  const count = unnamedParamsRead(body);
  const names = ['$', '@'].slice(0, count);
  return names.map((name) => ({
    type: 'ClosureParam',
    name,
    typeRef: null,
    defaultValue: null,
    span: fnSpan,
  }));
}

/**
 * Parse an fn form: the fn literal `fn(params):outer { body }` or, with no
 * body on the signature's line, the fn type value.
 *
 * Grammar: `fn-signature ( block | )`. The body `{` must sit on the same line
 * as the signature. A bare `fn { body }` or `fn:T { body }` takes the unnamed
 * params its body reads. The removed paren and bare-expression bodies raise
 * RILL-P012; an `fn()` body reading `$` or `$@` raises RILL-P029.
 */
Parser.prototype.parseFnForm = function (
  this: Parser
): ClosureNode | FnTypeNode {
  const fnToken = current(this.state);
  const start = fnToken.span.start;
  const typeRef = parseFnSignature(this.state, scriptTypeOpts(this), true);

  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    const body = withClosureDepth(this, () => this.parseBlock(true));
    validateYieldInClosure(body, typeRef.outer, start);
    let params: ClosureParamNode[];
    if (typeRef.params === undefined) {
      params = inferUnnamedParams(body, fnToken.span);
    } else {
      params = typeRef.params;
      if (params.length === 0 && unnamedParamsRead(body) > 0) {
        throw new ParseError(
          ERROR_IDS.RILL_P029,
          "fn() declares no params, so its body cannot read '$' or '$@'",
          start
        );
      }
    }
    return {
      type: 'Closure',
      params,
      body,
      returnTypeTarget: typeRef.outer,
      span: makeSpan(start, body.span.end),
    };
  }

  const nameToken = current(this.state);
  if (
    typeRef.params === undefined &&
    typeRef.outer === undefined &&
    nameToken.type === TOKEN_TYPES.IDENTIFIER &&
    peek(this.state, 1).type === TOKEN_TYPES.LPAREN
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `fn takes no name; write fn(...) { ... } => $${nameToken.value} to name a function`,
      nameToken.span.start
    );
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      'Syntax removed: a parenthesized fn body was removed; write the body in braces, as in fn(x) { $x * 2 }',
      current(this.state).span.start
    );
  }
  if (startsBodyExpression(this)) {
    throw new ParseError(
      ERROR_IDS.RILL_P012,
      'Syntax removed: a bare fn body was removed; write the body in braces, as in fn(x) { $x }',
      current(this.state).span.start
    );
  }

  return {
    type: 'FnType',
    typeRef,
    span: makeSpan(start, previous(this.state).span.end),
  };
};
