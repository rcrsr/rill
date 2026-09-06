/**
 * Parser Extension: Literal Parsing
 * Strings, numbers, booleans, tuples, dicts, and closures
 */

import { Parser } from './parser.js';
import type {
  AnnotationArg,
  AtomLiteralNode,
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
  RecoveryErrorNode,
  SourceLocation,
  StringLiteralNode,
  Token,
  TupleLiteralNode,
  TypeConstructorNode,
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
  previous,
  skipNewlines,
  skipNewlinesIfFollowedBy,
  makeSpan,
  reportError,
} from './state.js';
import {
  ATOM_NAME_SHAPE,
  expectVariableName,
  isDictStart,
  isNegativeNumber,
  VALID_TYPE_NAMES,
} from './helpers.js';
import { parseTypeRef, parseFieldArgList } from './parser-types.js';
import { ERROR_IDS } from '../error-registry.js';

// The lexer's readString() attaches this decoded-index-to-source-offset
// breakpoint list to a STRING token when the string contains at least one
// backslash escape. Token itself stays a plain { type, value, span } shape
// (packages/core/src/token-types.ts) — this is a local, additive view onto
// that same object rather than a change to the shared interface.
interface StringTokenEscapeMap {
  readonly escapeBreakpoints?: readonly number[];
}

/**
 * Translates an index into a lexer-decoded string (post escape-decoding)
 * back into the equivalent offset within the raw source text of that
 * string's body.
 *
 * Each backslash escape (\n, \r, \t, \\, \") collapses a 2-character raw
 * sequence into a single decoded character, so a decoded-string index
 * undercounts the true source offset by one per escape that precedes it.
 * `breakpoints` holds, in ascending order, the decoded length recorded
 * immediately after each escape was appended; counting how many of those
 * breakpoints are at or before `decodedIndex` gives the cumulative
 * undercount to add back.
 *
 * Triple-quoted strings never decode escapes (readTripleQuoteString keeps
 * them raw), so `breakpoints` is always undefined on that path and this
 * function is a no-op identity translation for it.
 */
function mapDecodedIndexToSourceOffset(
  decodedIndex: number,
  breakpoints: readonly number[] | undefined
): number {
  if (breakpoints === undefined || breakpoints.length === 0) {
    return decodedIndex;
  }
  // breakpoints is built in ascending order (readString pushes
  // value.length after each escape, and value only grows), so the count of
  // breakpoints at or before decodedIndex — the delta to add back — is the
  // standard "rightmost insertion point" binary search rather than a linear
  // scan, which matters for strings with many escapes and interpolations.
  let lo = 0;
  let hi = breakpoints.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (breakpoints[mid]! > decodedIndex) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return decodedIndex + lo;
}

