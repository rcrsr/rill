/**
 * Signature Parser
 *
 * Parses annotated rill fn type signature strings at registration time into
 * a TypeRef and its annotation args. This module bridges the lexer/parser
 * boundary so runtime/core/signature-registration.ts can read signatures
 * without importing from parser/* or lexer/* directly. It only parses;
 * converting the result to types lives in the runtime.
 *
 * Import boundary note:
 * - This file lives at src/ level (not in runtime/), so it may import from
 *   both lexer and parser barrels.
 * - It imports no runtime file, so no import cycle passes through it.
 */

import { LexerError } from './lexer/index.js';
import { ParseError, isUnnamedParam } from './types.js';
import { parse } from './parser/index.js';
import { formatMessageAtLocation } from './error-classes.js';
import type { SourceLocation } from './source-location.js';
import type { AnnotationArg, StatementNode, TypeRef } from './types.js';

/**
 * Build a registration error ending with the 1-based position inside the
 * signature string.
 *
 * @internal
 */
export function signatureError(
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
 * Parse a signature string into one fn type statement, with the annotations
 * that precede it. Lex and parse failures carry the registration prefix.
 *
 * @internal
 */
function parseSignatureStatement(
  signature: string,
  functionName: string
): {
  readonly statement: StatementNode;
  readonly annotations: readonly AnnotationArg[];
} {
  let statements;
  try {
    statements = parse(signature).statements;
  } catch (err) {
    if (err instanceof ParseError && err.message.includes("'|params|'")) {
      // The script hint names a body form, which a signature never takes.
      throw signatureError(
        functionName,
        "the '|params|' signature form was removed; write fn(x: string):string",
        err.location ?? { line: 1, column: 1, offset: 0 }
      );
    }
    if (err instanceof ParseError || err instanceof LexerError) {
      throw new Error(
        `Invalid signature for function '${functionName}': ${err.message}`,
        { cause: err }
      );
    }
    if (err instanceof RangeError) {
      throw new Error(
        `Invalid signature for function '${functionName}': nesting is too deep`,
        { cause: err }
      );
    }
    throw err;
  }
  const only = statements.length === 1 ? statements[0] : undefined;
  if (only?.type === 'Statement') return { statement: only, annotations: [] };
  if (only?.type === 'AnnotatedStatement') {
    return { statement: only.statement, annotations: only.annotations };
  }
  throw signatureError(
    functionName,
    'must be a fn(...) type; no body',
    only?.span.start ?? { line: 1, column: 1, offset: 0 }
  );
}

/**
 * A parsed signature string: the fn type, the annotations written before it,
 * and the position where the fn type starts.
 */
export interface ParsedSignatureType {
  readonly typeRef: Extract<TypeRef, { kind: 'fn' }>;
  readonly annotations: readonly AnnotationArg[];
  readonly at: SourceLocation;
}

/**
 * Parse a rill fn type signature string.
 *
 * Signature format (optional function-level annotation before the type):
 * ```
 * ^(description: "...") fn(^(description: "...") x: string = "default", y: number):string
 * ```
 * The parameter list requires parentheses and named params; the result type
 * follows `:type` directly after the closing `)`.
 *
 * Throws Error with message `Invalid signature for function '{name}': {parse error}`
 * on any lex or parse failure, a body after the type, or an unnamed parameter.
 *
 * @param signature - The signature string to parse
 * @param functionName - The function name (for error messages)
 *
 * @internal
 */
export function parseSignatureType(
  signature: string,
  functionName: string
): ParsedSignatureType {
  const { statement, annotations } = parseSignatureStatement(
    signature,
    functionName
  );
  const { head, pipes, terminator } = statement.expression;
  const primary = head.type === 'PostfixExpr' ? head.primary : undefined;
  if (
    primary?.type !== 'FnType' ||
    head.type !== 'PostfixExpr' ||
    head.methods.length > 0 ||
    pipes.length > 0 ||
    terminator !== null ||
    primary.typeRef.kind !== 'fn' ||
    primary.typeRef.params === undefined
  ) {
    throw signatureError(
      functionName,
      'must be a fn(...) type; no body',
      statement.span.start
    );
  }
  const typeRef = primary.typeRef;

  for (const param of typeRef.params ?? []) {
    if (isUnnamedParam(param)) {
      throw signatureError(
        functionName,
        'parameters must be named; an unnamed parameter is not allowed in a signature',
        param.span.start
      );
    }
  }

  return { typeRef, annotations, at: primary.span.start };
}
