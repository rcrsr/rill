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
  PipeChainNode,
  PipeInvokeNode,
  PostfixExprNode,
  PrimaryNode,
  SourceSpan,
  SpreadArgNode,
  TypeAssertionNode,
  TypeCheckNode,
  VariableNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  makeSpan,
  peek,
  skipNewlines,
} from './state.js';
import { isIdentifierOrKeyword } from './helpers.js';
import { parseTypeRef } from './parser-types.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseArgumentList(
      allowSpread?: boolean
    ): (ExpressionNode | SpreadArgNode)[];
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

Parser.prototype.parseArgumentList = function (
  this: Parser,
  allowSpread: boolean = false
): (ExpressionNode | SpreadArgNode)[] {
  const args: (ExpressionNode | SpreadArgNode)[] = [];
  let hasSpread = false;
  skipNewlines(this.state);
  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    args.push(parseOneArg(this, allowSpread, hasSpread));
    if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
      args.push(parseOneArg(this, allowSpread, hasSpread));
      if (args[args.length - 1]!.type === 'SpreadArg') hasSpread = true;
    }
  }
  skipNewlines(this.state);
  return args;
};

/**
 * Parse one argument, handling spread if allowed.
 * Enforces max-one-spread per list.
 */
function parseOneArg(
  parser: Parser,
  allowSpread: boolean,
  hasSpread: boolean
): ExpressionNode | SpreadArgNode {
  if (check(parser.state, TOKEN_TYPES.ELLIPSIS)) {
    if (!allowSpread) {
      throw new ParseError(
        'RILL-P006',
        'Spread not supported in method call argument lists',
        current(parser.state).span.start
      );
    }
    if (hasSpread) {
      throw new ParseError(
        'RILL-P007',
        'Only one spread argument (...) is allowed per argument list',
        current(parser.state).span.start
      );
    }
    const start = current(parser.state).span.start;
    advance(parser.state); // consume ...

    // Bare `...` before `)` or `,` → synthesize VariableNode for `$`
    if (
      check(parser.state, TOKEN_TYPES.RPAREN) ||
      check(parser.state, TOKEN_TYPES.COMMA)
    ) {
      const spreadSpan = makeSpan(start, current(parser.state).span.start);
      const varNode: VariableNode = {
        type: 'Variable',
        name: null,
        isPipeVar: true,
        accessChain: [],
        defaultValue: null,
        existenceCheck: null,
        span: spreadSpan,
      };
      const postfixNode: PostfixExprNode = {
        type: 'PostfixExpr',
        primary: varNode,
        methods: [],
        defaultValue: null,
        span: spreadSpan,
      };
      const pipeChainNode: PipeChainNode = {
        type: 'PipeChain',
        head: postfixNode,
        pipes: [],
        terminator: null,
        span: spreadSpan,
      };
      return {
        type: 'SpreadArg',
        expression: pipeChainNode,
        span: spreadSpan,
      } satisfies SpreadArgNode;
    }

    const expression = parser.parseExpression();
    return {
      type: 'SpreadArg',
      expression,
      span: makeSpan(start, current(parser.state).span.end),
    } satisfies SpreadArgNode;
  }

  return parser.parseExpression();
}

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

    if (!isIdentifierOrKeyword(token)) {
      throw new ParseError(
        'RILL-P001',
        'Expected identifier or keyword after ::',
        token.span.start
      );
    }

    name += '::' + token.value;
    advance(this.state); // consume the identifier or keyword
  }

  expect(this.state, TOKEN_TYPES.LPAREN, 'Expected (');
  const args = this.parseArgumentList(true);
  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

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
  const args = this.parseArgumentList(true);
  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

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
  const args = this.parseArgumentList(true);
  const rparen = expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected )',
    'RILL-P005'
  );

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
    // allowSpread defaults to false — spread not supported in method calls
    args = this.parseArgumentList() as ExpressionNode[];
    const rparen = expect(
      this.state,
      TOKEN_TYPES.RPAREN,
      'Expected )',
      'RILL-P005'
    );
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

  // Disambiguation: $identifier → dynamic type reference
  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    advance(this.state); // consume $
    const nameToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected variable name after $'
    );
    const typeRef = { kind: 'dynamic' as const, varName: nameToken.value };
    const span = makeSpan(start, current(this.state).span.end);
    if (isCheck) {
      return { type: 'TypeCheck', operand: null, typeRef, span };
    }
    return { type: 'TypeAssertion', operand: null, typeRef, span };
  }

  // Default: plain type name → existing TypeAssertion / TypeCheck
  const typeRef = parseTypeRef(this.state);
  if (typeRef.kind !== 'static')
    throw new Error('Unreachable: $ already handled above');
  const span = makeSpan(start, current(this.state).span.end);

  if (isCheck) {
    return { type: 'TypeCheck', operand: null, typeRef, span };
  }
  return { type: 'TypeAssertion', operand: null, typeRef, span };
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

  const makeOperand = (): PostfixExprNode => ({
    type: 'PostfixExpr' as const,
    primary,
    methods: [],
    defaultValue: null,
    span: makeSpan(start, current(this.state).span.end),
  });

  // Disambiguation: $identifier → dynamic type reference
  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    advance(this.state); // consume $
    const nameToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected variable name after $'
    );
    const typeRef = { kind: 'dynamic' as const, varName: nameToken.value };
    const operand = makeOperand();
    const span = makeSpan(start, current(this.state).span.end);
    if (isCheck) {
      return { type: 'TypeCheck', operand, typeRef, span };
    }
    return { type: 'TypeAssertion', operand, typeRef, span };
  }

  // Default: plain type name → existing TypeAssertion / TypeCheck
  const typeRef = parseTypeRef(this.state);
  if (typeRef.kind !== 'static')
    throw new Error('Unreachable: $ already handled above');
  const operand = makeOperand();
  const span = makeSpan(start, current(this.state).span.end);

  if (isCheck) {
    return { type: 'TypeCheck', operand, typeRef, span };
  }
  return { type: 'TypeAssertion', operand, typeRef, span };
};
