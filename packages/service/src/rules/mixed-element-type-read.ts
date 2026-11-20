/**
 * Flags reading `.^type` or `.^effective` from a collection whose elements
 * differ in type. Such a read reports a union element type, not one shared
 * type, which is rarely what the author meant.
 *
 * Detection is purely syntactic over literals: a list literal of distinct
 * compound shapes, or a dict literal of distinct value shapes iterated by
 * `seq`/`fan`/`filter`/`acc` or `.values`/`.entries`. Receivers reach the
 * read directly, through a pipe, or through a variable captured once from
 * such a literal (precomputed in the script facts). Anything that is not a
 * plain literal never fires.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { chainlessVariableName, extractContextLine } from './helpers.js';
import { collectProbeReads } from './probe-reads.js';
import type { ProbeRead, ProbeStage } from './probe-reads.js';
import { registeredRules } from './rules-registry.js';
import { isCollectionOpCall } from './collection-ops.js';
import {
  isMixedCompoundList,
  isMixedValueDict,
  unwrapBareLiteral,
} from './literal-shape.js';

// ============================================================
// CONSTANTS
// ============================================================

const READ_KEYS: ReadonlySet<string> = new Set(['type', 'effective']);
const DICT_ITERATION_OPS: ReadonlySet<string> = new Set([
  'seq',
  'fan',
  'filter',
  'acc',
]);
const DICT_ITERATION_METHODS: ReadonlySet<string> = new Set([
  'values',
  'entries',
]);

// ============================================================
// RECEIVER CLASSIFICATION
// ============================================================

type ReceiverKind = 'list' | 'dict' | null;

/** Whether `input` is a mixed compound list (kind `list`) or a mixed-value dict (kind `dict`). */
function sourceKind(
  input: ASTNode | string,
  context: RuleContext
): ReceiverKind {
  let name: string | null;
  if (typeof input === 'string') {
    name = input;
  } else {
    const node = unwrapBareLiteral(input);
    if (isMixedCompoundList(node)) return 'list';
    if (isMixedValueDict(node)) return 'dict';
    name = chainlessVariableName(node);
  }
  if (name === null) return null;
  const { mixedListVars, mixedDictVars } = context.facts.script;
  if (mixedListVars.has(name)) return 'list';
  if (mixedDictVars.has(name)) return 'dict';
  return null;
}

/** The kind of message owed when `receiver` is read, given the node feeding it. */
function directKind(
  input: ASTNode | string,
  context: RuleContext
): ReceiverKind {
  return sourceKind(input, context) === 'list' ? 'list' : null;
}

function isDictIterationStage(stage: ProbeStage): boolean {
  if (typeof stage === 'string') return DICT_ITERATION_METHODS.has(stage);
  if (stage.type === 'MethodCall')
    return DICT_ITERATION_METHODS.has(stage.name);
  return (
    isCollectionOpCall(stage) &&
    DICT_ITERATION_OPS.has(stage.name) &&
    stage.type === 'HostCall'
  );
}

// ============================================================
// DIAGNOSTICS
// ============================================================

function listMessage(key: string): string {
  return `The elements of this collection differ in type, so .^${key} reports a union element type, not one shared type. Use a type check such as :?list(list) when only the kind matters.`;
}

function dictMessage(key: string): string {
  return `The values of this dict differ in type, so iterating it yields a union element type, and .^${key} reports it. Use a type check such as :?list(dict) when only the kind matters.`;
}

function report(
  kind: 'list' | 'dict',
  key: string,
  at: ASTNode['span']['start'],
  context: RuleContext
): Diagnostic {
  return {
    location: at,
    severity: 'info',
    code: 'MIXED_ELEMENT_TYPE_READ',
    message: kind === 'list' ? listMessage(key) : dictMessage(key),
    context: extractContextLine(at.line, context.source),
    fix: null,
  };
}

// ============================================================
// READ SITES
// ============================================================

/** The kind of message owed for a read, or null when it is not a mixed read. */
function readKind(read: ProbeRead, context: RuleContext): ReceiverKind {
  const { receiver, stage } = read;
  if (stage === null) {
    return directKind(receiver, context);
  }
  if (!isDictIterationStage(stage)) return null;
  return sourceKind(receiver, context) === 'dict' ? 'dict' : null;
}

// ============================================================
// RULE
// ============================================================

export const mixedElementTypeRead: Rule = {
  code: 'MIXED_ELEMENT_TYPE_READ',
  nodeTypes: ['PipeChain', 'PostfixExpr', 'Variable'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    for (const read of collectProbeReads(node, READ_KEYS)) {
      const kind = readKind(read, context);
      if (kind !== null) {
        diagnostics.push(report(kind, read.key, read.at, context));
      }
    }
    return diagnostics;
  },
};

registeredRules.push(mixedElementTypeRead);
