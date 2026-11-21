/**
 * Map literal parsing: map[key: value, ...]
 *
 * Parser extension. Adds the map-literal methods to Parser.prototype.
 */

import { Parser } from './parser.js';
import type {
  ExpressionNode,
  ListLiteralNode,
  ListSpreadNode,
  MapEntryNode,
  MapLiteralNode,
  PrimaryNode,
  SourceLocation,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  skipNewlines,
  makeSpan,
} from './state.js';
import { rejectRepeatedKey, skipDictKey } from './helpers.js';
import { parseMultiKeyList, rejectTrailingComma } from './parser-literals.js';
import { ERROR_IDS } from '../error-registry.js';

declare module './parser.js' {
  interface Parser {
    parseMapLiteral(start: SourceLocation): MapLiteralNode;
    parseMapKey(): ExpressionNode | ListLiteralNode;
  }
}

// ============================================================
// MAP LITERAL PARSING
// ============================================================

/** Tokens that may begin an unparenthesized map key. */
const MAP_KEY_STARTS: readonly string[] = [
  TOKEN_TYPES.STRING,
  TOKEN_TYPES.NUMBER,
  TOKEN_TYPES.TRUE,
  TOKEN_TYPES.FALSE,
  TOKEN_TYPES.ATOM,
  TOKEN_TYPES.MINUS,
  TOKEN_TYPES.DOLLAR,
  TOKEN_TYPES.LPAREN,
  TOKEN_TYPES.LBRACKET,
  TOKEN_TYPES.LIST_LBRACKET,
];

/**
 * Canonical identity of a key written as a scalar literal, or undefined when
 * the key is anything else. The identity is kind-tagged, so `1` and `1.0`
 * collide and `1` never collides with `"1"`. An interpolated string is not a
 * literal.
 * @internal
 */
function literalMapKey(
  node: ExpressionNode | ListSpreadNode
): { readonly id: string; readonly display: string } | undefined {
  if (node.type !== 'PipeChain') return undefined;
  if (node.pipes.length > 0 || node.terminator !== null) return undefined;
  const head = node.head;
  if (head.type !== 'PostfixExpr') return undefined;
  if (head.methods.length > 0 || head.defaultValue !== null) return undefined;
  if ((head.existenceCheck ?? null) !== null) return undefined;
  const primary = head.primary;
  switch (primary.type) {
    case 'NumberLiteral':
      return { id: `n:${primary.value}`, display: String(primary.value) };
    case 'StringLiteral': {
      let text = '';
      for (const part of primary.parts) {
        if (typeof part !== 'string') return undefined;
        text += part;
      }
      return { id: `s:${text}`, display: text };
    }
    case 'BoolLiteral':
      return { id: `b:${primary.value}`, display: String(primary.value) };
    case 'AtomLiteral':
      return { id: `a:${primary.name}`, display: `#${primary.name}` };
    default:
      return undefined;
  }
}

/**
 * Parse one map key. A key is a scalar literal (a negative number included),
 * `$name`, a parenthesized expression, or a multi-key list. A bare name is a
 * name, not a value, and halts with a hint; any other expression needs
 * parentheses.
 */
