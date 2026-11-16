/**
 * Flags `tuple(T)` in a type position. A tuple type with one argument names
 * exactly one position, which is rarely the intent: `:tuple` accepts any
 * length and `list(T)` describes a sequence. Reaches nested occurrences
 * through union members and every argument value.
 */

import type {
  ASTNode,
  FieldArg,
  LiteralNode,
  SourceLocation,
  TypeRef,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

function literalToString(node: LiteralNode): string {
  switch (node.type) {
    case 'NumberLiteral':
    case 'BoolLiteral':
      return String(node.value);
    case 'AtomLiteral':
      return `#${node.name}`;
    case 'StringLiteral':
      return node.parts.every((p): p is string => typeof p === 'string')
        ? JSON.stringify(node.parts.join(''))
        : 'any';
    default:
      return 'any';
  }
}

/** Renders a type reference as source-like text for the diagnostic message. */
function typeRefToString(ref: TypeRef): string {
  switch (ref.kind) {
    case 'static': {
      if (ref.args === undefined || ref.args.length === 0) return ref.typeName;
      const args = ref.args
        .map((arg) =>
          arg.name === undefined
            ? typeRefToString(arg.value)
            : `${arg.name}: ${typeRefToString(arg.value)}`
        )
        .join(', ');
      return `${ref.typeName}(${args})`;
    }
    case 'union':
      return `union(${ref.members.map(typeRefToString).join(', ')})`;
    case 'dynamic':
      return 'any';
    case 'literal':
      return literalToString(ref.value);
    default:
      return 'any';
  }
}

/** Collects the element type of every one-argument tuple in the arguments. */
function collectFromArgs(args: readonly FieldArg[], out: string[]): void {
  for (const arg of args) collectFromRef(arg.value, out);
}

function collectFromRef(ref: TypeRef, out: string[]): void {
  switch (ref.kind) {
    case 'static': {
      const args = ref.args;
      if (args === undefined) return;
      const [only] = args;
      if (ref.typeName === 'tuple' && args.length === 1 && only !== undefined) {
        out.push(typeRefToString(only.value));
      }
      collectFromArgs(args, out);
      return;
    }
    case 'union':
      for (const member of ref.members) collectFromRef(member, out);
      return;
    case 'dynamic':
    case 'literal':
      return;
  }
}

/** Type-position payloads carried by the owning node, or an empty list. */
function typeRefsOf(node: ASTNode): TypeRef[] {
  switch (node.type) {
    case 'TypeAssertion':
    case 'TypeCheck':
      return [node.typeRef];
    case 'Capture':
    case 'ClosureParam':
    case 'DestructPattern':
      return node.typeRef ? [node.typeRef] : [];
    case 'UseExpr': {
      const refs: TypeRef[] = node.typeRef ? [node.typeRef] : [];
      for (const param of node.closureAnnotation ?? []) {
        refs.push(param.typeRef);
      }
      return refs;
    }
    case 'PostfixExpr':
    case 'Variable': {
      const ref = node.existenceCheck?.typeRef;
      return ref ? [ref] : [];
    }
    case 'Closure': {
      const target = node.returnTypeTarget;
      return target !== undefined && !('type' in target) ? [target] : [];
    }
    default:
      return [];
  }
}

export const tupleOnePosition: Rule = {
  code: 'TUPLE_ONE_POSITION',
  nodeTypes: [
    'TypeAssertion',
    'TypeCheck',
    'Capture',
    'ClosureParam',
    'Closure',
    'DestructPattern',
    'UseExpr',
    'PostfixExpr',
    'Variable',
    'TypeConstructor',
  ],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const elements: string[] = [];
    if (node.type === 'TypeConstructor') {
      if (node.constructorName === 'tuple' && node.args.length === 1) {
        const [only] = node.args;
        if (only !== undefined) elements.push(typeRefToString(only.value));
      }
      collectFromArgs(node.args, elements);
    } else {
      for (const ref of typeRefsOf(node)) collectFromRef(ref, elements);
    }

    const location: SourceLocation = node.span.start;
    return elements.map((element) => ({
      location,
      severity: 'info',
      code: 'TUPLE_ONE_POSITION',
      message: `tuple(${element}) names exactly one position. Write :tuple to accept a tuple of any length, or -> list(${element}) for a sequence; a type meant for one element needs no change.`,
      context: extractContextLine(location.line, context.source),
      fix: null,
    }));
  },
};

registeredRules.push(tupleOnePosition);
