/**
 * Signature Parser
 *
 * Parses annotated rill closure type signature strings at registration time.
 * This module bridges the lexer/parser boundary so that runtime/core/context.ts
 * can parse signatures without importing from parser/* or lexer/* directly.
 *
 * Import boundary note (§NOD.2.1):
 * - This file lives at src/ level (not in runtime/), so it may import from
 *   both lexer and parser barrels.
 * - runtime/core/context.ts imports from this file (../../signature-parser.js),
 *   which is NOT in parser/* or lexer/* — boundary preserved.
 */

import { tokenize } from './lexer/index.js';
import { ParseError, TOKEN_TYPES } from './types.js';
import {
  type ParserState,
  createParserState,
  advance,
  check,
  current,
  expect,
  skipNewlines,
  isAtEnd,
  parseTypeRef,
} from './parser/index.js';
import type { TypeRef } from './types.js';
import type { RillParam } from './runtime/core/callable.js';
import type { RillType, RillValue } from './runtime/core/values.js';

// ============================================================
// TypeRef → RillType static conversion
// ============================================================

/**
 * Convert a static TypeRef to a RillType.
 *
 * Only handles static refs (type names and unions). Dynamic refs ($var)
 * are not valid in registration-time signatures — they throw Error.
 *
 * @internal
 */
function staticTypeRefToRillType(
  typeRef: TypeRef,
  functionName: string
): RillType {
  if (typeRef.kind === 'dynamic') {
    throw new Error(
      `Invalid signature for function '${functionName}': dynamic type references ($variable) are not allowed in signatures`
    );
  }

  if (typeRef.kind === 'union') {
    return {
      type: 'union',
      members: typeRef.members.map((m) =>
        staticTypeRefToRillType(m, functionName)
      ),
    };
  }

  // static kind
  const { typeName, args } = typeRef;

  if (!args || args.length === 0) {
    return { type: typeName } as RillType;
  }

  // Parameterized types
  if (typeName === 'list') {
    if (
      args.length === 1 &&
      args[0] !== undefined &&
      args[0].name === undefined
    ) {
      const element = staticTypeRefToRillType(args[0].ref, functionName);
      return { type: 'list', element };
    }
    throw new Error(
      `Invalid signature for function '${functionName}': list requires exactly one positional type argument`
    );
  }

  if (typeName === 'dict') {
    const fields: Record<string, RillType> = {};
    for (const arg of args) {
      if (arg.name === undefined) {
        throw new Error(
          `Invalid signature for function '${functionName}': dict type arguments must be named (e.g. dict(key: string))`
        );
      }
      fields[arg.name] = staticTypeRefToRillType(arg.ref, functionName);
    }
    return { type: 'dict', fields };
  }

  if (typeName === 'tuple') {
    const elements = args.map((arg) =>
      staticTypeRefToRillType(arg.ref, functionName)
    );
    return { type: 'tuple', elements };
  }

  throw new Error(
    `Invalid signature for function '${functionName}': type '${typeName}' does not accept type arguments`
  );
}

// ============================================================
// Annotation parsing
// ============================================================

/**
 * Extract a string literal value from the current token position.
 * Only string literals are valid as annotation values in signatures.
 *
 * @internal
 */
function extractAnnotationStringValue(
  state: ParserState,
  functionName: string
): string {
  if (!check(state, TOKEN_TYPES.STRING)) {
    throw new Error(
      `Invalid signature for function '${functionName}': annotation values must be string literals`
    );
  }
  const tok = advance(state);
  return tok.value;
}

/**
 * Parse annotation args: `key: "value", ...` inside `^(...)`.
 * Returns a record of annotation key-value pairs.
 * Only string literal values are supported in signatures.
 *
 * @internal
 */
