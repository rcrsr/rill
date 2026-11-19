/**
 * Flags treating an `.entries` element as a list. `.entries` returns a list
 * of tuples: a tuple has no list-only methods, does not convert to a dict,
 * and does not satisfy `list`, so each of these halts (or, for a `:?` probe,
 * is false) on a value whose origin is visible in the source.
 *
 * Sites reported, each once at the start of the offending node:
 * - the result of `.entries` (directly, through pass-through steps, or via a
 *   variable captured once from it) checked against `list(list)` or
 *   `list(list(T))` with `:T`, `expr:T`, `:?T`, or a typed capture
 * - a list-only method, field read, or `-> dict` on an element: bare `$` heading
 *   a statement of a body fed by `.entries`, the first parameter of such a closure, a
 *   method-shorthand body (`seq({ .head })`), or `$d.entries[n]` in one
 *   access chain
 *
 * The list-only set is every list method a tuple lacks, derived from the
 * built-in method tables, less the methods the runtime serves on a tuple.
 *
 * Silent by design: positional reads, destructuring, `seq`, `.len` on the
 * result, an element converted with `-> list`, a nested branch body, lists of
 * lists that do not come from `.entries`, and host data.
 */

import { BUILTIN_METHODS, formatTypeRef } from '@rcrsr/rill';
import type {
  ASTNode,
  PipeChainNode,
  PostfixExprNode,
  PropertyAccess,
  SourceLocation,
  TypeRef,
  VariableNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import {
  getCollectionOpBody,
  getMethodName,
  isMethodShorthand,
  resolveOpBody,
} from './collection-ops.js';
import { chainlessVariableName, extractContextLine } from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';
import { isEntriesRead, isPassThroughStep } from './static-type.js';

// ============================================================
// CONSTANTS
// ============================================================

/** List methods a tuple lacks. */
const LIST_ONLY_METHODS: ReadonlySet<string> = new Set(
  Object.keys(BUILTIN_METHODS.list).filter(
    (name) => !(name in BUILTIN_METHODS.tuple)
  )
);

type CheckSite = 'check' | 'capture' | 'probe';

// ============================================================
// SITE A: ENTRIES RESULT CHECKED AGAINST list(list)
// ============================================================

/** Whether `expr` is an `.entries` read or a variable captured once from one. */
function isEntriesValue(expr: ASTNode, context: RuleContext): boolean {
  const node = unwrapBareLiteral(expr);
  if (isEntriesRead(node)) return true;
  const name = chainlessVariableName(node);
  return name !== null && context.facts.script.entriesVars.has(name);
}

/**
 * The element type a `list(list)` or `list(list(T))` type names for the
 * inner list, as the tuple's value type: `T`, or `any` when the inner list
 * is bare. Null when the type is not a list of lists.
 */
function innerValueType(type: TypeRef): string | null {
  if (type.kind !== 'static' || type.typeName !== 'list') return null;
  const [outer] = type.args ?? [];
  if (type.args?.length !== 1 || outer === undefined) return null;
  const inner = outer.value;
  if (inner.kind !== 'static' || inner.typeName !== 'list') return null;
  const [only] = inner.args ?? [];
  return inner.args?.length === 1 &&
    only !== undefined &&
    only.name === undefined
    ? formatTypeRef(only.value)
    : 'any';
}

function checkMessage(
  type: TypeRef,
  valueType: string,
  site: CheckSite
): string {
  const typeText = formatTypeRef(type);
  const subject = 'This .entries result is a list of tuples';
  const advice = `check list(tuple(string, ${valueType})) instead`;
  if (site === 'probe') {
    return `${subject}, so :?${typeText} is false; ${advice}.`;
  }
  const halt = site === 'check' ? 'the check' : 'the capture';
  return `${subject}, so ${halt} against ${typeText} halts #TYPE_MISMATCH; ${advice}.`;
}

function reportCheck(
  at: SourceLocation,
  type: TypeRef,
  site: CheckSite,
  context: RuleContext
): Diagnostic[] {
  const valueType = innerValueType(type);
  if (valueType === null) return [];
  return [diagnostic(at, checkMessage(type, valueType, site), context)];
}

function validatePipeChainCheck(
  node: PipeChainNode,
  context: RuleContext
): Diagnostic[] {
  const out: Diagnostic[] = [];
  let known = isEntriesValue(node.head, context);
  const steps =
    node.terminator === null ? node.pipes : [...node.pipes, node.terminator];
  for (const step of steps) {
    const at = step.span.start;
    if (isEntriesRead(step)) {
      known = true;
    } else if (isPassThroughStep(step)) {
      if (!known) continue;
      if (step.type === 'TypeAssertion') {
        out.push(...reportCheck(at, step.typeRef, 'check', context));
      } else if (step.type === 'Capture' && step.typeRef !== null) {
        out.push(...reportCheck(at, step.typeRef, 'capture', context));
      }
    } else {
      if (known && step.type === 'TypeCheck' && step.operand === null) {
        out.push(...reportCheck(at, step.typeRef, 'probe', context));
      }
      known = false;
    }
  }
  return out;
}

// ============================================================
// SITE B: ENTRIES ELEMENT USED AS A LIST
// ============================================================

/**
 * The bare `$` variables heading a statement of an `.entries`-fed body. Only
 * a statement's head still holds the pair: a `$` in a later pipe step,
 * step argument, or conditional branch is that step's own input.
 */
const pairHeads = new WeakMap<ASTNode, ReadonlySet<ASTNode>>();

function pairHeadsOf(body: ASTNode): ReadonlySet<ASTNode> {
  const cached = pairHeads.get(body);
  if (cached !== undefined) return cached;
  const heads = new Set<ASTNode>();
  if (body.type === 'Block') {
    for (const entry of body.statements) {
      const statement = entry.type === 'Statement' ? entry : entry.statement;
      const head = statement.expression.head;
      if (head.type === 'PostfixExpr') heads.add(head.primary);
    }
  }
  pairHeads.set(body, heads);
  return heads;
}

/** Whether a bare `$` or `$name` variable stands for an `.entries` element here. */
function isElementVariable(node: VariableNode, context: RuleContext): boolean {
  const { entriesBodies } = context.facts.script;
  if (node.name === null) {
    if (!node.isPipeVar) return false;
    const scope = context.scopeStack.at(-1);
    return (
      scope !== undefined &&
      entriesBodies.has(scope) &&
      pairHeadsOf(scope).has(node)
    );
  }
  for (const scope of [...context.scopeStack].reverse()) {
    if (scope.type !== 'Closure') continue;
    const [first] = scope.params;
    if (scope.params.some((param) => param.name === node.name)) {
      return entriesBodies.has(scope) && first?.name === node.name;
    }
  }
  return false;
}

/** The field name of a `.field` access segment, or null for any other segment. */
function literalField(access: PropertyAccess | undefined): string | null {
  return access !== undefined && 'kind' in access && access.kind === 'literal'
    ? access.field
    : null;
}

/** Whether a segment is a `[expr]` index. */
function isIndex(access: PropertyAccess | undefined): boolean {
  return access !== undefined && 'accessKind' in access;
}

/** Whether the chain ends at an `.entries` field read followed by an index. */
function endsWithEntriesIndex(node: VariableNode): boolean {
  const [read, index] = node.accessChain.slice(-2);
  return literalField(read) === 'entries' && isIndex(index);
}

/** Whether `node` is an `.entries` element: `$`, `$name`, or `$d.entries[n]`. */
function isElement(node: ASTNode, context: RuleContext): boolean {
  if (node.type !== 'Variable') return false;
  if (node.defaultValue !== null || node.existenceCheck !== null) return false;
  if (node.accessChain.length === 0) return isElementVariable(node, context);
  return endsWithEntriesIndex(node);
}

const ELEMENT_ADVICE = 'use $pair -> list, or $pair[0] and $pair[1]';

function listOnlyMessage(name: string): string {
  return `This .entries element is a tuple, and .${name} is a list-only method, so it halts; ${ELEMENT_ADVICE}.`;
}

const DICT_MESSAGE =
  'This .entries element is a tuple, and -> dict cannot convert it, so it halts; use $pair[0] and $pair[1].';

function validateVariable(node: ASTNode, context: RuleContext): Diagnostic[] {
  if (node.type !== 'Variable' || node.defaultValue !== null) return [];
  const chain = node.accessChain;
  const first = literalField(chain[0]);
  if (
    first !== null &&
    LIST_ONLY_METHODS.has(first) &&
    node.existenceCheck === null &&
    isElementVariable(node, context)
  ) {
    return [diagnostic(node.span.start, listOnlyMessage(first), context)];
  }
  for (let i = 0; i + 2 < chain.length; i++) {
    const field = literalField(chain[i + 2]);
    if (
      literalField(chain[i]) === 'entries' &&
      isIndex(chain[i + 1]) &&
      field !== null &&
      LIST_ONLY_METHODS.has(field)
    ) {
      return [diagnostic(node.span.start, listOnlyMessage(field), context)];
    }
  }
  return [];
}

function validatePostfix(
  node: PostfixExprNode,
  context: RuleContext
): Diagnostic[] {
  const method = node.methods[0];
  if (method?.type !== 'MethodCall' || !LIST_ONLY_METHODS.has(method.name)) {
    return [];
  }
  return isElement(node.primary, context)
    ? [diagnostic(node.span.start, listOnlyMessage(method.name), context)]
    : [];
}

function validatePipeChainElement(
  node: PipeChainNode,
  context: RuleContext
): Diagnostic[] {
  const first = node.pipes[0];
  if (first === undefined) return [];
  const head = unwrapBareLiteral(node.head);
  if (!isElement(head, context)) return [];
  if (first.type === 'MethodCall' && LIST_ONLY_METHODS.has(first.name)) {
    return [diagnostic(first.span.start, listOnlyMessage(first.name), context)];
  }
  if (first.type === 'TypeNameExpr' && first.typeName === 'dict') {
    return [diagnostic(first.span.start, DICT_MESSAGE, context)];
  }
  return [];
}

/** A method-shorthand body such as `seq({ .head })` fed by `.entries`. */
function validateHostCall(node: ASTNode, context: RuleContext): Diagnostic[] {
  if (node.type !== 'HostCall') return [];
  const body = getCollectionOpBody(node);
  if (body === null || !context.facts.script.entriesBodies.has(body)) return [];
  const resolved = resolveOpBody(node);
  if (resolved === null || !isMethodShorthand(resolved)) return [];
  const name = getMethodName(resolved);
  return name !== null && LIST_ONLY_METHODS.has(name)
    ? [diagnostic(node.span.start, listOnlyMessage(name), context)]
    : [];
}

// ============================================================
// RULE
// ============================================================

function diagnostic(
  at: SourceLocation,
  message: string,
  context: RuleContext
): Diagnostic {
  return {
    location: at,
    severity: 'warning',
    code: 'ENTRIES_PAIR_AS_LIST',
    message,
    context: extractContextLine(at.line, context.source),
    fix: null,
  };
}

export const entriesPairAsList: Rule = {
  code: 'ENTRIES_PAIR_AS_LIST',
  nodeTypes: [
    'PipeChain',
    'TypeAssertion',
    'TypeCheck',
    'PostfixExpr',
    'Variable',
    'HostCall',
  ],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    switch (node.type) {
      case 'PipeChain':
        return [
          ...validatePipeChainCheck(node, context),
          ...validatePipeChainElement(node, context),
        ];
      case 'TypeAssertion':
      case 'TypeCheck': {
        if (node.operand === null || !isEntriesValue(node.operand, context)) {
          return [];
        }
        return reportCheck(
          node.span.start,
          node.typeRef,
          node.type === 'TypeCheck' ? 'probe' : 'check',
          context
        );
      }
      case 'PostfixExpr':
        return validatePostfix(node, context);
      case 'Variable':
        return validateVariable(node, context);
      case 'HostCall':
        return validateHostCall(node, context);
      default:
        return [];
    }
  },
};

registeredRules.push(entriesPairAsList);
