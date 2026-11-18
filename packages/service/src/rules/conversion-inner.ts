/**
 * Flags a pipe into a collection type constructor that silently converts the
 * inner values of a statically known source: `list[1, 2] -> list(string)`
 * rewrites every number to a string. The type-assertion form
 * `-> :list(string)` checks without converting.
 *
 * Only sources with a known shape take part: a bare collection literal of
 * scalar literals, or a parameterized static type assertion. Any other
 * source, or a target part that is not a scalar type name, keeps the rule
 * silent.
 */

import type {
  ASTNode,
  FieldArg,
  PipeChainNode,
  TypeConstructorNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { formatFieldKey } from '../dict-key.js';
import { literalKind, unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// SOURCE AND TARGET PARTS
// ============================================================

const SCALAR_KINDS: ReadonlySet<string> = new Set([
  'number',
  'string',
  'bool',
  'atom',
]);
const CONVERTING_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'list',
  'dict',
  'tuple',
  'ordered',
]);

/** A scalar leaf of a source value: its field name, when it has one, and kind. */
interface SourcePart {
  readonly name: string | undefined;
  readonly kind: string;
}

/** The scalar kind of a literal expression, or null when it is not a scalar literal. */
function scalarLiteralKind(expr: ASTNode): string | null {
  const kind = literalKind(unwrapBareLiteral(expr));
  return kind !== null && SCALAR_KINDS.has(kind) ? kind : null;
}

/** Parts of a literal collection of scalar literals, or null when unknowable. */
function literalParts(node: ASTNode): SourcePart[] | null {
  let values: { name: string | undefined; value: ASTNode }[];
  switch (node.type) {
    case 'ListLiteral':
    case 'TupleLiteral':
      values = node.elements.map((value) => ({ name: undefined, value }));
      break;
    case 'Dict':
    case 'DictLiteral':
    case 'OrderedLiteral': {
      values = [];
      for (const entry of node.entries) {
        if (typeof entry.key !== 'string' || entry.key === '...') return null;
        values.push({ name: entry.key, value: entry.value });
      }
      break;
    }
    default:
      return null;
  }
  const parts: SourcePart[] = [];
  for (const { name, value } of values) {
    const kind = scalarLiteralKind(value);
    if (kind === null) return null;
    parts.push({ name, kind });
  }
  return parts;
}

/** The scalar type name of a field argument, or null when it is not a static scalar. */
function argKind(arg: FieldArg): string | null {
  const { value } = arg;
  if (value.kind !== 'static' || value.args !== undefined) return null;
  return SCALAR_KINDS.has(value.typeName) ? value.typeName : null;
}

/** Parts of a parameterized static type assertion, or null when unknowable. */
function assertionParts(node: ASTNode): SourcePart[] | null {
  if (node.type !== 'TypeAssertion') return null;
  const { typeRef } = node;
  if (typeRef.kind !== 'static' || typeRef.args === undefined) return null;
  if (!CONVERTING_CONSTRUCTORS.has(typeRef.typeName)) return null;
  const parts: SourcePart[] = [];
  for (const arg of typeRef.args) {
    const kind = argKind(arg);
    if (kind === null) return null;
    parts.push({ name: arg.name, kind });
  }
  return parts.length > 0 ? parts : null;
}

function sourceParts(head: ASTNode): SourcePart[] | null {
  const node = unwrapBareLiteral(head);
  return literalParts(node) ?? assertionParts(node);
}

// ============================================================
// MISMATCH
// ============================================================

/** The source parts one target argument constrains. */
function constrainedParts(
  target: TypeConstructorNode,
  arg: FieldArg,
  index: number,
  parts: readonly SourcePart[]
): readonly SourcePart[] {
  if (arg.name !== undefined) return parts.filter((p) => p.name === arg.name);
  if (target.constructorName === 'tuple') {
    const part = parts[index];
    return part === undefined ? [] : [part];
  }
  return parts;
}

/** The first source scalar kind and target scalar kind that differ, if any. */
function findMismatch(
  target: TypeConstructorNode,
  parts: readonly SourcePart[]
): { from: string; to: string } | undefined {
  for (const [index, arg] of target.args.entries()) {
    const to = argKind(arg);
    if (to === null) continue;
    for (const part of constrainedParts(target, arg, index, parts)) {
      if (part.kind !== to) return { from: part.kind, to };
    }
  }
  return undefined;
}

function renderArg(arg: FieldArg): string | null {
  const kind = argKind(arg);
  if (kind === null) return null;
  return arg.name === undefined ? kind : `${formatFieldKey(arg.name)}: ${kind}`;
}

/** The target as written, or the constructor name alone when an argument is not a scalar. */
function renderTarget(target: TypeConstructorNode): string {
  const rendered = target.args.map(renderArg);
  const args = rendered.every((r): r is string => r !== null)
    ? rendered.join(', ')
    : '...';
  return `${target.constructorName}(${args})`;
}

// ============================================================
// RULE
// ============================================================

export const pipeConvertsInner: Rule = {
  code: 'PIPE_CONVERTS_INNER',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'PipeChain') return [];
    const chain: PipeChainNode = node;
    const target = chain.pipes[0];
    if (target?.type !== 'TypeConstructor') return [];
    if (!CONVERTING_CONSTRUCTORS.has(target.constructorName)) return [];

    const parts = sourceParts(chain.head);
    if (parts === null) return [];
    const mismatch = findMismatch(target, parts);
    if (mismatch === undefined) return [];

    const written = renderTarget(target);
    return [
      {
        code: 'PIPE_CONVERTS_INNER',
        message: `Piping into ${written} converts ${mismatch.from} values to ${mismatch.to}; write \`-> :${written}\` to check without converting.`,
        severity: 'info',
        location: target.span.start,
        context: extractContextLine(target.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(pipeConvertsInner);
