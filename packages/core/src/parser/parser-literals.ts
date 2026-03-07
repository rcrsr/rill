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
  DictKeyComputed,
  DictKeyVariable,
  DictLiteralNode,
  DictNode,
  ExpressionNode,
  InterpolationNode,
  ListLiteralNode,
  LiteralNode,
  ListSpreadNode,
  BodyNode,
  OrderedLiteralNode,
  SourceLocation,
  StringLiteralNode,
  TupleLiteralNode,
  TypeRef,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import { tokenize } from '../lexer/index.js';
import {
  check,
  advance,
  expect,
  current,
  peek,
  skipNewlines,
  makeSpan,
} from './state.js';
import { isDictStart, isNegativeNumber, VALID_TYPE_NAMES } from './helpers.js';
import { parseTypeRef } from './parser-types.js';

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
    parseTuple(start: SourceLocation): ListLiteralNode;
    parseTupleOrDict(): ListLiteralNode | DictNode;
    parseTupleElement(): ExpressionNode | ListSpreadNode;
    parseDict(start: SourceLocation): DictNode;
    parseDictEntry(): DictEntryNode;
    parseClosure(): ClosureNode;
    parseBody(): BodyNode;
    parseClosureParam(): ClosureParamNode;
    parseCollectionLiteral(
      collectionType: 'list' | 'dict' | 'tuple' | 'ordered'
    ):
      | ListLiteralNode
      | DictLiteralNode
      | TupleLiteralNode
      | OrderedLiteralNode;
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
    'RILL-P001',
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
        throw new ParseError(
          'RILL-P005',
          'Unterminated string interpolation',
          baseLocation
        );
      }

      const exprSource = raw.slice(exprStart, i - 1);
      if (!exprSource.trim()) {
        throw new ParseError(
          'RILL-P004',
          'Empty string interpolation',
          baseLocation
        );
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
    throw new ParseError(
      'RILL-P004',
      'Empty string interpolation',
      baseLocation
    );
  }

  const subParser = new Parser(filtered);
  const expression = subParser.parseExpression();

  if (subParser.state.tokens[subParser.state.pos]?.type !== TOKEN_TYPES.EOF) {
    throw new ParseError(
      'RILL-P001',
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

Parser.prototype.parseTuple = function (
  this: Parser,
  start: SourceLocation
): ListLiteralNode {
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

  const rbracket = expect(
    this.state,
    TOKEN_TYPES.RBRACKET,
    'Expected ]',
    'RILL-P005'
  );
  return {
    type: 'ListLiteral',
    elements: elements as ExpressionNode[],
    defaultValue: null,
    span: makeSpan(start, rbracket.span.end),
  } satisfies ListLiteralNode;
};

Parser.prototype.parseTupleOrDict = function (
  this: Parser
): ListLiteralNode | DictNode {
  const start = current(this.state).span.start;
  expect(this.state, TOKEN_TYPES.LBRACKET, 'Expected [');
  skipNewlines(this.state);

  // [] → empty list
  if (check(this.state, TOKEN_TYPES.RBRACKET)) {
    const rbracket = advance(this.state);
    return {
      type: 'ListLiteral',
      elements: [],
      defaultValue: null,
      span: makeSpan(start, rbracket.span.end),
    };
  }

  // [:] → empty dict
  if (
    check(this.state, TOKEN_TYPES.COLON) &&
    this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.RBRACKET
  ) {
    advance(this.state); // consume :
    const rbracket = advance(this.state); // consume ]
    return {
      type: 'Dict',
      entries: [],
      defaultValue: null,
      span: makeSpan(start, rbracket.span.end),
    };
  }

  if (isDictStart(this.state)) {
    return this.parseDict(start);
  }

  return this.parseTuple(start);
};

Parser.prototype.parseTupleElement = function (
  this: Parser
): ExpressionNode | ListSpreadNode {
  // Check for spread operator (ELLIPSIS token: ...)
  if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume ELLIPSIS
    skipNewlines(this.state);

    // ELLIPSIS must be followed by an expression
    if (
      check(this.state, TOKEN_TYPES.COMMA) ||
      check(this.state, TOKEN_TYPES.RBRACKET) ||
      check(this.state, TOKEN_TYPES.EOF)
    ) {
      throw new ParseError(
        'RILL-P004',
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

  const rbracket = expect(
    this.state,
    TOKEN_TYPES.RBRACKET,
    'Expected ]',
    'RILL-P005'
  );
  return {
    type: 'Dict',
    entries,
    defaultValue: null,
    span: makeSpan(start, rbracket.span.end),
  };
};

Parser.prototype.parseDictEntry = function (this: Parser): DictEntryNode {
  const start = current(this.state).span.start;

  // Parse key: identifier, string, number, boolean, variable, computed, or list literal (multi-key)
  let key:
    | string
    | number
    | boolean
    | ListLiteralNode
    | DictKeyVariable
    | DictKeyComputed;

  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    // Parse variable key: $variableName
    advance(this.state); // consume $
    if (!check(this.state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        'RILL-P001',
        'Expected variable name after $',
        current(this.state).span.start
      );
    }
    const varToken = advance(this.state);
    key = {
      kind: 'variable',
      variableName: varToken.value,
    };
  } else if (check(this.state, TOKEN_TYPES.PIPE_VAR)) {
    // Standalone $ without identifier - error
    throw new ParseError(
      'RILL-P001',
      'Expected variable name after $',
      current(this.state).span.start
    );
  } else if (check(this.state, TOKEN_TYPES.LPAREN)) {
    // Parse computed key: (expression)
    advance(this.state); // consume (
    const expression = this.parsePipeChain();
    if (!check(this.state, TOKEN_TYPES.RPAREN)) {
      throw new ParseError(
        'RILL-P005',
        'Expected ) after computed key expression',
        current(this.state).span.start
      );
    }
    advance(this.state); // consume )
    key = {
      kind: 'computed',
      expression,
    };
  } else if (check(this.state, TOKEN_TYPES.LBRACKET)) {
    // Parse bare [a, b] or [] as multi-key
    const tupleStart = current(this.state).span.start;
    advance(this.state); // consume [
    skipNewlines(this.state);
    if (check(this.state, TOKEN_TYPES.RBRACKET)) {
      const rbracket = advance(this.state);
      key = {
        type: 'ListLiteral',
        elements: [],
        defaultValue: null,
        span: makeSpan(tupleStart, rbracket.span.end),
      } as ListLiteralNode;
    } else {
      key = this.parseTuple(tupleStart);
    }
  } else if (check(this.state, TOKEN_TYPES.LIST_LBRACKET)) {
    // Parse list[...] literal as multi-key: dict[list["a", "b"]: value]
    advance(this.state); // consume list[
    const literal = this.parseCollectionLiteral('list') as ListLiteralNode;
    key = literal;
  } else if (check(this.state, TOKEN_TYPES.DICT_LBRACKET)) {
    // dict[...] is not a valid key — reject with clear error
    throw new ParseError(
      'RILL-P004',
      'Dict entry key must be identifier or list, not dict',
      current(this.state).span.start
    );
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
      'RILL-P001',
      'Dict key must be identifier, string, number, boolean, variable, or expression',
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

/**
 * Parse the optional postfix `:type-target` after a closure body.
 *
 * Grammar: [ ":" , type-target ]
 * type-target = shape(...) | type-ref
 *
 * Returns the parsed TypeRef or ShapeLiteralNode, or undefined if absent.
 * Follows the same disambiguation logic as parsePostfixTypeOperation.
 */
function parseClosureReturnTypeTarget(parser: Parser): TypeRef | undefined {
  skipNewlines(parser.state);
  if (!check(parser.state, TOKEN_TYPES.COLON)) {
    return undefined;
  }
  advance(parser.state); // consume ':'
  skipNewlines(parser.state);

  // Default: plain type name or dynamic type reference
  return parseTypeRef(parser.state);
}

Parser.prototype.parseClosure = function (this: Parser): ClosureNode {
  const start = current(this.state).span.start;

  if (check(this.state, TOKEN_TYPES.OR)) {
    advance(this.state);
    skipNewlines(this.state);
    const body = this.parseBody();
    const returnTypeTarget = parseClosureReturnTypeTarget(this);
    return {
      type: 'Closure',
      params: [],
      body,
      returnTypeTarget,
      span: makeSpan(
        start,
        returnTypeTarget ? current(this.state).span.end : body.span.end
      ),
    };
  }

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |');
  skipNewlines(this.state);

  // Anonymous typed closure detection: |type| body or |$typeVar| body
  // Static: current is IDENTIFIER in VALID_TYPE_NAMES, next non-newline is PIPE_BAR
  // Dynamic: current is DOLLAR ($typeVar form)
  const isAnonymousTyped = (() => {
    if (check(this.state, TOKEN_TYPES.DOLLAR)) {
      // Dynamic type ref: $identifier — next non-newline after $ and name must be PIPE_BAR.
      // Delegate detection to lookahead: offset 1 is identifier, offset 2 is PIPE_BAR (skip newlines).
      let lookahead = 2;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      return peek(this.state, lookahead).type === TOKEN_TYPES.PIPE_BAR;
    }
    if (
      check(this.state, TOKEN_TYPES.IDENTIFIER) &&
      VALID_TYPE_NAMES.includes(
        current(this.state).value as (typeof VALID_TYPE_NAMES)[number]
      )
    ) {
      // Static type name: peek past any newlines to find PIPE_BAR (not COLON)
      let lookahead = 1;
      while (peek(this.state, lookahead).type === TOKEN_TYPES.NEWLINE) {
        lookahead++;
      }
      return peek(this.state, lookahead).type === TOKEN_TYPES.PIPE_BAR;
    }
    return false;
  })();

  if (isAnonymousTyped) {
    const paramStart = current(this.state).span.start;
    const typeRef = parseTypeRef(this.state);
    expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', 'RILL-P005');
    skipNewlines(this.state);
    const body = this.parseBody();
    const returnTypeTarget = parseClosureReturnTypeTarget(this);
    const param: ClosureParamNode = {
      type: 'ClosureParam',
      name: '$',
      typeRef,
      defaultValue: null,
      span: makeSpan(paramStart, current(this.state).span.start),
    };
    return {
      type: 'Closure',
      params: [param],
      body,
      returnTypeTarget,
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

  expect(this.state, TOKEN_TYPES.PIPE_BAR, 'Expected |', 'RILL-P005');
  skipNewlines(this.state);

  const body = this.parseBody();
  const returnTypeTarget = parseClosureReturnTypeTarget(this);

  return {
    type: 'Closure',
    params,
    body,
    returnTypeTarget,
    span: makeSpan(
      start,
      returnTypeTarget ? current(this.state).span.end : body.span.end
    ),
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

  let annotations: AnnotationArg[] | undefined = undefined;

  // Parse parameter annotations before the name: ^(annots) name : type = default
  if (check(this.state, TOKEN_TYPES.CARET)) {
    advance(this.state); // consume ^
    expect(this.state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
    annotations = this.parseAnnotationArgs();
    expect(this.state, TOKEN_TYPES.RPAREN, 'Expected )', 'RILL-P005');
  }

  const nameToken = expect(
    this.state,
    TOKEN_TYPES.IDENTIFIER,
    'Expected parameter name'
  );

  if (
    VALID_TYPE_NAMES.includes(
      nameToken.value as (typeof VALID_TYPE_NAMES)[number]
    )
  ) {
    throw new ParseError(
      'RILL-P003',
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
    typeRef = parseTypeRef(this.state);
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
    span: makeSpan(start, current(this.state).span.end),
  };
};

// ============================================================
// KEYWORD-PREFIXED COLLECTION LITERAL PARSING
// ============================================================

/**
 * Track seen keys for dict/ordered literals to enforce key uniqueness.
 * Returns the string form of a key for comparison purposes.
 */
function keyToString(key: DictEntryNode['key']): string {
  if (
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'boolean'
  ) {
    return String(key);
  }
  if ('kind' in key && key.kind === 'variable') {
    return `$${key.variableName}`;
  }
  if ('kind' in key && key.kind === 'computed') {
    return '(computed)';
  }
  // TupleNode key — use type tag to avoid collisions; uniqueness not enforced for tuple keys
  return '(tuple-key)';
}

/**
 * Parse a keyword-prefixed collection literal.
 *
 * Called after consuming LIST_LBRACKET, DICT_LBRACKET, TUPLE_LBRACKET, or
 * ORDERED_LBRACKET. The opening token is already consumed by the caller.
 *
 * Grammar (all variants close with `]`):
 *   list[    expr ("," expr)*  [","]  "]"
 *   tuple[   expr ("," expr)*  [","]  "]"
 *   dict[    (key ":" expr) ("," key ":" expr)*  [","]  "]"
 *   ordered[ (key ":" expr) ("," key ":" expr)*  [","]  "]"
 *
 * Spread (`...$x`) is valid inside all four variants.
 */
Parser.prototype.parseCollectionLiteral = function (
  this: Parser,
  collectionType: 'list' | 'dict' | 'tuple' | 'ordered'
): ListLiteralNode | DictLiteralNode | TupleLiteralNode | OrderedLiteralNode {
  const start = current(this.state).span.start;
  skipNewlines(this.state);

  const isValueOnly = collectionType === 'list' || collectionType === 'tuple';

  if (isValueOnly) {
    // list[ ... ] or tuple[ ... ]
    const elements: ExpressionNode[] = [];

    while (!check(this.state, TOKEN_TYPES.RBRACKET)) {
      if (check(this.state, TOKEN_TYPES.EOF)) {
        throw new ParseError(
          'RILL-P005',
          `expected ']' to close ${collectionType} literal`,
          current(this.state).span.start
        );
      }

      // Spread element: ...$other
      if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
        const spreadStart = current(this.state).span.start;
        advance(this.state); // consume ELLIPSIS
        skipNewlines(this.state);
        if (
          check(this.state, TOKEN_TYPES.COMMA) ||
          check(this.state, TOKEN_TYPES.RBRACKET) ||
          check(this.state, TOKEN_TYPES.EOF)
        ) {
          throw new ParseError(
            'RILL-P004',
            "Expected expression after '...'",
            current(this.state).span.start
          );
        }
        const spreadExpr = this.parseExpression();
        elements.push({
          type: 'ListSpread',
          expression: spreadExpr,
          span: makeSpan(spreadStart, spreadExpr.span.end),
        } as unknown as ExpressionNode);
        skipNewlines(this.state);
      } else {
        // Check for key: value pair — not allowed in list/tuple
        // Lookahead: IDENTIFIER COLON (or STRING COLON, etc.) → error
        if (
          (check(this.state, TOKEN_TYPES.IDENTIFIER) ||
            check(this.state, TOKEN_TYPES.STRING) ||
            check(this.state, TOKEN_TYPES.NUMBER)) &&
          this.state.tokens[this.state.pos + 1]?.type === TOKEN_TYPES.COLON
        ) {
          throw new ParseError(
            'RILL-P004',
            `unexpected key-value pair in ${collectionType} literal`,
            current(this.state).span.start
          );
        }

        elements.push(this.parseExpression());
        skipNewlines(this.state);
      }

      if (check(this.state, TOKEN_TYPES.COMMA)) {
        advance(this.state);
        skipNewlines(this.state);
      } else {
        break;
      }
    }

    const rbracket = expect(
      this.state,
      TOKEN_TYPES.RBRACKET,
      `expected ']' to close ${collectionType} literal`,
      'RILL-P005'
    );

    const span = makeSpan(start, rbracket.span.end);

    if (collectionType === 'list') {
      return {
        type: 'ListLiteral',
        elements,
        defaultValue: null,
        span,
      } satisfies ListLiteralNode;
    }
    return { type: 'TupleLiteral', elements, span } satisfies TupleLiteralNode;
  }

  // dict[ ... ] or ordered[ ... ]
  const entries: DictEntryNode[] = [];
  const seenKeys = new Set<string>();

  while (!check(this.state, TOKEN_TYPES.RBRACKET)) {
    if (check(this.state, TOKEN_TYPES.EOF)) {
      throw new ParseError(
        'RILL-P005',
        `expected ']' to close ${collectionType} literal`,
        current(this.state).span.start
      );
    }

    // Spread entry: ...$other
    if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
      const spreadStart = current(this.state).span.start;
      advance(this.state); // consume ELLIPSIS
      skipNewlines(this.state);
      if (
        check(this.state, TOKEN_TYPES.COMMA) ||
        check(this.state, TOKEN_TYPES.RBRACKET) ||
        check(this.state, TOKEN_TYPES.EOF)
      ) {
        throw new ParseError(
          'RILL-P004',
          "Expected expression after '...'",
          current(this.state).span.start
        );
      }
      const spreadExpr = this.parseExpression();
      entries.push({
        type: 'DictEntry',
        key: '...',
        value: spreadExpr,
        span: makeSpan(spreadStart, spreadExpr.span.end),
      } as unknown as DictEntryNode);
      skipNewlines(this.state);
    } else {
      // Require key: value pair
      const entryStart = current(this.state).span.start;

      // Detect missing key (e.g. dict[1] without colon after)
      // LIST_LBRACKET and LBRACKET keys are multi-token, skip this check for them
      if (
        this.state.tokens[this.state.pos + 1]?.type !== TOKEN_TYPES.COLON &&
        !check(this.state, TOKEN_TYPES.DOLLAR) &&
        !check(this.state, TOKEN_TYPES.LPAREN) &&
        !check(this.state, TOKEN_TYPES.LIST_LBRACKET) &&
        !check(this.state, TOKEN_TYPES.LBRACKET) &&
        !check(this.state, TOKEN_TYPES.DICT_LBRACKET)
      ) {
        throw new ParseError(
          'RILL-P004',
          `expected 'key: value' pair in ${collectionType} literal`,
          entryStart
        );
      }

      const entry = this.parseDictEntry();
      const keyStr = keyToString(entry.key);
      if (seenKeys.has(keyStr)) {
        throw new ParseError(
          'RILL-P004',
          `duplicate key '${keyStr}' in ${collectionType} literal`,
          entryStart
        );
      }
      seenKeys.add(keyStr);
      entries.push(entry);
      skipNewlines(this.state);
    }

    if (check(this.state, TOKEN_TYPES.COMMA)) {
      advance(this.state);
      skipNewlines(this.state);
    } else {
      break;
    }
  }

  const rbracket = expect(
    this.state,
    TOKEN_TYPES.RBRACKET,
    `expected ']' to close ${collectionType} literal`,
    'RILL-P005'
  );

  const span = makeSpan(start, rbracket.span.end);

  if (collectionType === 'dict') {
    return { type: 'DictLiteral', entries, span } satisfies DictLiteralNode;
  }
  return { type: 'OrderedLiteral', entries, span } satisfies OrderedLiteralNode;
};
