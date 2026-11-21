/**
 * Flags a map literal checked against a closed key type that names a key the
 * literal leaves out. Map membership accepts the missing key, but the map has
 * no entry for it, so reading that key halts RILL-R009. Hint only.
 *
 * Sites reported, each once at the start of the checking node:
 * - a declaration, `map(union(#a, #b), V)[...]`
 * - postfix `expr:T`
 * - pipe form: a bare `:T`, or a typed capture, applied to a map literal or a
 *   variable captured once from one, directly or after pass-through steps
 *
 * A key type is closed when it is a union whose members are all literals
 * (atoms, strings, numbers, or bools). Silent by design: open key types such
 * as `map(atom, V)`, literals with a computed key or a `??` default, and
 * values the checker cannot see.
 */

import { formatTypeRef } from '@rcrsr/rill';
import type {
  ASTNode,
  MapLiteralNode,
  SourceLocation,
  TypeRef,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { chainlessVariableName, extractContextLine } from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { flattenMembers, isPassThroughStep } from './static-type.js';
import { registeredRules } from './rules-registry.js';

/** Source spelling of a literal key, or null when it is not a static scalar literal. */
function literalKeyText(node: ASTNode): string | null {
  switch (node.type) {
    case 'AtomLiteral':
      return `#${node.name}`;
    case 'NumberLiteral':
      return String(node.value);
    case 'BoolLiteral':
      return String(node.value);
    case 'StringLiteral':
      return node.parts.every((part) => typeof part === 'string')
        ? JSON.stringify(node.parts.join(''))
        : null;
    default:
      return null;
  }
}

/** Members of a closed key union as key text, or null when the key type is open. */
function closedKeyMembers(type: TypeRef): string[] | null {
  if (type.kind !== 'static' || type.typeName !== 'map') return null;
  const [key] = type.args ?? [];
  if (key === undefined || key.value.kind !== 'union') return null;
  const out: string[] = [];
  for (const member of flattenMembers(key.value)) {
    if (member.kind !== 'literal') return null;
    const text = literalKeyText(member.value);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

/** Key text of one map key expression, or null when it is not a static literal. */
function entryKeyTexts(key: ASTNode): string[] | null {
  const node = unwrapBareLiteral(key);
  if (node.type === 'ListLiteral') {
    const out: string[] = [];
    for (const element of node.elements) {
      const text = literalKeyText(unwrapBareLiteral(element));
      if (text === null) return null;
      out.push(text);
    }
    return out;
  }
  const text = literalKeyText(node);
  return text === null ? null : [text];
}

/** Key text of every entry, or null when any key is computed or a default exists. */
function mapLiteralKeys(map: MapLiteralNode): Set<string> | null {
  if (map.defaultValue !== null) return null;
  const keys = new Set<string>();
  for (const entry of map.entries) {
    const texts = entryKeyTexts(entry.key);
    if (texts === null) return null;
    for (const text of texts) keys.add(text);
  }
  return keys;
}

function knownMap(expr: ASTNode, context: RuleContext): MapLiteralNode | null {
  const node = unwrapBareLiteral(expr);
  if (node.type === 'MapLiteral') return node;
  const name = chainlessVariableName(node);
  return name === null
    ? null
    : (context.facts.script.mapLiteralVars.get(name) ?? null);
}

function report(
  at: SourceLocation,
  map: MapLiteralNode,
  type: TypeRef,
  context: RuleContext
): Diagnostic[] {
  const members = closedKeyMembers(type);
  const present = mapLiteralKeys(map);
  if (members === null || present === null) return [];
  const missing = members.filter((member) => !present.has(member));
  if (missing.length === 0) return [];
  return [
    {
      location: at,
      severity: 'info',
      code: 'MAP_MISSING_KEY',
      message: `This map has no entry for ${missing.join(', ')} from its key type ${formatTypeRef(type)}; reading a missing key halts RILL-R009. Add the entry, or read with ?? or .?[key].`,
      context: extractContextLine(at.line, context.source),
      fix: null,
    },
  ];
}

function validatePipeChain(
  node: Extract<ASTNode, { type: 'PipeChain' }>,
  context: RuleContext
): Diagnostic[] {
  const map = knownMap(node.head, context);
  if (map === null) return [];
  const out: Diagnostic[] = [];
  const steps =
    node.terminator === null ? node.pipes : [...node.pipes, node.terminator];
  for (const step of steps) {
    if (!isPassThroughStep(step)) break;
    if (step.type === 'TypeAssertion') {
      out.push(...report(step.span.start, map, step.typeRef, context));
    } else if (step.type === 'Capture' && step.typeRef !== null) {
      out.push(...report(step.span.start, map, step.typeRef, context));
    }
  }
  return out;
}

export const mapMissingKey: Rule = {
  code: 'MAP_MISSING_KEY',
  nodeTypes: ['PipeChain', 'TypeAssertion', 'Declaration'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    switch (node.type) {
      case 'PipeChain':
        return validatePipeChain(node, context);
      case 'TypeAssertion': {
        if (node.operand === null) return [];
        const map = knownMap(node.operand, context);
        return map === null
          ? []
          : report(node.span.start, map, node.typeRef, context);
      }
      case 'Declaration': {
        if (node.value.type !== 'MapLiteral') return [];
        const expr = node.typeExpr;
        if (expr.type !== 'TypeConstructor' || expr.constructorName !== 'map') {
          return [];
        }
        const type: TypeRef = {
          kind: 'static',
          typeName: 'map',
          args: expr.args,
        };
        return report(node.span.start, node.value, type, context);
      }
      default:
        return [];
    }
  },
};

registeredRules.push(mapMissingKey);