Parser.prototype.parseMapKey = function (
  this: Parser
): ExpressionNode | ListLiteralNode {
  const first = current(this.state);
  if (!MAP_KEY_STARTS.includes(first.type)) {
    const hint = /^[A-Za-z_][A-Za-z0-9_]*$/.test(first.value)
      ? `. Hint: '${first.value}' is a name, not a value; write "${first.value}" for a string or #${first.value} for an atom`
      : '. Hint: a map key is a scalar literal, $name, (expression), or a list of keys';
    throw new ParseError(
      ERROR_IDS.RILL_P001,
      `Expected map key, got: ${first.value}${hint}`,
      first.span.start
    );
  }
  const after =
    first.type === TOKEN_TYPES.ATOM
      ? this.state.pos + 1
      : skipDictKey(this.state, this.state.pos);
  if (after < 0 || this.state.tokens[after]?.type !== TOKEN_TYPES.COLON) {
    throw new ParseError(
      ERROR_IDS.RILL_P004,
      "expected 'key: value' pair in map literal. Hint: parenthesize a key that is more than a literal or $name",
      first.span.start
    );
  }
  if (
    first.type === TOKEN_TYPES.LBRACKET ||
    first.type === TOKEN_TYPES.LIST_LBRACKET
  ) {
    return parseMultiKeyList(this);
  }
  // The key is built from its primary alone: the postfix loop would read the
  // `:` after the key as a type assertion.
  let primary: PrimaryNode;
  if (first.type === TOKEN_TYPES.DOLLAR) {
    primary = this.parseVariable();
  } else if (first.type === TOKEN_TYPES.LPAREN) {
    advance(this.state); // consume (
    skipNewlines(this.state);
    const expression = this.parsePipeChain();
    skipNewlines(this.state);
    const close = expect(
      this.state,
      TOKEN_TYPES.RPAREN,
      'Expected ) after map key expression',
      ERROR_IDS.RILL_P005
    );
    primary = {
      type: 'GroupedExpr',
      expression,
      span: makeSpan(first.span.start, close.span.end),
    };
  } else {
    primary = this.parseLiteral();
  }
  const span = makeSpan(first.span.start, previous(this.state).span.end);
  return {
    type: 'PipeChain',
    head: {
      type: 'PostfixExpr',
      primary,
      methods: [],
      defaultValue: null,
      span,
    },
    pipes: [],
    terminator: null,
    span,
  };
};

/**
 * Parse a map literal after its opener (`map[`, or a plain `[` after a
 * written map type) is consumed; `start` is the opener's start.
 *
 * Grammar: map[ (key ":" expr) ("," key ":" expr)* ["," ] ]
 *
 * Literal keys that are equal by value are rejected at parse time, a literal
 * element of a multi-key list included. Spread is not valid in a map.
 */
Parser.prototype.parseMapLiteral = function (
  this: Parser,
  start: SourceLocation
): MapLiteralNode {
  const entries: MapEntryNode[] = [];
  const seenKeys = new Set<string>();
  skipNewlines(this.state);

  while (!check(this.state, TOKEN_TYPES.RBRACKET)) {
    if (check(this.state, TOKEN_TYPES.EOF)) {
      throw new ParseError(
        ERROR_IDS.RILL_P005,
        "expected ']' to close map literal",
        current(this.state).span.start
      );
    }
    if (check(this.state, TOKEN_TYPES.ELLIPSIS)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        'spread is not allowed in map literal',
        current(this.state).span.start
      );
    }

    const entryStart = current(this.state).span.start;
    const key = this.parseMapKey();
    const literalKeys = key.type === 'ListLiteral' ? key.elements : [key];
    for (const element of literalKeys) {
      const literal = literalMapKey(element);
      if (literal !== undefined) {
        rejectRepeatedKey(
          seenKeys,
          literal.id,
          element.span.start,
          'map',
          literal.display
        );
      }
    }
    expect(this.state, TOKEN_TYPES.COLON, 'Expected :');
    skipNewlines(this.state);
    const value = this.parseExpression();
    entries.push({
      type: 'MapEntry',
      key,
      value,
      span: makeSpan(entryStart, previous(this.state).span.end),
    });
    skipNewlines(this.state);

    if (check(this.state, TOKEN_TYPES.COMMA)) {
      const comma = advance(this.state);
      skipNewlines(this.state);
      rejectTrailingComma(this.state, comma, 'map');
    } else {
      break;
    }
  }

  const rbracket = expect(
    this.state,
    TOKEN_TYPES.RBRACKET,
    "expected ']' to close map literal",
    ERROR_IDS.RILL_P005
  );
  return {
    type: 'MapLiteral',
    entries,
    defaultValue: null,
    span: makeSpan(start, rbracket.span.end),
  };
};