function parseSignatureAnnotations(
  state: ParserState,
  functionName: string
): Record<string, string> {
  const annotations: Record<string, string> = {};

  while (!check(state, TOKEN_TYPES.RPAREN) && !isAtEnd(state)) {
    // Support bare string shorthand: "description text" → description: "description text"
    if (check(state, TOKEN_TYPES.STRING)) {
      const tok = advance(state);
      annotations['description'] = tok.value;
    } else {
      // Named arg: key: "value"
      const nameToken = expect(
        state,
        TOKEN_TYPES.IDENTIFIER,
        `Expected annotation key in function '${functionName}'`
      );
      expect(
        state,
        TOKEN_TYPES.COLON,
        `Expected ':' after annotation key in function '${functionName}'`
      );
      const value = extractAnnotationStringValue(state, functionName);
      annotations[nameToken.value] = value;
    }

    if (check(state, TOKEN_TYPES.COMMA)) {
      advance(state); // consume comma
    }
  }

  return annotations;
}

// ============================================================
// Main parsing function
// ============================================================

/**
 * Result of parsing a signature string at registration time.
 */
export interface ParsedSignature {
  readonly params: RillParam[];
  readonly returnType: RillType | undefined;
  readonly description: string | undefined;
}

/**
 * Parse a rill closure type signature string into structured parameter declarations.
 *
 * Signature format (optional closure-level annotation before param list):
 * ```
 * ^(description: "...") |^(description: "...") x: string = "default", y: number|:string
 * ```
 * The return type follows `:type` directly after the closing `|`.
 *
 * Throws Error with message `Invalid signature for function '{name}': {parse error}`
 * on any parse failure (EC-8, EC-9).
 *
 * @param signature - The signature string to parse
 * @param functionName - The function name (for error messages)
 * @returns Parsed params, return type, and description
 *
 * @internal
 */
