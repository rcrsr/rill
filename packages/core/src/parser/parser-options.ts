/**
 * Parser Helper: Angle-Bracket Option Dicts
 * Shared by `pass<...>` and `timeout<...>`
 */

import type { Parser } from './parser.js';
import type {
  DictEntryNode,
  DictNode,
  PipeChainNode,
  PostfixExprNode,
} from '../types.js';
import { ParseError, TOKEN_TYPES } from '../types.js';
import {
  check,
  advance,
  expect,
  current,
  previous,
  makeSpan,
  skipNewlines,
} from './state.js';
import { ERROR_IDS } from '../error-registry.js';

/**
 * Parse `key: primary, ...>` into a DictNode, consuming the closing `>`.
 *
 * Enters after the opening `keyword<` token has been consumed. Rejects
 * unknown and duplicate keys with RILL-P004. Values are primaries, so `>`
 * after a value is never read as a comparison; wrap richer expressions in
 * parentheses. An empty option list yields an empty dict.
 *
 * @param parser - Parser positioned just after `keyword<`
 * @param keyword - Block keyword used in error messages
 * @param allowedKeys - Recognized option keys
 */
export function parseOptionDict(
  parser: Parser,
  keyword: string,
  allowedKeys: readonly string[]
): DictNode {
  const state = parser.state;
  const dictStart = current(state).span.start;
  const entries: DictEntryNode[] = [];
  const seen = new Set<string>();

  skipNewlines(state);

  while (!check(state, TOKEN_TYPES.GT) && !check(state, TOKEN_TYPES.EOF)) {
    const entryStart = current(state).span.start;

    if (!check(state, TOKEN_TYPES.IDENTIFIER)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `Expected option key (identifier) inside '${keyword}<...>'`,
        current(state).span.start
      );
    }
    const keyToken = advance(state);

    if (!allowedKeys.includes(keyToken.value)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `Unknown option '${keyToken.value}' inside '${keyword}<...>'; recognized options are ${allowedKeys.map((k) => `'${k}'`).join(', ')}`,
        keyToken.span.start
      );
    }
    if (seen.has(keyToken.value)) {
      throw new ParseError(
        ERROR_IDS.RILL_P004,
        `Duplicate option '${keyToken.value}' inside '${keyword}<...>'`,
        keyToken.span.start
      );
    }
    seen.add(keyToken.value);

    expect(
      state,
      TOKEN_TYPES.COLON,
      `Expected ':' after option key inside '${keyword}<...>'`,
      ERROR_IDS.RILL_P004
    );
    skipNewlines(state);

    // Primary only, so `>` after the value is not a comparison operator.
    const primaryNode = parser.parsePrimary();
    const primarySpan = primaryNode.span;
    const postfixNode: PostfixExprNode = {
      type: 'PostfixExpr',
      primary: primaryNode,
      methods: [],
      defaultValue: null,
      span: primarySpan,
    };
    const value: PipeChainNode = {
      type: 'PipeChain',
      head: postfixNode,
      pipes: [],
      terminator: null,
      span: primarySpan,
    };

    entries.push({
      type: 'DictEntry',
      key: keyToken.value,
      keyForm: 'identifier',
      value,
      span: makeSpan(entryStart, previous(state).span.end),
    } satisfies DictEntryNode);

    skipNewlines(state);
    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
      skipNewlines(state);
    }
  }

  const gt = expect(
    state,
    TOKEN_TYPES.GT,
    `Expected '>' to close '${keyword}<...>'`,
    ERROR_IDS.RILL_P005
  );

  return {
    type: 'Dict',
    entries,
    defaultValue: null,
    span: makeSpan(dictStart, gt.span.end),
  };
}