// Declaration merging to add methods to Parser interface
declare module './parser.js' {
  interface Parser {
    parseLiteral(): LiteralNode;
    parseAtomLiteral(): AtomLiteralNode | RecoveryErrorNode;
    parseString(): StringLiteralNode;
    parseStringParts(
      raw: string,
      baseLocation: SourceLocation,
      isTripleQuote: boolean,
      openingNewlineWidth: number,
      escapeBreakpoints?: readonly number[]
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
    parseBody(allowEmptyBlock?: boolean): BodyNode;
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
// ATOM LITERAL PARSING
// ============================================================

/**
 * Parse an atom literal: #NAME.
 *
 * The lexer emits an ATOM token whose value is the name without the leading
 * `#` sigil (readAtom ensures the first character is uppercase). This parser
 * applies strict shape validation; on failure it emits a RecoveryErrorNode so
 * the evaluator produces #R001 at runtime (hard parse/link error per spec).
 *
 * Registry membership is NOT checked here; unknown-but-well-shaped names
 * resolve to #R001 at runtime via resolveAtom().
 */
Parser.prototype.parseAtomLiteral = function (
  this: Parser
): AtomLiteralNode | RecoveryErrorNode {
  const token = expect(this.state, TOKEN_TYPES.ATOM, 'Expected atom literal');
  const name = token.value;

  if (!ATOM_NAME_SHAPE.test(name)) {
    const message = `Invalid atom name '#${name}'; expected [A-Z][A-Z0-9_]*`;
    // Record the error on the parser's error collection so
    // parseWithRecovery reports success: false for shape-invalid atoms.
    // Without this call, parser.errors remains empty and the caller
    // incorrectly reports a successful parse despite a RecoveryErrorNode
    // in the AST.
    reportError(this.state, ERROR_IDS.RILL_P004, message, token.span.start);
    return {
      type: 'RecoveryError',
      message,
      text: `#${name}`,
      span: token.span,
    };
  }

  return {
    type: 'AtomLiteral',
    name,
    span: token.span,
  };
};

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

  // Negative number literal: -42
  if (isNegativeNumber(this.state)) {
    const start = current(this.state).span.start;
    advance(this.state); // consume MINUS
    const numToken = advance(this.state); // consume NUMBER
    return {
      type: 'NumberLiteral',
      value: -parseFloat(numToken.value),
      span: makeSpan(start, numToken.span.end),
    };
  }

  // Atom literal: #NAME
  if (check(this.state, TOKEN_TYPES.ATOM)) {
    return this.parseAtomLiteral();
  }

  // Keyword-prefixed collection literals: list[...], dict[...], tuple[...], ordered[...]
  if (check(this.state, TOKEN_TYPES.LIST_LBRACKET)) {
    advance(this.state);
    return this.parseCollectionLiteral('list');
  }
  if (check(this.state, TOKEN_TYPES.DICT_LBRACKET)) {
    advance(this.state);
    return this.parseCollectionLiteral('dict');
  }
  if (check(this.state, TOKEN_TYPES.TUPLE_LBRACKET)) {
    advance(this.state);
    return this.parseCollectionLiteral('tuple');
  }
  if (check(this.state, TOKEN_TYPES.ORDERED_LBRACKET)) {
    advance(this.state);
    return this.parseCollectionLiteral('ordered');
  }

  const token = current(this.state);
  let hint = '';
  if (token.type === TOKEN_TYPES.ASSIGN) {
    hint = ". Hint: Use '->' for assignment, not '='";
  } else if (token.type === TOKEN_TYPES.EOF) {
    hint = '. Hint: Unexpected end of input';
  }
  throw new ParseError(
    ERROR_IDS.RILL_P001,
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

  // Only triple-quoted strings use a 3-character delimiter and may skip a
  // leading newline (Python-style); single-quoted strings never span lines.
  const startOffset = token.span.start.offset;
  const isTripleQuote =
    this.state.source.slice(startOffset, startOffset + 3) === '"""';
  // The lexer skips a Python-style opening newline after the delimiter,
  // consuming a CRLF pair (\r\n) as a unit or a bare LF (\n) alone. The
  // parser must consume the matching width here so offset/line math for
  // any interpolation later in the string stays aligned with the lexer.
  let openingNewlineWidth = 0;
  if (isTripleQuote) {
    if (
      this.state.source[startOffset + 3] === '\r' &&
      this.state.source[startOffset + 4] === '\n'
    ) {
      openingNewlineWidth = 2;
    } else if (this.state.source[startOffset + 3] === '\n') {
      openingNewlineWidth = 1;
    }
  }

  const escapeBreakpoints = (token as Token & StringTokenEscapeMap)
    .escapeBreakpoints;

  const parts = this.parseStringParts(
    raw,
    token.span.start,
    isTripleQuote,
    openingNewlineWidth,
    escapeBreakpoints
  );

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
  isTripleQuote: boolean,
  openingNewlineWidth: number,
  escapeBreakpoints?: readonly number[]
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

      // Brace-escaping ({{, }}) does not apply inside interpolation: every {
      // and } here is real rill code (nested blocks, dicts, closures), so
      // each brace must be counted, not speculatively swallowed as a
      // literal pair. Swallowing a pair whose first brace actually closes a
      // nested construct desyncs depth and misreports the interpolation as
      // unterminated. Matches the lexer's own interpolation scan.
      const exprStart = i + 1;
      let depth = 1;
      i++;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '"') {
          // Mirrors the nested-string skip in lexer/readers.ts: a nested
          // string literal's own brace characters don't belong to the
          // interpolation's depth count, so skip the whole literal (or, for
          // a nested triple-quote, the whole triple-quoted unit) instead of
          // counting braces inside it.
          if (raw[i + 1] === '"' && raw[i + 2] === '"') {
            i += 3;
            while (
              i < raw.length &&
              !(raw[i] === '"' && raw[i + 1] === '"' && raw[i + 2] === '"')
            ) {
              i++;
            }
            if (i < raw.length) i += 3;
          } else {
            i++; // consume opening "
            while (i < raw.length && raw[i] !== '"') {
              if (raw[i] === '\\') {
                i += 2;
              } else {
                i++;
              }
            }
            if (i < raw.length) i++; // consume closing "
          }
          continue;
        }
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') depth--;
        i++;
      }

