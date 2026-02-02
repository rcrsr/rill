/**
 * Parser Extension: Literal Parsing
 * Strings, numbers, booleans, tuples, dicts, and closures
 */

import { Parser } from './parser.js';
import type {
  AnnotationArg,
  ClosureNode,
  ClosureParamNode,
  DictEntryNode,
  DictNode,
  ExpressionNode,
  InterpolationNode,
  LiteralNode,
  ListSpreadNode,
  BodyNode,
  SourceLocation,
  StringLiteralNode,
  TupleNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { tokenize } from '../lexer/index.js';
import {
  check,
  advance,
  expect,
  current,
  skipNewlines,
  makeSpan,
} from './state.js';
import {
  isDictStart,
  FUNC_PARAM_TYPES,
  parseTypeName,
  isNegativeNumber,
} from './helpers.js';

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseLiteral(): LiteralNode;
    parseString(): StringLiteralNode;
    parseStringParts(
      raw: string,
      baseLocation: SourceLocation,
      isTokenMultiline: boolean
    ): (string | InterpolationNode)[];
    parseInterpolationExpr(
      source: string,
      baseLocation: SourceLocation
    ): InterpolationNode;
    unescapeBraces(s: string): string;
    parseTupleOrDict(): TupleNode | DictNode;
    parseTuple(start: SourceLocation): TupleNode;
    parseTupleElement(): ExpressionNode | ListSpreadNode;
    parseDict(start: SourceLocation): DictNode;
    parseDictEntry(): DictEntryNode;
    parseClosure(): ClosureNode;
    parseBody(): BodyNode;
    parseClosureParam(): ClosureParamNode;
  }
}

// ============================================================
// LITERAL PARSING
// ============================================================

Parser.prototype.parseLiteral = function (this: Parser): LiteralNode {
  if (check(this.state, TOKEN_TYPES.STRING)) {
    return this.parseString();
  }

  if (check(this.state, TOKEN_TYPES.NUMBER)) {
    const token = advance(this.state);
    return {
      type: 'NumberLiteral',
      value: parseFloat(token.value),
      span: token.span,
    };
  }

  if (check(this.state, TOKEN_TYPES.TRUE)) {
    const token = advance(this.state);
    return { type: 'BoolLiteral', value: true, span: token.span };
  }

  if (check(this.state, TOKEN_TYPES.FALSE)) {
    const token = advance(this.state);
    return { type: 'BoolLiteral', value: false, span: token.span };
  }

  if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    return this.parseTupleOrDict();
  }

  const token = current(this.state);
  let hint = '';
  if (token.type === TOKEN_TYPES.ASSIGN) {
    hint = ". Hint: Use '->' for assignment, not '='";
  } else if (token.type === TOKEN_TYPES.EOF) {
    hint = '. Hint: Unexpected end of input';
  }
  throw new ParseError(
    `Expected literal, got: ${token.value}${hint}`,
    token.span.start
  );
};

// ============================================================
// STRING PARSING
// ============================================================

Parser.prototype.parseString = function (this: Parser): StringLiteralNode {
  const token = advance(this.state);
  const raw = token.value;

  // Token is multiline if it spans multiple lines (detects """\\n... case)
  const isTokenMultiline = token.span.end.line > token.span.start.line;

  const parts = this.parseStringParts(raw, token.span.start, isTokenMultiline);

  return {
    type: 'StringLiteral',
    parts,
    isMultiline: raw.includes('\n'),
    span: token.span,
  };
};

