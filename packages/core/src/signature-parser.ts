/**
 * Signature Parser
 *
 * Parses annotated rill closure type signature strings at registration time.
 * This module bridges the lexer/parser boundary so that runtime/core/context.ts
 * can parse signatures without importing from parser/* or lexer/* directly.
 *
 * Import boundary note:
 * - This file lives at src/ level (not in runtime/), so it may import from
 *   both lexer and parser barrels.
 * - runtime/core/context.ts imports from this file (../../signature-parser.js),
 *   which is NOT in parser/* or lexer/* — boundary preserved.
 */

import { tokenize } from './lexer/index.js';
import { ERROR_IDS, ParseError, TOKEN_TYPES } from './types.js';
import { setDictField } from './runtime/core/types/dict-keys.js';
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
import { formatMessageAtLocation } from './error-classes.js';
import type { SourceLocation } from './source-location.js';
import {
  defaultMismatchMessage,
  nonTrailingDefaultIndex,
  nonTrailingDefaultMessage,
} from './runtime/core/types/field-defaults.js';
// oxlint-disable-next-line import/no-cycle -- operations.ts reaches this file through callable.ts and function-shorthand.ts; the import is used only when a signature is parsed, never at module-init time
import { defaultMismatch } from './runtime/core/types/operations.js';
import type {
  BoolLiteralNode,
  FieldArg,
  LiteralNode,
  NumberLiteralNode,
  StringLiteralNode,
  TypeRef,
} from './types.js';
import type { RillParam } from './runtime/core/callable.js';
import type {
  RillFieldDef,
  TypeStructure,
  RillValue,
} from './runtime/core/types/structures.js';

// ============================================================
// TypeRef → TypeStructure static conversion
// ============================================================

/**
 * Build a registration error ending with the 1-based position inside the
 * signature string.
 *
 * @internal
 */
function signatureError(
  functionName: string,
  detail: string,
  at: SourceLocation
): Error {
  return new Error(
    formatMessageAtLocation(
      `Invalid signature for function '${functionName}': ${detail}`,
      at
    )
  );
}

/**
 * Convert a static TypeRef to a TypeStructure.
 *
 * Only handles static refs (type names and unions). Dynamic refs ($var)
 * are not valid in registration-time signatures — they throw Error.
 *
 * @internal
 */
function staticTypeRefToTypeStructure(
  typeRef: TypeRef,
  functionName: string,
  at: SourceLocation
): TypeStructure {
  if (typeRef.kind === 'dynamic') {
    throw signatureError(
      functionName,
      'dynamic type references ($variable) are not allowed in signatures',
      at
    );
  }

  if (typeRef.kind === 'union') {
    return {
      kind: 'union',
      members: typeRef.members.map((m) =>
        staticTypeRefToTypeStructure(m, functionName, at)
      ),
    };
  }

  // static kind
  const { typeName, args } = typeRef;

  if (!args || args.length === 0) {
    return { kind: typeName };
  }

  // Parameterized types
  if (typeName === 'list') {
    if (
      args.length === 1 &&
      args[0] !== undefined &&
      args[0].name === undefined
    ) {
      if (args[0].defaultValue !== undefined) {
        throw signatureError(
          functionName,
          'list element type cannot carry a default value',
          at
        );
      }
      const element = staticTypeRefToTypeStructure(
        args[0].value,
        functionName,
        at
      );
      return { kind: 'list', element };
    }
    throw signatureError(
      functionName,
      'list requires exactly one positional type argument',
      at
    );
  }

  if (typeName === 'dict') {
    const fields: Record<string, RillFieldDef> = {};
    for (const arg of args) {
      if (arg.name === undefined) {
        throw signatureError(
          functionName,
          'dict type arguments must be named (e.g. dict(key: string))',
          at
        );
      }
      setDictField(
        fields,
        arg.name,
        signatureFieldDef(arg, `field '${arg.name}'`, functionName, at)
      );
    }
    return { kind: 'dict', fields };
  }

  if (typeName === 'tuple') {
    const elements = args.map((arg): RillFieldDef => ({
      ...(arg.name !== undefined ? { name: arg.name } : {}),
      ...signatureFieldDef(arg, 'tuple element', functionName, at),
    }));
    const misplaced = nonTrailingDefaultIndex(elements);
    if (misplaced !== -1) {
      throw signatureError(
        functionName,
        nonTrailingDefaultMessage(misplaced),
        at
      );
    }
    return { kind: 'tuple', elements };
  }

  throw signatureError(
    functionName,
    `type '${typeName}' does not accept type arguments`,
    at
  );
}

/**
 * Build the field definition for one dict field or tuple element, carrying
 * its default when the signature declares one.
 *
 * @internal
 */