export function parseSignatureRegistration(
  signature: string,
  functionName: string
): ParsedSignature {
  let tokens;
  try {
    tokens = tokenize(signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Invalid signature for function '${functionName}': ${message}`,
      { cause: err }
    );
  }

  // Filter out newlines and comments for cleaner parsing
  const filtered = tokens.filter(
    (t) => t.type !== TOKEN_TYPES.NEWLINE && t.type !== TOKEN_TYPES.COMMENT
  );

  const state = createParserState(filtered, { recoveryMode: false });

  try {
    return parseSignatureBody(state, functionName);
  } catch (err) {
    if (err instanceof ParseError) {
      throw new Error(
        `Invalid signature for function '${functionName}': ${err.message}`,
        { cause: err }
      );
    }
    // Re-throw registration errors (already have proper message format)
    throw err;
  }
}

/**
 * Parse the body of the signature string given a parser state.
 *
 * @internal
 */
function parseSignatureBody(
  state: ParserState,
  functionName: string
): ParsedSignature {
  // Step 1: Optional closure-level annotation ^(...)
  let description: string | undefined = undefined;

  if (check(state, TOKEN_TYPES.CARET)) {
    advance(state); // consume ^
    expect(
      state,
      TOKEN_TYPES.LPAREN,
      `Expected '(' after '^' in signature for function '${functionName}'`
    );
    const annots = parseSignatureAnnotations(state, functionName);
    expect(
      state,
      TOKEN_TYPES.RPAREN,
      `Expected ')' to close annotation in signature for function '${functionName}'`
    );
    description = annots['description'];
    skipNewlines(state);
  }

  // Step 2: Param list between | ... | (or || for zero params)
  const params: RillParam[] = [];

  if (check(state, TOKEN_TYPES.OR)) {
    // || — zero params
    advance(state);
  } else if (check(state, TOKEN_TYPES.PIPE_BAR)) {
    advance(state); // consume opening |
    skipNewlines(state);

    // Parse params until closing |
    while (!check(state, TOKEN_TYPES.PIPE_BAR) && !isAtEnd(state)) {
      const param = parseSignatureParam(state, functionName);
      params.push(param);

      if (check(state, TOKEN_TYPES.COMMA)) {
        advance(state);
        skipNewlines(state);
      }
    }

    if (!check(state, TOKEN_TYPES.PIPE_BAR)) {
      throw new Error(
        `Invalid signature for function '${functionName}': expected '|' to close parameter list`
      );
    }
    advance(state); // consume closing |
  } else {
    throw new Error(
      `Invalid signature for function '${functionName}': expected '|' or '||' to start parameter list`
    );
  }

  skipNewlines(state);

  // Step 3: Optional return type :type
  let returnType: RillType | undefined = undefined;

  if (check(state, TOKEN_TYPES.COLON)) {
    advance(state); // consume :
    skipNewlines(state);
    const typeRef = parseTypeRef(state);
    returnType = staticTypeRefToRillType(typeRef, functionName);
  }

  // Step 5: Verify no trailing tokens
  if (!isAtEnd(state)) {
    const tok = current(state);
    throw new Error(
      `Invalid signature for function '${functionName}': unexpected token '${tok.value}' after signature`
    );
  }

  return { params, returnType, description };
}

/**
 * Parse a single parameter from a signature param list.
 *
 * Grammar: `^(annots) name : type = literal`
 *
 * @internal
 */
function parseSignatureParam(
  state: ParserState,
  functionName: string
): RillParam {
  // Optional param-level annotation ^(...)
  const annotations: Record<string, RillValue> = {};

  if (check(state, TOKEN_TYPES.CARET)) {
    advance(state); // consume ^
    expect(
      state,
      TOKEN_TYPES.LPAREN,
      `Expected '(' after '^' in parameter annotation for function '${functionName}'`
    );
    const annots = parseSignatureAnnotations(state, functionName);
    expect(
      state,
      TOKEN_TYPES.RPAREN,
      `Expected ')' to close parameter annotation for function '${functionName}'`
    );
    // Store annotation values as strings in annotations record
    for (const [key, value] of Object.entries(annots)) {
      annotations[key] = value;
    }
  }

  // Param name
  const nameToken = expect(
    state,
    TOKEN_TYPES.IDENTIFIER,
    `Expected parameter name in signature for function '${functionName}'`
  );
  const name = nameToken.value;

  // Optional type annotation : type
  let type: RillType | undefined = undefined;

  skipNewlines(state);
  if (check(state, TOKEN_TYPES.COLON)) {
    advance(state); // consume :
    skipNewlines(state);
    const typeRef = parseTypeRef(state, { allowTrailingPipe: true });
    type = staticTypeRefToRillType(typeRef, functionName);
  }

  // Optional default value = literal
  let defaultValue: RillValue | undefined = undefined;

  skipNewlines(state);
  if (check(state, TOKEN_TYPES.ASSIGN)) {
    advance(state); // consume =
    skipNewlines(state);
    defaultValue = parseSignatureLiteral(state, functionName);
  }

  return { name, type, defaultValue, annotations };
}

/**
 * Parse a simple literal value for a default parameter value.
 * Supported: string, number, bool (true/false), negative number.
 *
 * @internal
 */
function parseSignatureLiteral(
  state: ParserState,
  functionName: string
): RillValue {
  if (check(state, TOKEN_TYPES.STRING)) {
    const tok = advance(state);
    return tok.value;
  }

  if (check(state, TOKEN_TYPES.NUMBER)) {
    const tok = advance(state);
    return parseFloat(tok.value);
  }

  if (check(state, TOKEN_TYPES.TRUE)) {
    advance(state);
    return true;
  }

  if (check(state, TOKEN_TYPES.FALSE)) {
    advance(state);
    return false;
  }

  // Negative number: - NUMBER
  if (check(state, TOKEN_TYPES.MINUS)) {
    advance(state); // consume -
    if (check(state, TOKEN_TYPES.NUMBER)) {
      const tok = advance(state);
      return -parseFloat(tok.value);
    }
    throw new Error(
      `Invalid signature for function '${functionName}': expected number after '-' in default value`
    );
  }

  const tok = current(state);
  throw new Error(
    `Invalid signature for function '${functionName}': unsupported default value '${tok.value}' (only string, number, bool supported)`
  );
}
