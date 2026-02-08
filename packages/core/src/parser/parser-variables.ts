/**
 * Parser Extension: Variable Parsing
 * Variables and access chains
 */

import { Parser } from './parser.js';
import type {
  ExistenceCheck,
  FieldAccess,
  PropertyAccess,
  BodyNode,
  SourceLocation,
  VariableNode,
} from '../types.js';
import { TOKEN_TYPES, ParseError } from '../types.js';
import { check, advance, expect, makeSpan, current } from './state.js';
import {
  isMethodCallWithArgs,
  VALID_TYPE_NAMES,
  parseTypeName,
} from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseVariable(): VariableNode;
    makeVariableWithAccess(
      name: string | null,
      isPipeVar: boolean,
      start: SourceLocation
    ): VariableNode;
    parseAccessChain(): {
      accessChain: PropertyAccess[];
      existenceCheck: ExistenceCheck | null;
    };
    parseFieldAccessElement(isExistenceCheck?: boolean): FieldAccess | null;
    parseComputedOrAlternatives(isExistenceCheck?: boolean): FieldAccess;
    tryParseAlternatives(): string[] | null;
    parseDefaultValue(): BodyNode;
  }
}

// ============================================================
// VARIABLE PARSING
// ============================================================

Parser.prototype.parseVariable = function (this: Parser): VariableNode {
  const start = this.state.tokens[this.state.pos]!.span.start;

  if (check(this.state, TOKEN_TYPES.PIPE_VAR)) {
    advance(this.state);
    return this.makeVariableWithAccess(null, true, start);
  }

  const dollarToken = expect(this.state, TOKEN_TYPES.DOLLAR, 'Expected $');

  if (dollarToken.value === '$@') {
    return this.makeVariableWithAccess('@', false, start);
  }

  // Handle $ followed by access chain (no name): $[0], $.field
  if (
    check(this.state, TOKEN_TYPES.LBRACKET) ||
    check(this.state, TOKEN_TYPES.DOT) ||
    check(this.state, TOKEN_TYPES.DOT_QUESTION)
  ) {
    return this.makeVariableWithAccess(null, true, start);
  }

  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected variable name'
  );

  return this.makeVariableWithAccess(nameToken.value, false, start);
};

Parser.prototype.makeVariableWithAccess = function (
  this: Parser,
  name: string | null,
  isPipeVar: boolean,
  start: SourceLocation
): VariableNode {
  const { accessChain, existenceCheck } = this.parseAccessChain();

  let defaultValue: BodyNode | null = null;
  if (check(this.state, TOKEN_TYPES.NULLISH_COALESCE)) {
    if (existenceCheck) {
      const token = current(this.state);
      throw new ParseError(
        'RILL-P003',
        'Cannot combine existence check (.?field) with default value operator (??). Use one or the other.',
        token.span.start
      );
    }
    advance(this.state);
    defaultValue = this.parseDefaultValue();
  }

  return {
    type: 'Variable',
    name,
    isPipeVar,
    accessChain,
    defaultValue,
    existenceCheck,
    span: makeSpan(start, start),
  };
};

Parser.prototype.parseAccessChain = function (this: Parser): {
  accessChain: PropertyAccess[];
  existenceCheck: ExistenceCheck | null;
} {
  const accessChain: PropertyAccess[] = [];
  let existenceCheck: ExistenceCheck | null = null;

  while (
    check(
      this.state,
      TOKEN_TYPES.DOT,
      TOKEN_TYPES.DOT_QUESTION,
      TOKEN_TYPES.LBRACKET
    )
  ) {
    if (
      check(this.state, TOKEN_TYPES.DOT) &&
      isMethodCallWithArgs(this.state)
    ) {
      break;
    }

    if (check(this.state, TOKEN_TYPES.LBRACKET)) {
      const openBracket = advance(this.state);
      const expression = this.parsePipeChain();
      const closeBracket = expect(
        this.state,
        TOKEN_TYPES.RBRACKET,
        'Expected ] after index expression',
        'RILL-P005'
      );
      const span = makeSpan(openBracket.span.start, closeBracket.span.end);
      accessChain.push({ accessKind: 'bracket', expression, span });
      continue;
    }

    if (check(this.state, TOKEN_TYPES.DOT_QUESTION)) {
      advance(this.state);
      const finalAccess = this.parseFieldAccessElement(true);
      if (!finalAccess) {
        break;
      }

      let typeName: ExistenceCheck['typeName'] = null;
      if (check(this.state, TOKEN_TYPES.AMPERSAND)) {
        advance(this.state);
        typeName = parseTypeName(this.state, VALID_TYPE_NAMES);
      }

      existenceCheck = { finalAccess, typeName };
      break;
    }

    advance(this.state);

    const access = this.parseFieldAccessElement();
    if (!access) {
      break;
    }
    accessChain.push(access);
  }

  return { accessChain, existenceCheck };
};

Parser.prototype.parseFieldAccessElement = function (
  this: Parser,
  isExistenceCheck = false
): FieldAccess | null {
  // Handle .$variable (variable key access)
  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    advance(this.state);
    const errorMsg = isExistenceCheck
      ? 'Expected variable name after .?$'
      : 'Expected variable name after .$';
    const nameToken = expect(this.state, TOKEN_TYPES.IDENTIFIER, errorMsg);
    return { kind: 'variable', variableName: nameToken.value };
  }

  // Handle .$ (pipe variable as key)
  if (check(this.state, TOKEN_TYPES.PIPE_VAR)) {
    advance(this.state);
    return { kind: 'variable', variableName: null };
  }

  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state);
    const keyToken = expect(
      this.state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected annotation key after .^'
    );
    return { kind: 'annotation', key: keyToken.value };
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    return this.parseComputedOrAlternatives(isExistenceCheck);
  }

  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    const block = this.parseBlock();
    return { kind: 'block', block };
  }

  if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return { kind: 'literal', field: advance(this.state).value };
  }

  return null;
};

Parser.prototype.parseComputedOrAlternatives = function (
  this: Parser,
  isExistenceCheck = false
): FieldAccess {
  advance(this.state);

  // For existence checks, only parse computed expressions, not alternatives
  if (!isExistenceCheck) {
    const alternatives = this.tryParseAlternatives();
    if (alternatives) {
      expect(
        this.state,
        TOKEN_TYPES.RPAREN,
        'Expected ) after alternatives',
        'RILL-P005'
      );
      return { kind: 'alternatives', alternatives };
    }
  }

  const expression = this.parsePipeChain();
  expect(
    this.state,
    TOKEN_TYPES.RPAREN,
    'Expected ) after expression',
    'RILL-P005'
  );
  return { kind: 'computed', expression };
};

Parser.prototype.tryParseAlternatives = function (
  this: Parser
): string[] | null {
  const savedPos = this.state.pos;

  const alternatives: string[] = [];

  if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    return null;
  }
  alternatives.push(advance(this.state).value);

  if (!check(this.state, TOKEN_TYPES.OR)) {
    this.state.pos = savedPos;
    return null;
  }

  while (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
    if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
      this.state.pos = savedPos;
      return null;
    }
    alternatives.push(advance(this.state).value);
  }

  if (!check(this.state, TOKEN_TYPES.RPAREN)) {
    this.state.pos = savedPos;
    return null;
  }

  return alternatives;
};

Parser.prototype.parseDefaultValue = function (this: Parser): BodyNode {
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    return this.parseBlock();
  }

  return this.parsePipeChain();
};