      if (depth !== 0) {
        throw new ParseError(
          ERROR_IDS.RILL_P005,
          'Unterminated string interpolation',
          baseLocation
        );
      }

      const exprSource = raw.slice(exprStart, i - 1);
      if (!exprSource.trim()) {
        throw new ParseError(
          ERROR_IDS.RILL_P004,
          'Empty string interpolation',
          baseLocation
        );
      }

      // Calculate the actual position of the interpolation in the source
      // baseLocation is the string token start (the opening quote(s))
      // Delimiter length is 1 for " and 3 for """. The line/offset
      // adjustment for a consumed opening newline only applies when the
      // lexer actually skipped one (Python-style, """ strings only), and
      // that skipped newline is 1 source character for a bare \n or 2 for
      // a \r\n pair — openingNewlineWidth carries that count so a CRLF
      // opening still maps the offset to the right source character.
      //
      // We need to map the position in raw to absolute source location
      const beforeInterp = raw.slice(0, exprStart);
      const newlines = (beforeInterp.match(/\n/g) || []).length;
      const lastNewlinePos = beforeInterp.lastIndexOf('\n');
      const quoteLen = isTripleQuote ? 3 : 1;
      const openingNewlineConsumed = openingNewlineWidth > 0;

      let interpLine: number;
      let interpColumn: number;
      let interpOffset: number;

      // Interpolation lands on the first content line, immediately after a
      // consumed opening newline (i.e. """ followed directly by \n).
      const contentStartsOnNextLine = openingNewlineConsumed && newlines === 0;

