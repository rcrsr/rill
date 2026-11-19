/**
 * Signature Parser
 *
 * Parses annotated rill fn type signature strings at registration time.
 * This module bridges the lexer/parser boundary so that runtime/core/context.ts
 * can parse signatures without importing from parser/* or lexer/* directly.
 *
 * Import boundary note:
 * - This file lives at src/ level (not in runtime/), so it may import from
 *   both lexer and parser barrels.
 * - runtime/core/context.ts imports from this file (../../signature-parser.js),
 *   which is NOT in parser/* or lexer/* — boundary preserved.
 */

import { LexerError } from './lexer/index.js';
import { ParseError, isUnnamedParam } from './types.js';
import { setDictField } from './runtime/core/types/dict-keys.js';
import { parse } from './parser/index.js';
import { formatMessageAtLocation } from './error-classes.js';
import type { SourceLocation } from './source-location.js';
import {
  defaultMismatchMessage,
  nonTrailingDefaultIndex,
  nonTrailingDefaultMessage,
} from './runtime/core/types/field-defaults.js';
// oxlint-disable-next-line import/no-cycle -- operations.ts reaches this file through callable.ts and function-shorthand.ts; the import is used only when a signature is parsed, never at module-init time
import { defaultMismatch } from './runtime/core/types/operations.js';
// oxlint-disable-next-line import/no-cycle -- unions.ts imports operations.ts; the cycle is the same call-time-only edge as the operations.js import above
import { normalizeUnion } from './runtime/core/types/unions.js';
import {
  resolveAtom,
  toAtomValue,
} from './runtime/core/types/atom-registry.js';
import { bareTypeStructure } from './runtime/core/types/error-code.js';
import type {
  AnnotationArg,
  BoolLiteralNode,
  ClosureParamNode,
  ExpressionNode,
  FieldArg,
  LiteralNode,
  NumberLiteralNode,
  StatementNode,
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
 * Only handles static refs (type names, unions, and fn types). Dynamic refs ($var)
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

  if (typeRef.kind === 'literal') {
    throw signatureError(
      functionName,
      'a literal is only valid as a union member',
      at
    );
  }

  if (typeRef.kind === 'union') {
    const written = typeRef.members.map((member): TypeStructure => {
      if (member.kind !== 'literal') {
        return staticTypeRefToTypeStructure(member, functionName, at);
      }
      const literal = member.value;
      if (literal.type === 'AtomLiteral') {
        return {
          kind: 'literal',
          value: toAtomValue(resolveAtom(literal.name)),
        };
      }
      if (!isSignatureLiteral(literal)) {
        throw signatureError(
          functionName,
          'union member must be a type or a string, number, bool, or atom literal',
          at
        );
      }
      const value = signatureLiteralValue(literal);
      if (
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw signatureError(
          functionName,
          'union member must be a type or a string, number, bool, or atom literal',
          at
        );
      }
      return { kind: 'literal', value };
    });
    const normalized = normalizeUnion(written);
    if ('rejection' in normalized) {
      throw signatureError(functionName, normalized.rejection, at);
    }
    return normalized.structure;
  }

  if (typeRef.kind === 'fn') {
    const structure: Extract<TypeStructure, { kind: 'fn' }> = { kind: 'fn' };
    if (typeRef.params !== undefined) {
      structure.params = typeRef.params.map((param) =>
        paramFieldDef(param, functionName)
      );
    }
    if (typeRef.outer !== undefined) {
      structure.ret = staticTypeRefToTypeStructure(
        typeRef.outer,
        functionName,
        at
      );
    }
    return structure;
  }

  // static kind
  const { typeName, args } = typeRef;

  if (!args || args.length === 0) {
    return bareTypeStructure(typeName);
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

/** The literal kinds a signature default may use. */
type SignatureLiteral = StringLiteralNode | NumberLiteralNode | BoolLiteralNode;

function isSignatureLiteral(node: LiteralNode): node is SignatureLiteral {
  // An interpolated string has a meaning only at run time, so a signature
  // rejects it rather than dropping its interpolated parts.
  if (node.type === 'StringLiteral') {
    return node.parts.every((part) => typeof part === 'string');
  }
  return node.type === 'NumberLiteral' || node.type === 'BoolLiteral';
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

// ============================================================
// Fn parameter and annotation conversion
// ============================================================

/**
 * Read the string a plain string-literal expression holds, or undefined when
 * the expression is anything else (interpolation, call, variable, ...).
 *
 * @internal
 */
function plainStringValue(expression: ExpressionNode): string | undefined {
  if (expression.type !== 'PipeChain') return undefined;
  const { head } = expression;
  if (
    expression.pipes.length > 0 ||
    expression.terminator !== null ||
    head.type !== 'PostfixExpr' ||
    head.methods.length > 0 ||
    head.primary.type !== 'StringLiteral'
  ) {
    return undefined;
  }
  const { parts } = head.primary;
  return parts.every((part) => typeof part === 'string')
    ? parts.join('')
    : undefined;
}

/**
 * Convert parsed `^(key: "value")` annotation args to a string record. Only
 * plain string-literal values are valid in signatures.
 *
 * @internal
 */
function annotationRecord(
  args: readonly AnnotationArg[] | undefined,
  functionName: string
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const arg of args ?? []) {
    const value =
      arg.type === 'NamedArg' ? plainStringValue(arg.value) : undefined;
    if (arg.type !== 'NamedArg' || value === undefined) {
      throw signatureError(
        functionName,
        'annotation values must be string literals',
        arg.span.start
      );
    }
    setDictField(record, arg.name, value);
  }
  return record;
}

/**
 * Convert one fn parameter to a field definition. An unnamed param carries no
 * name; an untyped one reads as `any`.
 *
 * @internal
 */
function paramFieldDef(
  param: ClosureParamNode,
  functionName: string
): RillFieldDef {
  const named = !isUnnamedParam(param);
  const arg: FieldArg = {
    value: param.typeRef ?? { kind: 'static', typeName: 'any' },
    ...(param.defaultValue !== null
      ? { defaultValue: param.defaultValue }
      : {}),
  };
  const def = signatureFieldDef(
    arg,
    named ? `parameter '${param.name}'` : 'parameter',
    functionName,
    param.span.start
  );
  const annotations = annotationRecord(param.annotations, functionName);
  return {
    ...(named ? { name: param.name } : {}),
    ...def,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
  };
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
 * Parse a rill fn type signature string into structured parameter declarations.
 *
 * Signature format (optional function-level annotation before the type):
 * ```
 * ^(description: "...") fn(^(description: "...") x: string = "default", y: number):string
 * ```
 * The parameter list requires parentheses and named params; the result type
 * follows `:type` directly after the closing `)`.
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
  const { params, outer } = primary.typeRef;

  const rillParams = params.map((param): RillParam => {
    if (isUnnamedParam(param)) {
      throw signatureError(
        functionName,
        'parameters must be named; an unnamed parameter is not allowed in a signature',
        param.span.start
      );
    }
    const def = paramFieldDef(param, functionName);
    return {
      name: param.name,
      type: param.typeRef === null ? undefined : def.type,
      defaultValue: def.defaultValue,
      annotations: def.annotations ?? {},
    };
  });

  const functionAnnotations = annotationRecord(annotations, functionName);
  return {
    params: rillParams,
    returnType:
      outer === undefined
        ? undefined
        : staticTypeRefToTypeStructure(outer, functionName, primary.span.start),
    description: functionAnnotations['description'],
    annotations: functionAnnotations,
  };
}
