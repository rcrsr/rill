/**
 * Flags a second capture into a variable first captured with `:any` when the
 * new value has a different type. `:any` locks the variable to the first
 * value's own type, so the re-capture halts RILL-R001. Types come only from
 * the capture facts; an unknown type on either capture stays silent.
 */

import { formatTypeRef } from '@rcrsr/rill';
import type { ASTNode, TypeRef } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { isVariableInParentScope } from './scope-helpers.js';
import { flattenMembers, isAnyType } from './static-type.js';

/**
 * Comparison key for a type: the type name for a static type, the base kind
 * for a literal member (so `"a"` and `string` agree), else its text.
 */
function kindKey(type: TypeRef): string {
  if (type.kind === 'static') return type.typeName;
  if (type.kind === 'literal') {
    switch (type.value.type) {
      case 'StringLiteral':
        return 'string';
      case 'AtomLiteral':
        return 'atom';
      case 'NumberLiteral':
        return 'number';
      case 'BoolLiteral':
        return 'bool';
      default:
        break;
    }
  }
  return formatTypeRef(type);
}

export const anyCaptureLock: Rule = {
  code: 'ANY_CAPTURE_LOCK',
  nodeTypes: ['Capture'],
  defaultSeverity: 'error',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'Capture') return [];
    const varName = node.name;
    if (context.variables.get(varName) === undefined) return [];

    // The capture that locked the variable in the current scope, not merely
    // the first capture of that name anywhere in the script.
    const lockOffset = context.variables.get(varName)?.offset;
    const first = context.facts.script.captureLog.find(
      (entry) =>
        entry.node.name === varName &&
        entry.node.span.start.offset === lockOffset
    )?.node;
    if (first === undefined || first === node) return [];
    if (first.typeRef === null || !isAnyType(first.typeRef)) return [];

    const isInSameOrParentScope = isVariableInParentScope(
      context.variableScopes.get(varName) ?? null,
      context.scopeStack.at(-1) ?? null,
      context.scopeStack
    );
    if (!isInSameOrParentScope) return [];

    const { captureValueTypes } = context.facts.script;
    const firstType = captureValueTypes.get(first);
    const secondType = captureValueTypes.get(node);
    if (firstType === undefined || secondType === undefined) return [];

    if (
      [firstType, secondType].some((t) => flattenMembers(t).some(isAnyType))
    ) {
      return [];
    }

    const admitted = new Set(flattenMembers(firstType).map(kindKey));
    const second = flattenMembers(secondType);
    if (second.some((member) => admitted.has(kindKey(member)))) return [];

    return [
      {
        code: 'ANY_CAPTURE_LOCK',
        message: `'$${varName}' was captured with :any at line ${first.span.start.line}, and :any locks to the first value's type (${formatTypeRef(firstType)}). Capturing ${formatTypeRef(secondType)} here halts RILL-R001. Annotate the first capture with a union, such as union(${formatTypeRef(firstType)}, ${formatTypeRef(secondType)}).`,
        severity: 'error',
        location: node.span.start,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(anyCaptureLock);