      if (newlines > 0) {
        // Has newlines in raw content before interpolation. A decoded '\n'
        // is not always a real source line break: for double-quoted
        // strings (escapeBreakpoints defined) a literal raw newline is a
        // lexer error, so every decoded '\n' that lands exactly at an
        // escape breakpoint was produced by decoding a \n escape — two
        // characters on the *same* source line, not a line break. Triple-
        // quoted strings never decode escapes (escapeBreakpoints is always
        // undefined there), so every decoded newline they contain is real.
        const escapeNewlineOffsets = new Set<number>();
        if (escapeBreakpoints) {
          for (const bp of escapeBreakpoints) {
            if (bp - 1 < exprStart && raw[bp - 1] === '\n') {
              escapeNewlineOffsets.add(bp - 1);
            }
          }
        }

        let realNewlines = newlines;
        let lastRealNewlinePos = lastNewlinePos;
        if (escapeNewlineOffsets.size > 0) {
          realNewlines = 0;
          lastRealNewlinePos = -1;
          for (let idx = 0; idx < beforeInterp.length; idx++) {
            if (beforeInterp[idx] === '\n' && !escapeNewlineOffsets.has(idx)) {
              realNewlines++;
              lastRealNewlinePos = idx;
            }
          }
        }

        const sourceExprStart = mapDecodedIndexToSourceOffset(
          exprStart,
          escapeBreakpoints
        );

        if (realNewlines > 0) {
          const sourceLastNewlinePos = mapDecodedIndexToSourceOffset(
            lastRealNewlinePos,
            escapeBreakpoints
          );
          interpLine =
            baseLocation.line + (openingNewlineConsumed ? 1 : 0) + realNewlines;
          interpColumn = sourceExprStart - sourceLastNewlinePos;
          interpOffset =
            baseLocation.offset +
            quoteLen +
            openingNewlineWidth +
            sourceExprStart;
        } else {
          // Every decoded newline before the interpolation came from a \n
          // escape; the interpolation is still on the opening source line.
          interpLine = baseLocation.line;
          interpColumn = baseLocation.column + quoteLen + sourceExprStart;
          interpOffset = baseLocation.offset + quoteLen + sourceExprStart;
        }
      } else if (contentStartsOnNextLine) {
        // Triple-quote string with skipped opening newline, but interpolation on first content line
        interpLine = baseLocation.line + 1;
        interpColumn = 1 + exprStart;
        interpOffset =
          baseLocation.offset + quoteLen + openingNewlineWidth + exprStart;
      } else {
        // Interpolation starts on the same line as the opening delimiter,
        // whether that delimiter is " or """. Triple-quoted strings never
        // decode escapes (escapeBreakpoints is always undefined for them),
        // so mapDecodedIndexToSourceOffset is a no-op there; for
        // double-quoted strings it corrects exprStart — an index into the
        // lexer's escape-decoded value — back to its offset in the raw
        // source, undoing the one-column-per-preceding-escape undercount.
        const sourceExprStart = mapDecodedIndexToSourceOffset(
          exprStart,
          escapeBreakpoints
        );
        interpLine = baseLocation.line;
        interpColumn = baseLocation.column + quoteLen + sourceExprStart;
        interpOffset = baseLocation.offset + quoteLen + sourceExprStart;
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
      ERROR_IDS.RILL_P004,
      'Empty string interpolation',
      baseLocation
    );
  }

  const subParser = new Parser(filtered);
  const expression = subParser.parseExpression();

  if (subParser.state.tokens[subParser.state.pos]?.type !== TOKEN_TYPES.EOF) {
    throw new ParseError(
      ERROR_IDS.RILL_P001,
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
    ERROR_IDS.RILL_P005
  );
  return {
    type: 'ListLiteral',
    elements,
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
        ERROR_IDS.RILL_P004,
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
    ERROR_IDS.RILL_P005
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
  let keyForm: 'identifier' | 'string' | undefined = undefined;

  if (check(this.state, TOKEN_TYPES.DOLLAR)) {
    // Parse variable key: $variableName
    advance(this.state); // consume $
    const varToken = expectVariableName(
      this.state,
      'Expected variable name after $'
    );
    key = {
      kind: 'variable',
      variableName: varToken.value,
      span: makeSpan(start, varToken.span.end),
    };
  } else if (check(this.state, TOKEN_TYPES.PIPE_VAR)) {
    // Standalone $ without identifier - error
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      'Expected variable name after $',
      current(this.state).span.start
    );
  } else if (check(this.state, TOKEN_TYPES.LPAREN)) {
    // Parse computed key: (expression)
    advance(this.state); // consume (
    skipNewlines(this.state);
    const expression = this.parsePipeChain();
    skipNewlines(this.state);
    if (!check(this.state, TOKEN_TYPES.RPAREN)) {
      throw new ParseError(
        ERROR_IDS.RILL_P005,
        'Expected ) after computed key expression',
        current(this.state).span.start
      );
    }
    const closeParen = advance(this.state); // consume )
    key = {
      kind: 'computed',
      expression,
      span: makeSpan(start, closeParen.span.end),
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
      ERROR_IDS.RILL_P004,
      'Dict entry key must be identifier or list, not dict',
      current(this.state).span.start
    );
  } else if (check(this.state, TOKEN_TYPES.STRING)) {
    // Parse string literal as key
    const keyToken = advance(this.state);
    key = keyToken.value;
    keyForm = 'string';
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
    keyForm = 'identifier';
  } else if (
    check(
      this.state,
      TOKEN_TYPES.BREAK,
      TOKEN_TYPES.RETURN,
      TOKEN_TYPES.YIELD,
      TOKEN_TYPES.PASS,
      TOKEN_TYPES.ASSERT,
      TOKEN_TYPES.ERROR,
      TOKEN_TYPES.GUARD,
      TOKEN_TYPES.RETRY,
      TOKEN_TYPES.WHILE,
      TOKEN_TYPES.DO
    )
  ) {
    // Reserved keywords parse as identifier-form string keys
    key = advance(this.state).value;
    keyForm = 'identifier';
  } else {
    // Invalid token at key position
    throw new ParseError(
      ERROR_IDS.RILL_P001,
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
    ...(keyForm !== undefined ? { keyForm } : {}),
    span: makeSpan(start, previous(this.state).span.end),
  };
};

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

// ============================================================
// KEYWORD-PREFIXED COLLECTION LITERAL PARSING
// ============================================================

/**
 * Parse the shared prefix of a spread element inside a keyword-prefixed
 * collection literal: consumes ELLIPSIS, skips newlines, guards against a
 * missing operand, then parses the spread expression.
 *
 * Callers build their own node (ListSpread vs DictEntry) from the result.
 * @internal
 */
function parseSpreadOperand(parser: Parser): {
  spreadStart: SourceLocation;
  expression: ExpressionNode;
} {
  const spreadStart = current(parser.state).span.start;
  advance(parser.state); // consume ELLIPSIS
  skipNewlines(parser.state);

  if (
    check(parser.state, TOKEN_TYPES.COMMA) ||
    check(parser.state, TOKEN_TYPES.RBRACKET) ||
    check(parser.state, TOKEN_TYPES.EOF)
  ) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "Expected expression after '...'",
      current(parser.state).span.start
    );
  }

