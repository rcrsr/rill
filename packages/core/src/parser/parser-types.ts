/**
 * Parser Utility: Type Reference Parsing
 * Parses a type-ref production: either a static type name (optionally
 * parameterized) or a dynamic $variable.
 * @internal
 */

import {
  type TypeRef,
  type FieldArg,
  type LiteralNode,
  type AnnotationArg,
  TOKEN_TYPES,
  ParseError,
} from '../types.js';
import {
  type ParserState,
  check,
  advance,
  expect,
  current,
  peek,
  skipNewlines,
} from './state.js';
import { VALID_TYPE_NAMES, parseTypeName } from './helpers.js';

/**
 * Parse a type reference from the current position in the token stream.
 *
 * Grammar:
 * ```
 * type-ref          = single-type { "|" single-type }
 * single-type       = "$" identifier | type-name [ "(" type-ref-arg-list ")" ]
 * type-ref-arg-list = type-ref-arg { "," type-ref-arg } [ "," ]
 * type-ref-arg      = identifier ":" type-ref | type-ref
 * ```
 *
 * - `$identifier`           → `{ kind: 'dynamic', varName: identifier }`
 * - `type-name`             → `{ kind: 'static', typeName }`
 * - `type-name(arg, ...)`   → `{ kind: 'static', typeName, args: [...] }`
 * - `A | B | ...`           → `{ kind: 'union', members: [A, B, ...] }`
 *
 * Dynamic refs do not accept parameterization — `$T(...)` is not valid.
 * Union members are flattened: nested unions are spread into the member list.
 *
 * Throws ParseError (EC-13) if neither a `$identifier` nor a valid type name
 * is found. Throws ParseError (EC-14) if the arg list is malformed.
 * Throws ParseError (RILL-P011) if `|` is not followed by a valid type start.
 *
 * @internal
 */
export function parseTypeRef(
  state: ParserState,
  opts?: {
    allowTrailingPipe?: boolean;
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): TypeRef {
  const first = parseSingleType(state, opts);

  // Union accumulation: collect additional members after each "|"
  if (!check(state, TOKEN_TYPES.PIPE_BAR)) {
    return first;
  }

  const members: TypeRef[] = [];

  // Flatten: if the first member is itself a union, spread its members
  if (first.kind === 'union') {
    members.push(...first.members);
  } else {
    members.push(first);
  }

  while (check(state, TOKEN_TYPES.PIPE_BAR)) {
    // Peek at what follows "|" without consuming it.
    // Only treat "|" as a union separator when the next token is a valid type
    // start ($identifier or a valid type name IDENTIFIER). If the next token is
    // neither, the "|" belongs to the outer context (e.g. the closing delimiter
    // of an anonymous typed closure param like |string|) and we stop without
    // consuming it. RILL-P011 applies when the "|" is clearly a dangling union
    // pipe: the next token is an IDENTIFIER but not a valid type name.
    const afterPipe = peek(state, 1);
    const afterPipeIsDollar = afterPipe.type === TOKEN_TYPES.DOLLAR;
    const afterPipeIsTypeName =
      afterPipe.type === TOKEN_TYPES.IDENTIFIER &&
      (VALID_TYPE_NAMES as readonly string[]).includes(afterPipe.value);
    const afterPipeIsUnknownIdent =
      afterPipe.type === TOKEN_TYPES.IDENTIFIER && !afterPipeIsTypeName;

    if (afterPipeIsUnknownIdent) {
      // Dangling pipe followed by an unrecognized identifier: RILL-P011.
      advance(state); // consume "|"
      throw new ParseError(
        'RILL-P011',
        "Expected type name after '|'",
        current(state).span.start
      );
    }

    if (!afterPipeIsDollar && !afterPipeIsTypeName) {
      // "|" is followed by a non-identifier token (e.g. "{", EOF, newline).
      if (opts?.allowTrailingPipe) {
        // Closure contexts own the trailing "|" as a delimiter — leave it unconsumed.
        break;
      }
      // In non-closure contexts, a dangling "|" with no following type is an error.
      advance(state); // consume "|"
      throw new ParseError(
        'RILL-P011',
        "Expected type name after '|'",
        current(state).span.start
      );
    }

    advance(state); // consume "|"

    const next = parseSingleType(state, opts);

    // Flatten nested unions
    if (next.kind === 'union') {
      members.push(...next.members);
    } else {
      members.push(next);
    }
  }

  // If only one member accumulated (e.g. a "|" was present but belonged to the
  // outer context such as an anonymous typed closure closing delimiter), return
  // the single member as-is rather than wrapping in a union.
  if (members.length === 1) {
    return members[0]!;
  }

  return { kind: 'union', members };
}

/**
 * Parse a single type (one member of a union, or the sole type-ref).
 * Grammar: `single-type = "$" identifier | type-name [ "(" type-ref-arg-list ")" ]`
 * @internal
 */
function parseSingleType(
  state: ParserState,
  opts?: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): TypeRef {
  // Zero-param closure type: || :returnType or bare ||
  if (check(state, TOKEN_TYPES.OR)) {
    advance(state); // consume || (OR token)
    // Check for :returnType
    if (check(state, TOKEN_TYPES.COLON)) {
      advance(state); // consume :
      const ret = parseSingleType(state, opts);
      return { kind: 'static', typeName: 'closure', args: [{ value: ret }] };
    }
    // Bare || without :returnType — equivalent to 'closure'
    return { kind: 'static', typeName: 'closure' };
  }

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

  const args = parseFieldArgList(state, buildTypeRefOpts(opts));
  advance(state); // consume ")"

  return { kind: 'static', typeName, args };
}

// ============================================================
// FIELD ARG LIST PARSING
// ============================================================

/**
 * Parse a comma-separated list of field arguments between `(` and `)`.
 *
 * Caller has already consumed the opening `(`. This function parses zero
 * or more arguments up to the closing `)` but does NOT consume it.
 *
 * Supports:
 * - Named args:      `name: type`  → `{ name, value }`
 * - Positional args: `type`        → `{ value }`
 * - Default values:  `= literal`   → `{ ..., defaultValue }` (when parseLiteral provided)
 * - Union types in value position via `parseTypeRef`
 * - Trailing commas before `)`
 *
 * Named arg detection: IDENTIFIER followed by COLON lookahead.
 *
 * @param state - Parser state (positioned after opening paren)
 * @param opts  - Optional parseLiteral callback for default value support
 *
 * @throws ParseError RILL-P014 if token after arg is not `,` or `)`  (EC-1)
 * @throws ParseError RILL-P014 if missing closing `)`                (EC-2)
 *
 * @internal
 */

/** Forward parseLiteral and parseAnnotations from field-arg opts to parseTypeRef opts. */
function buildTypeRefOpts(opts?: {
  parseLiteral?: () => LiteralNode;
  parseAnnotations?: () => AnnotationArg[];
}):
  | {
      parseLiteral?: () => LiteralNode;
      parseAnnotations?: () => AnnotationArg[];
    }
  | undefined {
  if (!opts?.parseLiteral && !opts?.parseAnnotations) return undefined;
  const result: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  } = {};
  if (opts.parseLiteral) result.parseLiteral = opts.parseLiteral;
  if (opts.parseAnnotations) result.parseAnnotations = opts.parseAnnotations;
  return result;
}

