/**
 * Static type inference for rules that judge a value's type from the source
 * alone. Pure helpers: no AST walk. Anything not provable from a bare
 * literal, an assertion, a typed binding, or a pass-through step is unknown
 * and reported as null.
 */

import type { ASTNode, StringLiteralNode, TypeRef } from '@rcrsr/rill';
import type { RuleContext } from './types.js';
import { chainlessVariableName, trailingMemberName } from './helpers.js';
import { scalarLiteralKind, unwrapBareLiteral } from './literal-shape.js';

const STATIC_STRING: TypeRef = { kind: 'static', typeName: 'string' };

/** The kind-only static type of a scalar literal kind name, or null. */
function scalarKindType(kind: string): TypeRef | null {
  switch (kind) {
    case 'number':
      return { kind: 'static', typeName: 'number' };
    case 'string':
      return STATIC_STRING;
    case 'bool':
      return { kind: 'static', typeName: 'bool' };
    case 'atom':
      return { kind: 'static', typeName: 'atom' };
    default:
      return null;
  }
}

/**
 * The type an expression is known to have: a bare scalar literal gives its
 * kind, `expr:T` gives `T`, a chainless variable bound once with a declared
 * type gives that type, and anything else gives null.
 */
export function staticTypeOf(expr: ASTNode, ctx: RuleContext): TypeRef | null {
  const node = unwrapBareLiteral(expr);
  if (node.type === 'TypeAssertion' && node.operand !== null) {
    return node.typeRef;
  }
  const kind = scalarLiteralKind(node);
  if (kind !== null) return scalarKindType(kind);
  const name = chainlessVariableName(node);
  return name === null
    ? null
    : (ctx.facts.script.declaredTypes.get(name) ?? null);
}

/** An operand-less type assertion or a capture: the piped value passes through. */
export function isPassThroughStep(step: ASTNode): boolean {
  return (
    (step.type === 'TypeAssertion' && step.operand === null) ||
    step.type === 'Capture'
  );
}

/** Flatten nested union members into one list of non-union members. */
export function flattenMembers(type: TypeRef): TypeRef[] {
  return type.kind === 'union' ? type.members.flatMap(flattenMembers) : [type];
}

/** The value of a string literal with no interpolation, or null for any other node. */
export function plainStringValue(node: ASTNode): string | null {
  return node.type === 'StringLiteral' &&
    node.parts.every((part) => typeof part === 'string')
    ? node.parts.join('')
    : null;
}

/**
 * Re-express a literal member as a string literal: an atom by its name, a
 * string by its value. Null for any other member or an interpolated string.
 */
function asStringLiteral(member: TypeRef): TypeRef | null {
  if (member.kind !== 'literal') return null;
  const value = member.value;
  if (value.type === 'AtomLiteral') {
    const literal: StringLiteralNode = {
      type: 'StringLiteral',
      parts: [value.name],
      isMultiline: false,
      span: value.span,
    };
    return { kind: 'literal', value: literal };
  }
  return plainStringValue(value) === null ? null : member;
}

/**
 * The type of the piped value after `step`, given its type `prev` before it.
 * A pass-through step keeps `prev` unless it states a type (`:T`, `$x:T`).
 * `-> string` on a union of atom or string literals gives the union of their
 * string values; on anything else it gives a plain string.
 */
export function typeAfterStep(
  prev: TypeRef | null,
  step: ASTNode,
  _ctx: RuleContext
): TypeRef | null {
  if (isPassThroughStep(step)) {
    if (step.type === 'TypeAssertion') return step.typeRef;
    if (step.type === 'Capture') return step.typeRef ?? prev;
  }
  if (step.type === 'TypeNameExpr' && step.typeName === 'string') {
    if (prev?.kind !== 'union') return STATIC_STRING;
    const members = flattenMembers(prev).map(asStringLiteral);
    const literals = members.filter((member) => member !== null);
    return literals.length === members.length && literals.length > 0
      ? { kind: 'union', members: literals }
      : STATIC_STRING;
  }
  return null;
}

/**
 * True for an `.entries` method stage, or a variable or postfix expression
 * whose trailing paren-less member read is `entries`.
 */
export function isEntriesRead(node: ASTNode): boolean {
  if (node.type === 'MethodCall') return node.name === 'entries';
  if (node.type === 'PostfixExpr' && node.methods.length === 0) {
    return trailingMemberName(node.primary) === 'entries';
  }
  return trailingMemberName(node) === 'entries';
}