Parser.prototype.parseStringParts = function (
  this: Parser,
  raw: string,
  baseLocation: SourceLocation,
  isTokenMultiline: boolean
): (string | InterpolationNode)[] {
  const parts: (string | InterpolationNode)[] = [];
  let i = 0;
  let literalStart = 0;

  while (i < raw.length) {
    if (raw[i] === '{') {
      if (raw[i + 1] === '{') {
        i += 2;
        continue;
      }

      if (i > literalStart) {
        const literal = this.unescapeBraces(raw.slice(literalStart, i));
        if (literal) parts.push(literal);
      }

      const exprStart = i + 1;
      let depth = 1;
      i++;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{' && raw[i + 1] === '{') {
          i += 2;
          continue;
        }
        if (raw[i] === '}' && raw[i + 1] === '}') {
          i += 2;
          continue;
        }
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') depth--;
        i++;
      }

      if (depth !== 0) {
        throw new ParseError('Unterminated string interpolation', baseLocation);
      }

      const exprSource = raw.slice(exprStart, i - 1);
      if (!exprSource.trim()) {
        throw new ParseError('Empty string interpolation', baseLocation);
      }

      // Calculate the actual position of the interpolation in the source
      // baseLocation is the string token start (the opening quote(s))
      // For single-quote strings: raw starts immediately after opening "
      // For triple-quote strings: raw starts on the line after """ (opening newline is skipped)
      //
      // We need to map the position in raw to absolute source location
      const beforeInterp = raw.slice(0, exprStart);
      const newlines = (beforeInterp.match(/\n/g) || []).length;
      const lastNewlinePos = beforeInterp.lastIndexOf('\n');

      let interpLine: number;
      let interpColumn: number;
      let interpOffset: number;

      // Check if this is a multiline string token (spans multiple lines in source)
      // For triple-quote strings that had opening newline skipped, isTokenMultiline is true
      const contentStartsOnNextLine = isTokenMultiline && newlines === 0;

      if (newlines > 0) {
        // Has newlines in raw content before interpolation
        interpLine = baseLocation.line + (isTokenMultiline ? 1 : 0) + newlines;
        interpColumn = beforeInterp.length - lastNewlinePos;
        interpOffset =
          baseLocation.offset + (isTokenMultiline ? 4 : 1) + exprStart;
      } else if (contentStartsOnNextLine) {
        // Triple-quote string with skipped opening newline, but interpolation on first content line
        interpLine = baseLocation.line + 1;
        interpColumn = 1 + exprStart;
        interpOffset = baseLocation.offset + 4 + exprStart;
      } else {
        // Single-line string or interpolation on same line as opening quote
        interpLine = baseLocation.line;
        interpColumn = baseLocation.column + 1 + exprStart;
        interpOffset = baseLocation.offset + 1 + exprStart;
      }

      const interpolation = this.parseInterpolationExpr(exprSource, {
        line: interpLine,
        column: interpColumn,
        offset: interpOffset,
      });
      parts.push(interpolation);
      literalStart = i;
    } else if (raw[i] === '}' && raw[i + 1] === '}') {
      i += 2;
    } else {
      i++;
    }
  }

  if (literalStart < raw.length) {
    const literal = this.unescapeBraces(raw.slice(literalStart));
    if (literal) parts.push(literal);
  }

  if (parts.length === 0) {
    parts.push('');
  }

  return parts;
};

Parser.prototype.unescapeBraces = function (this: Parser, s: string): string {
  return s.replaceAll('{{', '{').replaceAll('}}', '}');
};

Parser.prototype.parseInterpolationExpr = function (
  this: Parser,
  source: string,
  baseLocation: SourceLocation
): InterpolationNode {
  // Tokenize with base location so tokens have correct absolute positions
  const tokens = tokenize(source, baseLocation);

  const filtered = tokens.filter(
    (t) => t.type !== TOKEN_TYPES.NEWLINE && t.type !== TOKEN_TYPES.COMMENT
  );

  if (filtered.length === 0 || filtered[0]?.type === TOKEN_TYPES.EOF) {
    throw new ParseError('Empty string interpolation', baseLocation);
  }

  const subParser = new Parser(filtered);
  const expression = subParser.parseExpression();

  if (subParser.state.tokens[subParser.state.pos]?.type !== TOKEN_TYPES.EOF) {
    throw new ParseError(
      `Unexpected token in interpolation: ${subParser.state.tokens[subParser.state.pos]?.value}`,
      baseLocation
    );
  }

  return {
    type: 'Interpolation',
    expression,
    span: expression.span,
  };
};

// ============================================================
// TUPLE & DICT PARSING
// ============================================================

Parser.prototype.parseTupleOrDict = function (
  this: Parser
): TupleNode | DictNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LBRACKET, 'Expected [');
  skipNewlines(this.state);

  if (check(this.state, TOKEN_TYPES.RBRACKET)) {
    advance(this.state);
    return {
      type: 'Tuple',
      elements: [],
      defaultValue: null,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  if (
    check(this.state, TOKEN_TYPES.COLON) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.RBRACKET
  ) {
    advance(this.state);
    advance(this.state);
    return {
      type: 'Dict',
      entries: [],
      defaultValue: null,
      span: makeSpan(start, current(this.state).span.end),
    };
  }

  if (isDictStart(this.state)) {
    return this.parseDict(start);
  }

  return this.parseTuple(start);
};

Parser.prototype.parseTuple = function (
  this: Parser,
  start: SourceLocation
): TupleNode {
  const elements: (ExpressionNode | ListSpreadNode)[] = [];
  elements.push(this.parseTupleElement());
  skipNewlines(this.state);

  while (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state);
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.RBRACKET)) break;
    elements.push(this.parseTupleElement());
    skipNewlines(this.state);
  }

  const rbracket = expect(this.state, TOKEN_TYPES.RBRACKET, 'Expected ]');
  return {
    type: 'Tuple',
    elements,
    defaultValue: null,
    span: makeSpan(start, rbracket.span.end),
  };
};

Parser.prototype.parseTupleElement = function (
  this: Parser
): ExpressionNode | ListSpreadNode {
  // Check for spread operator (ELLIPSIS token: ...)
  if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume ELLIPSIS

    // ELLIPSIS must be followed by an expression
    if (
      check(this.state, TOKEN_TYPES.COMMA) ||
      check(this.state, TOKEN_TYPES.RBRACKET) ||
      check(this.state, TOKEN_TYPES.EOF)
    ) {
      throw new ParseError(
        "Expected expression after '...'",
        current(this.state).span.start
      );
    }

    const expression = this.parseExpression();

    return {
      type: 'ListSpread',
      expression,
      span: makeSpan(start, expression.span.end),
    };
  }

  // Normal expression element
  return this.parseExpression();
};

