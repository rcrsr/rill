/**
 * Signature Registration
 *
 * Turns a host function signature string into params, a return type, and
 * annotations at registration time. The string is parsed by the
 * signature-parser.ts bridge and converted by the same type-ref.ts conversion
 * a script type expression uses, so a signature accepts exactly the types a
 * script fn type does.
 *
 * Whatever the conversion asks to evaluate (a default, an annotation value)
 * is read here as a constant: a literal with no interpolation, variable,
 * call, closure, or spread.
 *
 * @internal
 */

import { parseSignatureType, signatureError } from '../../signature-parser.js';
import type {
  AnnotationArg,
  ExpressionNode,
  ListSpreadNode,
  LiteralNode,
  PrimaryNode,
  SourceLocation,
} from '../../types.js';
import {
  convertTypeRef,
  LEAF_TYPES,
  type TypeRefEnv,
  type TypeRefRequest,
  type TypeRefStep,
} from './types/type-ref.js';
import { resolveAtom, toAtomValue } from './types/atom-registry.js';
import { createOrdered, createTuple } from './types/constructors.js';
import { setDictField } from './types/dict-keys.js';
import { isStructureKind } from './types/guards.js';
import { isReservedBrandKey } from './values.js';
import type { RillValue } from './types/structures.js';
import type { RillParam } from './callable.js';
import {
  registerSignatureReader,
  type ParsedSignature,
} from './function-shorthand.js';

// ============================================================
// CONSTANT READER
// ============================================================

/** Reads the constants a signature may carry; throws a positioned error. */
interface ConstantReader {
  literal(node: LiteralNode): RillValue;
  annotations(args: readonly AnnotationArg[]): Record<string, RillValue>;
}

function createConstantReader(name: string): ConstantReader {
  const reject = (what: string, at: SourceLocation): never => {
    throw signatureError(
      name,
      `${what} is not allowed here; a signature holds constant literals only`,
      at
    );
  };

  const readEntries = (
    entries: readonly {
      readonly key: unknown;
      readonly keyForm?: string | undefined;
      readonly value: ExpressionNode;
      readonly span: { readonly start: SourceLocation };
    }[]
  ): Map<string, RillValue> => {
    const out = new Map<string, RillValue>();
    for (const entry of entries) {
      const at = entry.span.start;
      if (typeof entry.key !== 'string') {
        reject('a computed or variable key', at);
        continue;
      }
      if (entry.key === '...' && entry.keyForm === undefined) {
        reject('a spread', at);
      }
      if (isReservedBrandKey(entry.key)) {
        throw signatureError(
          name,
          `Cannot use reserved brand key '${entry.key}' as a key`,
          at
        );
      }
      out.set(entry.key, readExpression(entry.value));
    }
    return out;
  };

  const readItems = (
    items: readonly (ExpressionNode | ListSpreadNode)[]
  ): RillValue[] =>
    items.map((item) =>
      item.type === 'ListSpread'
        ? reject('a spread', item.span.start)
        : readExpression(item)
    );

  const readPrimary = (primary: PrimaryNode): RillValue => {
    switch (primary.type) {
      case 'StringLiteral': {
        const parts: string[] = [];
        for (const part of primary.parts) {
          if (typeof part !== 'string') {
            return reject('string interpolation', part.span.start);
          }
          parts.push(part);
        }
        return parts.join('');
      }
      case 'NumberLiteral':
      case 'BoolLiteral':
        return primary.value;
      case 'AtomLiteral':
        return toAtomValue(resolveAtom(primary.name));
      case 'ListLiteral':
        if (primary.defaultValue !== null) {
          return reject('a default body', primary.span.start);
        }
        return readItems(primary.elements);
      case 'TupleLiteral':
        return createTuple(readItems(primary.elements));
      case 'DictLiteral': {
        const record: Record<string, RillValue> = {};
        for (const [key, value] of readEntries(primary.entries)) {
          setDictField(record, key, value);
        }
        return record;
      }
      case 'OrderedLiteral':
        return createOrdered([...readEntries(primary.entries)]);
      default:
        return reject(`a ${primary.type} expression`, primary.span.start);
    }
  };

  const readExpression = (expression: ExpressionNode): RillValue => {
    if (expression.type !== 'PipeChain') {
      return reject('a partial expression', expression.span.start);
    }
    const { head } = expression;
    if (expression.pipes.length > 0 || expression.terminator !== null) {
      return reject('a pipe or capture', expression.span.start);
    }
    if (head.type === 'UnaryExpr') {
      const { operand } = head;
      if (
        head.op === '-' &&
        operand.type === 'PostfixExpr' &&
        operand.primary.type === 'NumberLiteral' &&
        operand.methods.length === 0
      ) {
        return -operand.primary.value;
      }
      return reject('an operator', head.span.start);
    }
    if (
      head.type !== 'PostfixExpr' ||
      head.methods.length > 0 ||
      head.defaultValue !== null ||
      (head.existenceCheck !== undefined && head.existenceCheck !== null)
    ) {
      return reject('an expression', head.span.start);
    }
    return readPrimary(head.primary);
  };

  return {
    literal: (node) => readPrimary(node),
    annotations: (args) => {
      const record: Record<string, RillValue> = {};
      for (const arg of args) {
        if (arg.type !== 'NamedArg') {
          return reject('an annotation spread', arg.span.start);
        }
        if (isReservedBrandKey(arg.name)) {
          throw signatureError(
            name,
            `Cannot use reserved brand key '${arg.name}' as annotation key`,
            arg.span.start
          );
        }
        setDictField(record, arg.name, readExpression(arg.value));
      }
      return record;
    },
  };
}

