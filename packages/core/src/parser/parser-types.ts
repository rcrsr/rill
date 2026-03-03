/**
 * Parser Utility: Type Reference Parsing
 * Parses a type-ref production: either a static type name or a dynamic $variable.
 * @internal
 */

import { type TypeRef, TOKEN_TYPES } from '../types.js';
import { type ParserState, check, advance, expect } from './state.js';
import { VALID_TYPE_NAMES, parseTypeName } from './helpers.js';

/**
 * Parse a type reference from the current position in the token stream.
 *
 * Grammar: `type-ref = type-name | "$" , identifier`
 *
 * - `$identifier` → `{ kind: 'dynamic', varName: identifier }`
 * - `type-name`   → `{ kind: 'static', typeName }`
 *
 * Throws ParseError if neither a `$identifier` nor a valid type name is found.
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
  return { kind: 'static', typeName };
}