Parser.prototype.parseDict = function (
  this: Parser,
  start: SourceLocation
): DictNode {
  const entries: DictEntryNode[] = [];
  entries.push(this.parseDictEntry());
  skipNewlines(this.state);

  while (check(this.state, TOKEN_TYPES.COMMA)) {
    advance(this.state);
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.RBRACKET)) break;
    entries.push(this.parseDictEntry());
    skipNewlines(this.state);
  }

  const rbracket = expect(this.state, TOKEN_TYPES.RBRACKET, 'Expected ]');
  return {
    type: 'Dict',
    entries,
    defaultValue: null,
    span: makeSpan(start, rbracket.span.end),
  };
};

Parser.prototype.parseDictEntry = function (this: Parser): DictEntryNode {
  const start = current(this.state).span.start;

  // Parse key: identifier, string, number, boolean, or list literal (multi-key)
  let key: string | number | boolean | TupleNode;

  if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    // Parse list literal as key (tuple for multi-key)
    const literal = this.parseTupleOrDict();
    if (literal.type !== 'Tuple') {
      throw new ParseError(
        'Dict entry key must be identifier or list, not dict',
        literal.span.start
      );
    }
    key = literal;
  } else if (check(this.state, TOKEN_TYPES.STRING)) {
    // Parse string literal as key
    const keyToken = advance(this.state);
    key = keyToken.value;
  } else if (isNegativeNumber(this.state)) {
    // Parse negative number as key: -NUMBER
    advance(this.state); // consume MINUS
    const numToken = advance(this.state); // consume NUMBER
    key = -Number(numToken.value);
  } else if (check(this.state, TOKEN_TYPES.NUMBER)) {
    // Parse number as key
    const keyToken = advance(this.state);
    key = Number(keyToken.value);
  } else if (check(this.state, TOKEN_TYPES.TRUE)) {
    // Parse boolean true as key
    advance(this.state);
    key = true;
  } else if (check(this.state, TOKEN_TYPES.FALSE)) {
    // Parse boolean false as key
    advance(this.state);
    key = false;
  } else if (check(this.state, TOKEN_TYPES.IDENTIFIER)) {
    // Parse identifier as string key
    const keyToken = advance(this.state);
    key = keyToken.value;
  } else {
    // Invalid token at key position
    throw new ParseError(
      'Dict key must be identifier, string, number, or boolean',
      current(this.state).span.start
    );
  }

  expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
  const value = this.parseExpression();

  return {
    type: 'DictEntry',
    key,
    value,
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// CLOSURE PARSING
// ============================================================

Parser.prototype.parseClosure = function (this: Parser): ClosureNode {
  const start = current(this.state).span.start;

  if (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
    const body = this.parseBody();
    return {
      type: 'Closure',
      params: [],
      body,
      span: makeSpan(start, body.span.end),
    };
  }

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');

  const params: ClosureParamNode[] = [];
  if (!check(this.state, TOKEN_TYPES.PIPE_BAR)) {
    params.push(this.parseClosureParam());
    while (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      params.push(this.parseClosureParam());
    }
  }

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');

  const body = this.parseBody();

  return {
    type: 'Closure',
    params,
    body,
    span: makeSpan(start, body.span.end),
  };
};

Parser.prototype.parseBody = function (this: Parser): BodyNode {
  if (check(this.state, TOKEN_TYPES.LBRACE)) {
    return this.parseBlock();
  }

  if (check(this.state, TOKEN_TYPES.LPAREN)) {
    return this.parseGrouped();
  }

  if (
    check(this.state, TOKEN_TYPES.BREAK) ||
    check(this.state, TOKEN_TYPES.RETURN)
  ) {
    return this.parsePipeChain();
  }

  return this.parsePostfixExpr();
};

Parser.prototype.parseClosureParam = function (this: Parser): ClosureParamNode {
  const start = current(this.state).span.start;
  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected parameter name'
  );

  let typeName: 'string' | 'number' | 'bool' | null = null;
  let defaultValue: LiteralNode | null = null;
  let annotations: AnnotationArg[] | undefined = undefined;

  if (check(this.state, TOKEN_TYPES.COLON)) {
    advance(this.state);
    typeName = parseTypeName(this.state, FUNC_PARAM_TYPES);
  }

  // Parse parameter annotations (after type, before default)
  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state); // consume ^
    expect(this.state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
    annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )');
  }

  if (check(this.state, TOKEN_TYPES.ASSIGN)) {
    advance(this.state);
    defaultValue = this.parseLiteral();
  }

  return {
    type: 'ClosureParam',
    name: nameToken.value,
    typeName,
    defaultValue,
    annotations,
    span: makeSpan(start, current(this.state).span.end),
  };
};