  const expression = parser.parseExpression();
  return { spreadStart, expression };
}

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
    const elements: (ExpressionNode | ListSpreadNode)[] = [];

    while (!check(this.state, TOKEN_TYPES.RBRACKET)) {
      if (check(this.state, TOKEN_TYPES.EOF)) {
        throw new ParseError(
          ERROR_IDS.RILL_P005,
          `expected ']' to close ${collectionType} literal`,
          current(this.state).span.start
        );
      }

      // Spread element: ...$other
      if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
        const { spreadStart, expression: spreadExpr } =
          parseSpreadOperand(this);
        elements.push({
          type: 'ListSpread',
          expression: spreadExpr,
          span: makeSpan(spreadStart, spreadExpr.span.end),
        });
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
            ERROR_IDS.RILL_P004,
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
      ERROR_IDS.RILL_P005
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
        ERROR_IDS.RILL_P005,
        `expected ']' to close ${collectionType} literal`,
        current(this.state).span.start
      );
    }

    // Spread entry: ...$other
    if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
      const { spreadStart, expression: spreadExpr } = parseSpreadOperand(this);
      entries.push({
        type: 'DictEntry',
        key: '...',
        value: spreadExpr,
        span: makeSpan(spreadStart, spreadExpr.span.end),
      });
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
        !check(this.state, TOKEN_TYPES.DICT_LBRACKET) &&
        !isNegativeNumber(this.state)
      ) {
        throw new ParseError(
          ERROR_IDS.RILL_P004,
          `expected 'key: value' pair in ${collectionType} literal`,
          entryStart
        );
      }

      const entry = this.parseDictEntry();
      const keyStr = keyToString(entry.key);
      if (seenKeys.has(keyStr)) {
        throw new ParseError(
          ERROR_IDS.RILL_P004,
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
    ERROR_IDS.RILL_P005
  );

  const span = makeSpan(start, rbracket.span.end);

  if (collectionType === 'dict') {
    return { type: 'DictLiteral', entries, span } satisfies DictLiteralNode;
  }
  return { type: 'OrderedLiteral', entries, span } satisfies OrderedLiteralNode;
};
