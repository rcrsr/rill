/**
 * Flags dict dispatch tables piped a value that is certain to fail.
 *
 * A dispatch target is a `-> dict[...]` literal, or a `-> $table` variable
 * bound once to a dict literal or typed `dict`. Ordered, list, and tuple
 * targets are not dict dispatch and stay silent. The selector is the value
 * entering the step, typed by `static-type.ts`; an unknown selector stays
 * silent.
 *
 * - DISPATCH_SELECTOR_NOT_STRING: the selector is only numbers, bools, or
 *   atoms, so the dispatch halts before any lookup, even when the table
 *   carries a `??` default. Convert first with `-> string`.
 * - DISPATCH_MISSING_MEMBER: the selector is a union of string literals and
 *   the table has no key for some member, so that member halts. Silent when
 *   the table has a default, or when any key is dynamic, spread, or computed.
 */

import { formatFieldKey, structureOverlaps } from '@rcrsr/rill';
import type {
  ASTNode,
  DictEntryNode,
  PipeChainNode,
  TypeRef,
  TypeStructure,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine, staticEntryKey } from './helpers.js';
import { scalarLiteralKind, unwrapBareLiteral } from './literal-shape.js';
import {
  flattenMembers,
  plainStringValue,
  staticTypeOf,
  typeAfterStep,
} from './static-type.js';
import { typeRefToString } from '../type-rendering.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// DISPATCH TARGETS
// ============================================================

/** A dict dispatch target: its entries when known, and whether it has a default. */
interface DispatchTarget {
  readonly entries: readonly DictEntryNode[] | null;
  readonly hasDefault: boolean;
}

/** The dict dispatch table a pipe step names, or null when it is not one. */
function dispatchTarget(
  step: ASTNode,
  context: RuleContext
): DispatchTarget | null {
  if (step.type === 'Dict') {
    return { entries: step.entries, hasDefault: step.defaultValue !== null };
  }
  if (
    step.type !== 'Variable' ||
    step.name === null ||
    step.isPipeVar ||
    step.accessChain.length > 0
  ) {
    return null;
  }
  const hasDefault = step.defaultValue !== null;
  const literal = context.facts.script.dictLiteralVars.get(step.name);
  if (literal !== undefined && literal.type !== 'OrderedLiteral') {
    return { entries: literal.entries, hasDefault };
  }
  const declared = context.facts.script.declaredTypes.get(step.name);
  if (declared?.kind === 'static' && declared.typeName === 'dict') {
    return { entries: null, hasDefault };
  }
  return null;
}

// ============================================================
// SELECTOR TYPES
// ============================================================

/**
 * The structure of a selector made only of numbers, bools, and atoms, or
 * null when any member is something else.
 */
function nonStringStructure(type: TypeRef): TypeStructure | null {
  switch (type.kind) {
    case 'static':
      return type.typeName === 'number' ||
        type.typeName === 'bool' ||
        type.typeName === 'atom'
        ? { kind: type.typeName }
        : null;
    case 'literal': {
      const kind = scalarLiteralKind(type.value);
      return kind === 'number' || kind === 'bool' || kind === 'atom'
        ? { kind }
        : null;
    }
    case 'union': {
      const members: TypeStructure[] = [];
      for (const member of type.members) {
        const structure = nonStringStructure(member);
        if (structure === null) return null;
        members.push(structure);
      }
      return { kind: 'union', members };
    }
    default:
      return null;
  }
}

/** The member names of a union of plain string literals, or null for any other type. */
function stringMembers(type: TypeRef): string[] | null {
  if (type.kind !== 'union') return null;
  const names: string[] = [];
  for (const member of flattenMembers(type)) {
    const name =
      member.kind === 'literal' ? plainStringValue(member.value) : null;
    if (name === null) return null;
    names.push(name);
  }
  return names;
}

// ============================================================
// TABLE KEYS
// ============================================================

/** Every key the entries name, or null when any key is not a static string. */
function tableKeys(entries: readonly DictEntryNode[]): Set<string> | null {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = staticEntryKey(entry);
    if (key !== null) {
      keys.add(key);
      continue;
    }
    if (typeof entry.key === 'string' || !('elements' in entry.key)) {
      return null;
    }
    for (const element of entry.key.elements) {
      const name = plainStringValue(unwrapBareLiteral(element));
      if (name === null) return null;
      keys.add(name);
    }
  }
  return keys;
}

// ============================================================
// CHAIN WALK
// ============================================================

/** Each dispatch step of a chain with the selector type entering it. */
function dispatchSites(
  node: PipeChainNode,
  context: RuleContext
): Array<{
  readonly step: ASTNode;
  readonly target: DispatchTarget;
  readonly selector: TypeRef;
}> {
  const sites: Array<{
    step: ASTNode;
    target: DispatchTarget;
    selector: TypeRef;
  }> = [];
  let selector = staticTypeOf(node.head, context);
  for (const step of node.pipes) {
    if (selector === null) break;
    const target = dispatchTarget(step, context);
    if (target !== null) sites.push({ step, target, selector });
    selector = typeAfterStep(selector, step, context);
  }
  return sites;
}

function diagnostic(
  code: string,
  message: string,
  step: ASTNode,
  context: RuleContext
): Diagnostic {
  return {
    code,
    message,
    severity: 'warning',
    location: step.span.start,
    context: extractContextLine(step.span.start.line, context.source),
    fix: null,
  };
}

// ============================================================
// RULES
// ============================================================

export const dispatchSelectorNotString: Rule = {
  code: 'DISPATCH_SELECTOR_NOT_STRING',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'PipeChain') return [];
    const out: Diagnostic[] = [];
    for (const { step, selector } of dispatchSites(node, context)) {
      const structure = nonStringStructure(selector);
      if (structure === null) continue;
      if (structureOverlaps(structure, { kind: 'string' })) continue;
      out.push(
        diagnostic(
          'DISPATCH_SELECTOR_NOT_STRING',
          `A dispatch table takes a string selector, but this value is ${typeRefToString(selector)}; the dispatch halts #TYPE_MISMATCH before any lookup, even with a ?? default. Convert first with -> string.`,
          step,
          context
        )
      );
    }
    return out;
  },
};

export const dispatchMissingMember: Rule = {
  code: 'DISPATCH_MISSING_MEMBER',
  nodeTypes: ['PipeChain'],
  defaultSeverity: 'warning',
  category: 'conditionals',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'PipeChain') return [];
    const out: Diagnostic[] = [];
    for (const { step, target, selector } of dispatchSites(node, context)) {
      if (target.hasDefault || target.entries === null) continue;
      const members = stringMembers(selector);
      if (members === null) continue;
      const keys = tableKeys(target.entries);
      if (keys === null) continue;
      const missing = [...new Set(members)].filter(
        (member) => !keys.has(member)
      );
      if (missing.length === 0) continue;
      out.push(
        diagnostic(
          'DISPATCH_MISSING_MEMBER',
          `This dispatch table has no key for ${missing.map(formatFieldKey).join(', ')}, so that selector halts RILL-R009; add the key or a ?? default.`,
          step,
          context
        )
      );
    }
    return out;
  },
};

registeredRules.push(dispatchSelectorNotString, dispatchMissingMember);
