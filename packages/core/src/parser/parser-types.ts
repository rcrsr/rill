/**
 * Parser Utility: Type Reference Parsing
 * Parses a type-ref production: either a static type name (optionally
 * parameterized) or a dynamic $variable.
 * @internal
 */

import {
  type TypeRef,
  type TypeRefArg,
  TOKEN_TYPES,
  ParseError,
} from '../types.js';
import { type ParserState, check, advance, expect, current } from './state.js';
import { VALID_TYPE_NAMES, parseTypeName } from './helpers.js';

/**
 * Parse a type reference from the current position in the token stream.
 *
 * Grammar:
 * ```
 * type-ref          = type-name [ "(" type-ref-arg-list ")" ] | "$" identifier
 * type-ref-arg-list = type-ref-arg { "," type-ref-arg } [ "," ]
 * type-ref-arg      = identifier ":" type-ref | type-ref
 * ```
 *
 * - `$identifier`           → `{ kind: 'dynamic', varName: identifier }`
 * - `type-name`             → `{ kind: 'static', typeName }`
 * - `type-name(arg, ...)`   → `{ kind: 'static', typeName, args: [...] }`
 *
 * Dynamic refs do not accept parameterization — `$T(...)` is not valid.
 *
 * Throws ParseError (EC-13) if neither a `$identifier` nor a valid type name
 * is found. Throws ParseError (EC-14) if the arg list is malformed.
 *
 * @internal
 */
export function parseTypeRef(state: ParserState): TypeRef {
  if (check(state, TOKEN_TYPES.DOLLAR)) {
    advance(state); // consume $
    const nameToken = expect(
      state,
      TOKEN_TYPES.IDENTIFIER,
      'Expected variable name after $'
    );
    return { kind: 'dynamic', varName: nameToken.value };
  }

  const typeName = parseTypeName(state, VALID_TYPE_NAMES);

  // Check for parameterized form: type-name "(" type-ref-arg-list ")"
  if (!check(state, TOKEN_TYPES.LPAREN)) {
    return { kind: 'static', typeName };
  }

  advance(state); // consume "("

  const args: TypeRefArg[] = [];

  // Parse arg list: allow empty "()" and trailing commas
  while (!check(state, TOKEN_TYPES.RPAREN)) {
    // Check for named arg: identifier ":" type-ref
    // Lookahead: current is IDENTIFIER and next is COLON
    const tok = current(state);
    if (
      tok.type === TOKEN_TYPES.IDENTIFIER &&
      state.tokens[state.pos + 1]?.type === TOKEN_TYPES.COLON
    ) {
      const name = tok.value;
      advance(state); // consume identifier
      advance(state); // consume ":"
      const ref = parseTypeRef(state);
      args.push({ name, ref });
    } else {
      // Positional arg: type-ref
      const ref = parseTypeRef(state);
      args.push({ ref });
    }

    // Consume trailing or separating comma
    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
    } else if (!check(state, TOKEN_TYPES.RPAREN)) {
      // Neither comma nor closing paren — malformed arg list (EC-14)
      throw new ParseError(
        'RILL-P014',
        "Expected ',' or ')' in type argument list",
        current(state).span.start
      );
    }
  }

  // Consume ")"
  if (!check(state, TOKEN_TYPES.RPAREN)) {
    throw new ParseError(
      'RILL-P014',
      "Expected ')' to close type argument list",
      current(state).span.start
    );
  }
  advance(state); // consume ")"

  return { kind: 'static', typeName, args };
}