// ============================================================
// DRIVER
// ============================================================

/** Run a conversion to its result, answering each request from the reader. */
function drive<T>(
  step: TypeRefStep<T>,
  answer: (request: TypeRefRequest) => RillValue
): T {
  let next = step.next();
  while (next.done !== true) {
    next = step.next(answer(next.value));
  }
  return next.value;
}

/**
 * Parse a rill fn type signature string into structured parameter declarations.
 *
 * Signature format (optional function-level annotation before the type):
 * ```
 * ^(description: "...") fn(^(description: "...") x: string = "default", y: number):string
 * ```
 * Any type a script fn type accepts is valid, except `$name` type references.
 * Defaults and annotation values must be constant literals.
 *
 * Throws Error with message `Invalid signature for function '{name}': {detail}`
 * on any lex, parse, or conversion failure.
 *
 * @param signature - The signature string to parse
 * @param functionName - The function name (for error messages)
 * @returns Parsed params, return type, description, and annotations
 *
 * @internal
 */
export function parseSignatureRegistration(
  signature: string,
  functionName: string
): ParsedSignature {
  const { typeRef, annotations, at } = parseSignatureType(
    signature,
    functionName
  );
  const reader = createConstantReader(functionName);
  const env: TypeRefEnv = {
    leafTypes: LEAF_TYPES,
    variable: (_name, location) => {
      throw signatureError(
        functionName,
        'dynamic type references ($variable) are not allowed in signatures',
        location ?? at
      );
    },
    fail: (fault) => {
      throw signatureError(functionName, fault.message, fault.location ?? at);
    },
  };
  const converted = drive(convertTypeRef(typeRef, env, at), (request) =>
    request.kind === 'literal'
      ? reader.literal(request.node)
      : reader.annotations(request.args)
  );
  const structure = converted.structure;
  const fields = isStructureKind(structure, 'fn')
    ? (structure.params ?? [])
    : [];
  const written = typeRef.params ?? [];

  const params = written.map((param, index): RillParam => {
    const field = fields[index];
    return {
      name: param.name,
      type: param.typeRef === null ? undefined : field?.type,
      defaultValue: field?.defaultValue,
      annotations: field?.annotations ?? {},
    };
  });

  const functionAnnotations = reader.annotations(annotations);
  const description = functionAnnotations['description'];
  return {
    params,
    returnType:
      typeRef.outer === undefined || !isStructureKind(structure, 'fn')
        ? undefined
        : structure.ret,
    description: typeof description === 'string' ? description : undefined,
    annotations: functionAnnotations,
  };
}

registerSignatureReader(parseSignatureRegistration);
