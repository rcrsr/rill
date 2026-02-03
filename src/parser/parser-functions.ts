/**
 * Parser Extension: Function Parsing
 * Function calls, method calls, closure calls, and type operations
 */

import { Parser } from './parser.js';
import type {
  ClosureCallNode,
  ExpressionNode,
  HostCallNode,
  MethodCallNode,
  PipeInvokeNode,
  PrimaryNode,
  SourceSpan,
  TypeAssertionNode,
  TypeCheckNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { check, advance, expect, current, makeSpan, peek } from './state.js';
import { VALID_TYPE_NAMES, parseTypeName } from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseArgumentList(): ExpressionNode[];
    parseHostCall(): HostCallNode;
    parseClosureCall(): ClosureCallNode;
    parsePipeInvoke(): PipeInvokeNode;
    parseMethodCall(receiverSpan?: SourceSpan | null): MethodCallNode;
    parseTypeOperation(): TypeAssertionNode | TypeCheckNode;
    parsePostfixTypeOperation(
      primary: PrimaryNode,
      start: { line: number; column: number; offset: number }
    ): TypeAssertionNode | TypeCheckNode;
  }
}

// ============================================================
// ARGUMENT LIST PARSING
// ============================================================

Parser.prototype.parseArgumentList = function (this: Parser): ExpressionNode[] {
  const args: ExpressionNode[] = [];
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(this.parseExpression());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      args.push(this.parseExpression());
    }
  }
  return args;
};

// ============================================================
// FUNCTION CALLS
// ============================================================

Parser.prototype.parseHostCall = function (this: Parser): HostCallNode {
  const start = current(this.state).span.start;

  // Collect namespaced name: ident or ident::ident::...
  // Accept keywords as identifiers (e.g., error(...) for custom functions)
  let name = advance(this.state).value;
  while (check(this.state, TOKEN_TYPES.DOUBLE_COLON)) {
    advance(this.state); // consume ::

    // After ::, accept identifier or keyword
    const token = current(this.state);

    const isValidIdent =
      token.type === TOKEN_TYPES.IDENTIFIER ||
      token.type === TOKEN_TYPES.TRUE ||
      token.type === TOKEN_TYPES.FALSE ||
      token.type === TOKEN_TYPES.BREAK ||
      token.type === TOKEN_TYPES.RETURN ||
      token.type === TOKEN_TYPES.ASSERT ||
      token.type === TOKEN_TYPES.ERROR ||
      token.type === TOKEN_TYPES.EACH ||
      token.type === TOKEN_TYPES.MAP ||
      token.type === TOKEN_TYPES.FOLD ||
      token.type === TOKEN_TYPES.FILTER;

    if (!isValidIdent) {
      throw new ParseError(
        'Expected identifier or keyword after ::',
        token.span.start,
        undefined,
        'RILL-P005'
      );
    }

    name += '::' + token.value;
    advance(this.state); // consume the identifier or keyword
  }

  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  const args = this.parseArgumentList();
  const rparen = expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');

  return {
    type: 'HostCall',
    name,
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

Parser.prototype.parseClosureCall = function (this: Parser): ClosureCallNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected variable name'
  );

  // Parse optional .property chain: $math.double(), $obj.nested.method()
  const accessChain: string[] = [];
  while (
    check(this.state, TOKEN_TYPES.DOT) &&
    peek(this.state, 1).type === TOKEN_TYPES.IDENTIFIER
  ) {
    advance(this.state); // consume .
    accessChain.push(advance(this.state).value); // consume identifier
  }

  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  const args = this.parseArgumentList();
  const rparen = expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');

  return {
    type: 'ClosureCall',
    name: nameToken.value,
    accessChain,
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

Parser.prototype.parsePipeInvoke = function (this: Parser): PipeInvokeNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.PIPE_VAR, 'Expected $');
  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  const args = this.parseArgumentList();
  const rparen = expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');

  return {
    type: 'PipeInvoke',
    args,
    span: makeSpan(start, rparen.span.end),
  };
};

// ============================================================
// METHOD CALLS
// ============================================================

Parser.prototype.parseMethodCall = function (
  this: Parser,
  receiverSpan?: SourceSpan | null
): MethodCallNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.DOT, 'Expected .');
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected method name'
  );

  let args: ExpressionNode[] = [];
  let endLoc = current(this.state).span.end;
  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    advance(this.state);
    args = this.parseArgumentList();
    const rparen = expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
    endLoc = rparen.span.end;
  }

  return {
    type: 'MethodCall',
    name: nameToken.value,
    args,
    receiverSpan: receiverSpan ?? null,
    span: makeSpan(start, endLoc),
  };
};

// ============================================================
// TYPE OPERATIONS
// ============================================================

Parser.prototype.parseTypeOperation = function (
  this: Parser
): TypeAssertionNode | TypeCheckNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');

  const isCheck = check(this.state, TOKEN_TYPES.QUESTION);
  if (isCheck) {
    advance(this.state);
  }

  const typeName = parseTypeName(this.state, VALID_TYPE_NAMES);

  const span = makeSpan(start, current(this.state).span.end);

  if (isCheck) {
    return {
      type: 'TypeCheck',
      operand: null,
      typeName,
      span,
    };
  }

  return {
    type: 'TypeAssertion',
    operand: null,
    typeName,
    span,
  };
};

Parser.prototype.parsePostfixTypeOperation = function (
  this: Parser,
  primary: PrimaryNode,
  start: { line: number; column: number; offset: number }
): TypeAssertionNode | TypeCheckNode {
  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');

  const isCheck = check(this.state, TOKEN_TYPES.QUESTION);
  if (isCheck) {
    advance(this.state);
  }

  const typeName = parseTypeName(this.state, VALID_TYPE_NAMES);

  const operand = {
    type: 'PostfixExpr' as const,
    primary,
    methods: [],
    span: makeSpan(start, current(this.state).span.end),
  };

  const span = makeSpan(start, current(this.state).span.end);

  if (isCheck) {
    return {
      type: 'TypeCheck',
      operand,
      typeName,
      span,
    };
  }

  return {
    type: 'TypeAssertion',
    operand,
    typeName,
    span,
  };
};