export function parseFieldArgList(
  state: ParserState,
  opts?: {
    parseLiteral?: () => LiteralNode;
    parseAnnotations?: () => AnnotationArg[];
  }
): FieldArg[] {
  const args: FieldArg[] = [];

  skipNewlines(state);

  // Parse arg list: allow empty "()" and trailing commas
  while (!check(state, TOKEN_TYPES.RPAREN)) {
    // Parse optional field annotations: ^(annots) — multiple blocks merge
    let annotations: AnnotationArg[] | undefined;
    while (opts?.parseAnnotations && check(state, TOKEN_TYPES.CARET)) {
      advance(state); // consume ^
      expect(state, TOKEN_TYPES.LPAREN, 'Expected ( after ^');
      const block = opts.parseAnnotations();
      expect(state, TOKEN_TYPES.RPAREN, 'Expected )', 'RILL-P005');
      skipNewlines(state);

      if (!annotations) {
        annotations = block;
      } else {
        annotations = annotations.concat(block);
      }

      // Guard: annotation must be followed by a field
      if (check(state, TOKEN_TYPES.RPAREN)) {
        throw new ParseError(
          'RILL-P014',
          'Expected field after annotation',
          current(state).span.start
        );
      }
    }

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
      skipNewlines(state);
      const typeRefOpts = buildTypeRefOpts(opts);
      const value = parseTypeRef(state, typeRefOpts);
      const arg: FieldArg = { name, value };
      if (annotations) {
        arg.annotations = annotations;
      }
      if (opts?.parseLiteral && check(state, TOKEN_TYPES.ASSIGN)) {
        advance(state); // consume =
        skipNewlines(state);
        arg.defaultValue = opts.parseLiteral();
      }
      args.push(arg);
    } else {
      // Positional arg: type-ref
      const typeRefOpts = buildTypeRefOpts(opts);
      const value = parseTypeRef(state, typeRefOpts);
      const arg: FieldArg = { value };
      if (annotations) {
        arg.annotations = annotations;
      }
      if (opts?.parseLiteral && check(state, TOKEN_TYPES.ASSIGN)) {
        advance(state); // consume =
        skipNewlines(state);
        arg.defaultValue = opts.parseLiteral();
      }
      args.push(arg);
    }

    skipNewlines(state);

    // Consume trailing or separating comma
    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state);
      skipNewlines(state);
    } else if (!check(state, TOKEN_TYPES.RPAREN)) {
      // Neither comma nor closing paren — malformed arg list (EC-1)
      throw new ParseError(
        'RILL-P014',
        "Expected ',' or ')' in type argument list",
        current(state).span.start
      );
    }
  }

  // Verify closing ")" is present (EC-2)
  if (!check(state, TOKEN_TYPES.RPAREN)) {
    throw new ParseError(
      'RILL-P014',
      "Expected ')' to close type argument list",
      current(state).span.start
    );
  }

  return args;
}
