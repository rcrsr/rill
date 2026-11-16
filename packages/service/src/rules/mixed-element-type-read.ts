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

import type { ASTNode, PostfixExprNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
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

function chainlessVariableName(node: ASTNode): string | null {
  if (
    node.type === 'Variable' &&
    node.name !== null &&
    !node.isPipeVar &&
    node.accessChain.length === 0 &&
    node.defaultValue === null &&
    node.existenceCheck === null
  ) {
    return node.name;
  }
  return null;
}

/** Whether `input` is a mixed compound list (kind `list`) or a mixed-value dict (kind `dict`). */
function sourceKind(input: ASTNode, context: RuleContext): ReceiverKind {
  const node = unwrapBareLiteral(input);
  if (isMixedCompoundList(node)) return 'list';
  if (isMixedValueDict(node)) return 'dict';
  const name = chainlessVariableName(node);
  if (name === null) return null;
  const { mixedListVars, mixedDictVars } = context.facts.script;
  if (mixedListVars.has(name)) return 'list';
  if (mixedDictVars.has(name)) return 'dict';
  return null;
}

/** The kind of message owed when `receiver` is read, given the node feeding it. */
function directKind(input: ASTNode, context: RuleContext): ReceiverKind {
  return sourceKind(input, context) === 'list' ? 'list' : null;
}

function isDictIterationStage(node: ASTNode): boolean {
  if (node.type === 'MethodCall') return DICT_ITERATION_METHODS.has(node.name);
  return (
    isCollectionOpCall(node) &&
    DICT_ITERATION_OPS.has(node.name) &&
    node.type === 'HostCall'
  );
}

/** Kind for a read on the result of `stage` applied to `input`. */
function stageResultKind(
  stage: ASTNode,
  input: ASTNode,
  context: RuleContext
): ReceiverKind {
  if (!isDictIterationStage(stage)) return null;
  return sourceKind(input, context) === 'dict' ? 'dict' : null;
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

/** Index of the first read-key AnnotationAccess in `methods`, or -1. */
function readIndex(methods: PostfixExprNode['methods']): number {
  return methods.findIndex(
    (m) => m.type === 'AnnotationAccess' && READ_KEYS.has(m.key)
  );
}

/**
 * Classify a read at position `k` of a method list applied to `input`:
 * k=0 reads the input itself; k=1 reads the result of a preceding
 * `.values`/`.entries`.
 */
function methodsReadKind(
  methods: PostfixExprNode['methods'],
  k: number,
  input: ASTNode,
  context: RuleContext
): ReceiverKind {
  if (k === 0) return directKind(input, context);
  const [first] = methods;
  if (k === 1 && first?.type === 'MethodCall' && isDictIterationStage(first)) {
    return sourceKind(input, context) === 'dict' ? 'dict' : null;
  }
  return null;
}

function validatePostfix(
  node: PostfixExprNode,
  context: RuleContext
): Diagnostic[] {
  if (node.primary.type === 'Variable' && node.primary.isPipeVar) return [];
  const k = readIndex(node.methods);
  const read = node.methods[k];
  if (read?.type !== 'AnnotationAccess') return [];
  const kind = methodsReadKind(node.methods, k, node.primary, context);
  return kind === null
    ? []
    : [report(kind, read.key, read.span.start, context)];
}

function validateVariable(node: ASTNode, context: RuleContext): Diagnostic[] {
  if (node.type !== 'Variable' || node.name === null || node.isPipeVar) {
    return [];
  }
  const k = node.accessChain.findIndex(
    (a) => 'kind' in a && a.kind === 'annotation' && READ_KEYS.has(a.key)
  );
  const read = node.accessChain[k];
  if (read === undefined || !('kind' in read) || read.kind !== 'annotation') {
    return [];
  }
  const { mixedListVars, mixedDictVars } = context.facts.script;
  let kind: ReceiverKind = null;
  if (k === 0) {
    kind = mixedListVars.has(node.name) ? 'list' : null;
  } else if (k === 1) {
    const first = node.accessChain[0];
    if (
      first !== undefined &&
      'kind' in first &&
      first.kind === 'literal' &&
      DICT_ITERATION_METHODS.has(first.field) &&
      mixedDictVars.has(node.name)
    ) {
      kind = 'dict';
    }
  }
  return kind === null
    ? []
    : [report(kind, read.key, node.span.start, context)];
}

function validatePipeChain(node: ASTNode, context: RuleContext): Diagnostic[] {
  if (node.type !== 'PipeChain') return [];
  const diagnostics: Diagnostic[] = [];
  let previous: ASTNode = node.head;
  let beforePrevious: ASTNode = node.head;
  node.pipes.forEach((pipe, i) => {
    const input = previous;
    if (pipe.type === 'AnnotationAccess' && READ_KEYS.has(pipe.key)) {
      const kind =
        i === 0
          ? directKind(input, context)
          : stageResultKind(input, beforePrevious, context);
      if (kind !== null) {
        diagnostics.push(report(kind, pipe.key, pipe.span.start, context));
      }
    } else if (
      pipe.type === 'PostfixExpr' &&
      pipe.primary.type === 'Variable' &&
      pipe.primary.isPipeVar
    ) {
      const k = readIndex(pipe.methods);
      const read = pipe.methods[k];
      if (read?.type === 'AnnotationAccess') {
        let kind: ReceiverKind = null;
        if (k === 0) {
          kind =
            i === 0
              ? directKind(input, context)
              : stageResultKind(input, beforePrevious, context);
        } else if (k === 1) {
          kind = methodsReadKind(pipe.methods, k, input, context);
        }
        if (kind !== null) {
          diagnostics.push(report(kind, read.key, read.span.start, context));
        }
      }
    }
    beforePrevious = previous;
    previous = pipe;
  });
  return diagnostics;
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
    switch (node.type) {
      case 'PostfixExpr':
        return validatePostfix(node, context);
      case 'Variable':
        return validateVariable(node, context);
      case 'PipeChain':
        return validatePipeChain(node, context);
      default:
        return [];
    }
  },
};

registeredRules.push(mixedElementTypeRead);