function signatureFieldDef(
  arg: FieldArg,
  subject: string,
  functionName: string,
  at: SourceLocation
): RillFieldDef {
  const type = staticTypeRefToTypeStructure(arg.value, functionName, at);
  if (arg.defaultValue === undefined) return { type };

  if (!isSignatureLiteral(arg.defaultValue)) {
    throw signatureError(
      functionName,
      `${subject} default must be a string, number, or bool literal`,
      at
    );
  }
  const defaultValue = signatureLiteralValue(arg.defaultValue);
  const mismatch = defaultMismatch(defaultValue, type);
  if (mismatch !== null) {
    throw signatureError(
      functionName,
      defaultMismatchMessage(subject, mismatch),
      at
    );
  }
  return { type, defaultValue };
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
    throw signatureError(
      functionName,
      'annotation values must be string literals',
      current(state).span.start
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
      setDictField(annotations, 'description', tok.value);
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
      setDictField(annotations, nameToken.value, value);
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
interface ParsedSignature {
  readonly params: RillParam[];
  readonly returnType: TypeStructure | undefined;
  readonly description: string | undefined;
  readonly annotations: Record<string, string>;
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
 * on any parse failure.
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
  const closureAnnotations: Record<string, string> = {};

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
    for (const [key, value] of Object.entries(annots)) {
      setDictField(closureAnnotations, key, value);
    }
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
        continue;
      }

      if (check(state, TOKEN_TYPES.PIPE_BAR)) {
        break;
      }

      throw new ParseError(
        ERROR_IDS.RILL_P005,
        "expected ',' or '|' between parameters",
        current(state).span.start
      );
    }

    if (!check(state, TOKEN_TYPES.PIPE_BAR)) {
      throw signatureError(
        functionName,
        "expected '|' to close parameter list",
        current(state).span.start
      );
    }
    advance(state); // consume closing |
  } else {
    throw signatureError(
      functionName,
      "expected '|' or '||' to start parameter list",
      current(state).span.start
    );
  }

  skipNewlines(state);

  // Step 3: Optional return type :type
  let returnType: TypeStructure | undefined = undefined;

  if (check(state, TOKEN_TYPES.COLON)) {
    advance(state); // consume :
    skipNewlines(state);
    const typeStart = current(state).span.start;
    const typeRef = parseTypeRef(state, {
      parseLiteral: () => parseSignatureLiteral(state, functionName),
    });
    returnType = staticTypeRefToTypeStructure(typeRef, functionName, typeStart);
  }

  // Step 5: Verify no trailing tokens
  if (!isAtEnd(state)) {
    const tok = current(state);
    throw signatureError(
      functionName,
      `unexpected token '${tok.value}' after signature`,
      tok.span.start
    );
  }

  return {
    params,
    returnType,
    description,
    annotations: closureAnnotations,
  };
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
      setDictField(annotations, key, value);
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
  let type: TypeStructure | undefined = undefined;

  skipNewlines(state);
  if (check(state, TOKEN_TYPES.COLON)) {
    advance(state); // consume :
    skipNewlines(state);
    const typeStart = current(state).span.start;
    const typeRef = parseTypeRef(state, {
      allowTrailingPipe: true,
      parseLiteral: () => parseSignatureLiteral(state, functionName),
    });
    type = staticTypeRefToTypeStructure(typeRef, functionName, typeStart);
  }

  // Optional default value = literal
  let defaultValue: RillValue | undefined = undefined;

  skipNewlines(state);
  if (check(state, TOKEN_TYPES.ASSIGN)) {
    advance(state); // consume =
    skipNewlines(state);
    defaultValue = signatureLiteralValue(
      parseSignatureLiteral(state, functionName)
    );
  }

  return { name, type, defaultValue, annotations };
}

/** The literal kinds a signature default may use. */
type SignatureLiteral = StringLiteralNode | NumberLiteralNode | BoolLiteralNode;

function isSignatureLiteral(node: LiteralNode): node is SignatureLiteral {
  return (
    node.type === 'StringLiteral' ||
    node.type === 'NumberLiteral' ||
    node.type === 'BoolLiteral'
  );
}

/**
 * The value of a default literal parsed by parseSignatureLiteral.
 *
 * @internal
 */
function signatureLiteralValue(node: SignatureLiteral): RillValue {
  if (node.type === 'StringLiteral') {
    return node.parts
      .filter((part): part is string => typeof part === 'string')
      .join('');
  }
  return node.value;
}

/**
 * Parse a literal default for a parameter, a dict field, or a tuple element.
 * Supported: string, number, bool (true/false), negative number.
 *
 * @internal
 */
function parseSignatureLiteral(
  state: ParserState,
  functionName: string
): SignatureLiteral {
  if (check(state, TOKEN_TYPES.STRING)) {
    const tok = advance(state);
    return {
      type: 'StringLiteral',
      parts: [tok.value],
      isMultiline: false,
      span: tok.span,
    };
  }

  if (check(state, TOKEN_TYPES.NUMBER)) {
    const tok = advance(state);
    return {
      type: 'NumberLiteral',
      value: parseFloat(tok.value),
      span: tok.span,
    };
  }

  if (check(state, TOKEN_TYPES.TRUE) || check(state, TOKEN_TYPES.FALSE)) {
    const tok = advance(state);
    return {
      type: 'BoolLiteral',
      value: tok.type === TOKEN_TYPES.TRUE,
      span: tok.span,
    };
  }

  // Negative number: - NUMBER
  if (check(state, TOKEN_TYPES.MINUS)) {
    const minus = advance(state); // consume -
    if (check(state, TOKEN_TYPES.NUMBER)) {
      const tok = advance(state);
      return {
        type: 'NumberLiteral',
        value: -parseFloat(tok.value),
        span: { start: minus.span.start, end: tok.span.end },
      };
    }
    throw signatureError(
      functionName,
      "expected number after '-' in default value",
      current(state).span.start
    );
  }

  const tok = current(state);
  throw signatureError(
    functionName,
    `unsupported default value '${tok.value}' (only string, number, bool supported)`,
    tok.span.start
  );
}
