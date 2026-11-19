/**
 * Flags a dict or ordered literal checked against a type that does not name
 * one of its keys. Dict matching rejects any own key the type leaves out, and
 * ordered matching is positional, so the check halts (or a `:?` probe is
 * false) on a value whose keys are visible in the source.
 *
 * Sites reported, each once at the start of the checking node:
 * - postfix `expr:T` and `expr:?T`
 * - pipe form: a bare `:T` / `:?T`, a typed capture, or an inline closure
 *   target whose first parameter is typed. The value is known at the head and
 *   after pass-through steps (a bare assertion or a capture); any other step
 *   makes it unknown.
 * - a typed closure parameter whose dict default carries an unnamed key
 *
 * Silent by design: union members, `list(...)` elements, tuple positions,
 * typed `destruct<>` elements, closure return types, stream chunk and return
 * types, arguments to a named closure call, host data, and `.?field&T`.
 */

import type {
  ASTNode,
  DictEntryNode,
  DictLiteralNode,
  DictNode,
  OrderedLiteralNode,
  SourceLocation,
  TypeRef,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { formatFieldKey } from '@rcrsr/rill';
import { typeRefToString } from '../type-rendering.js';
import {
  chainlessVariableName,
  extractContextLine,
  staticEntryKey,
} from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { isPassThroughStep } from './static-type.js';
import { registeredRules } from './rules-registry.js';

type KnownSource = DictNode | DictLiteralNode | OrderedLiteralNode;

type Site = 'check' | 'capture' | 'parameter' | 'default' | 'probe';

/** The literal a value is known to come from, or null when it is unknown. */
function knownDictSource(
  expr: ASTNode,
  context: RuleContext
): KnownSource | null {
  const node = unwrapBareLiteral(expr);
  if (
    node.type === 'Dict' ||
    node.type === 'DictLiteral' ||
    node.type === 'OrderedLiteral'
  ) {
    return node;
  }
  const name = chainlessVariableName(node);
  return name === null
    ? null
    : (context.facts.script.dictLiteralVars.get(name) ?? null);
}

/** Static string keys of a literal's entries, or null when any key is dynamic. */
function staticEntries(
  source: KnownSource
): Array<readonly [string, DictEntryNode]> | null {
  if (source.type === 'Dict' && source.defaultValue !== null) return null;
  const out: Array<readonly [string, DictEntryNode]> = [];
  for (const entry of source.entries) {
    const key = staticEntryKey(entry);
    if (key === null) return null;
    out.push([key, entry]);
  }
  return out;
}

/**
 * Paths of keys present in the source but not named by the type. Empty when
 * the type does not name every key, is not static, or does not match the
 * source's kind.
 */
function extraKeyPaths(type: TypeRef, source: KnownSource): string[] {
  if (type.kind !== 'static' || type.args === undefined) return [];
  const isDict = type.typeName === 'dict';
  if (!isDict && type.typeName !== 'ordered') return [];
  if (isDict !== (source.type !== 'OrderedLiteral')) return [];
  if (type.args.length === 0) return [];
  const named = new Map<string, TypeRef>();
  for (const arg of type.args) {
    if (arg.name === undefined) return [];
    named.set(arg.name, arg.value);
  }
  const entries = staticEntries(source);
  if (entries === null) return [];

  const paths: string[] = [];
  for (const [key, entry] of entries) {
    const fieldType = named.get(key);
    if (fieldType === undefined) {
      paths.push(formatFieldKey(key));
      continue;
    }
    const nested = unwrapBareLiteral(entry.value);
    if (
      nested.type === 'Dict' ||
      nested.type === 'DictLiteral' ||
      nested.type === 'OrderedLiteral'
    ) {
      for (const sub of extraKeyPaths(fieldType, nested)) {
        paths.push(`${formatFieldKey(key)}.${sub}`);
      }
    }
  }
  return paths;
}

function messageFor(
  kind: 'dict' | 'ordered',
  keys: readonly string[],
  type: TypeRef,
  site: Site
): string {
  const typeText = typeRefToString(type);
  const keyList = keys.join(', ');
  const subject = `This ${kind} has key ${keyList} that ${typeText} does not name`;
  if (site === 'probe') return `${subject}, so :?${typeText} is false.`;
  const halt =
    site === 'check'
      ? 'the check halts #TYPE_MISMATCH'
      : site === 'capture'
        ? 'the capture halts #TYPE_MISMATCH'
        : site === 'parameter'
          ? 'the parameter halts RILL-R001'
          : 'the parameter halts RILL-R001 when the argument is omitted';
  const advice =
    kind === 'dict'
      ? `; name the key in the type, or convert first with -> ${typeText}`
      : '; name the key in the type';
  return `${subject}, so ${halt}${advice}.`;
}

function report(
  at: SourceLocation,
  source: KnownSource,
  type: TypeRef,
  site: Site,
  context: RuleContext
): Diagnostic[] {
  const keys = extraKeyPaths(type, source);
  if (keys.length === 0) return [];
  const kind = source.type === 'OrderedLiteral' ? 'ordered' : 'dict';
  return [
    {
      location: at,
      severity: 'warning',
      code: 'TYPE_EXTRA_KEY',
      message: messageFor(kind, keys, type, site),
      context: extractContextLine(at.line, context.source),
      fix: null,
    },
  ];
}

function validatePipeChain(
  node: Extract<ASTNode, { type: 'PipeChain' }>,
  context: RuleContext
): Diagnostic[] {
  const out: Diagnostic[] = [];
  let source = knownDictSource(node.head, context);
  const steps =
    node.terminator === null ? node.pipes : [...node.pipes, node.terminator];
  for (const step of steps) {
    if (source === null) break;
    const at = step.span.start;
    if (isPassThroughStep(step)) {
      if (step.type === 'TypeAssertion') {
        out.push(...report(at, source, step.typeRef, 'check', context));
      } else if (step.type === 'Capture' && step.typeRef !== null) {
        out.push(...report(at, source, step.typeRef, 'capture', context));
      }
      continue;
    }
    switch (step.type) {
      case 'TypeCheck':
        if (step.operand !== null) {
          source = null;
          break;
        }
        out.push(...report(at, source, step.typeRef, 'probe', context));
        source = null;
        break;
      case 'Closure': {
        const [first] = step.params;
        if (first?.typeRef !== null && first?.typeRef !== undefined) {
          out.push(...report(at, source, first.typeRef, 'parameter', context));
        }
        source = null;
        break;
      }
      default:
        source = null;
    }
  }
  return out;
}

export const typeExtraKey: Rule = {
  code: 'TYPE_EXTRA_KEY',
  nodeTypes: ['PipeChain', 'TypeAssertion', 'TypeCheck', 'ClosureParam'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    switch (node.type) {
      case 'PipeChain':
        return validatePipeChain(node, context);
      case 'TypeAssertion':
      case 'TypeCheck': {
        if (node.operand === null) return [];
        const source = knownDictSource(node.operand, context);
        if (source === null) return [];
        return report(
          node.span.start,
          source,
          node.typeRef,
          node.type === 'TypeCheck' ? 'probe' : 'check',
          context
        );
      }
      case 'ClosureParam': {
        if (node.typeRef === null || node.defaultValue === null) return [];
        const source = knownDictSource(node.defaultValue, context);
        if (source === null) return [];
        return report(
          node.span.start,
          source,
          node.typeRef,
          'default',
          context
        );
      }
      default:
        return [];
    }
  },
};

registeredRules.push(typeExtraKey);
