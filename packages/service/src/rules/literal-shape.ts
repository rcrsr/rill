/**
 * Static shape of literal expressions, for rules that reason about the
 * element type a collection literal will infer. Pure helpers: no AST walk,
 * only direct unwrapping of the literal and its immediate children.
 *
 * A shape is a string naming the literal's kind and structure, `'EMPTY'`
 * for an empty collection literal, or `null` when the expression is not a
 * fully static literal (variables, calls, spreads, computed keys).
 */

import { createOrdered, createTuple } from '@rcrsr/rill';
import type {
  ASTNode,
  BlockNode,
  DeclarationNode,
  DictEntryNode,
  RillValue,
  TypeRef,
} from '@rcrsr/rill';
import { staticEntryKey } from './helpers.js';

// ============================================================
// CONSTANTS
// ============================================================

export type LiteralKind =
  | 'number'
  | 'string'
  | 'bool'
  | 'atom'
  | 'list'
  | 'tuple'
  | 'ordered'
  | 'dict';

const EMPTY_SHAPE = 'EMPTY';

const COMPOUND_PREFIXES: readonly string[] = [
  'list(',
  'dict{',
  'tuple(',
  'ordered{',
];

// ============================================================
// UNWRAPPING
// ============================================================

const COLLECTION_KINDS: ReadonlySet<string> = new Set([
  'list',
  'dict',
  'tuple',
  'ordered',
  'map',
  'stream',
]);

/**
 * The type a declaration states, or null for the unspecified form: a bare
 * collection kind (`list`, `list()`, `list(any)`) or `any`, which declare
 * nothing beyond the value itself.
 */
export function declarationTypeRef(node: DeclarationNode): TypeRef | null {
  const expr = node.typeExpr;
  // The parser does not yet produce a Declaration over an fn type; the
  // branch only satisfies the node's declared typeExpr union.
  if (expr.type === 'FnType') return expr.typeRef;
  if (expr.type === 'TypeNameExpr') {
    return expr.typeName === 'any' || COLLECTION_KINDS.has(expr.typeName)
      ? null
      : { kind: 'static', typeName: expr.typeName };
  }
  if (expr.constructorName === 'union') {
    return { kind: 'union', members: expr.args.map((arg) => arg.value) };
  }
  const [only] = expr.args;
  const bare =
    (expr.args.length === 0 && COLLECTION_KINDS.has(expr.constructorName)) ||
    (expr.args.length === 1 &&
      only?.name === undefined &&
      only?.defaultValue === undefined &&
      only?.value.kind === 'static' &&
      only.value.typeName === 'any' &&
      only.value.args === undefined);
  return bare
    ? null
    : { kind: 'static', typeName: expr.constructorName, args: expr.args };
}

/**
 * Unwrap a bare PipeChain (no pipes, no terminator) and a bare PostfixExpr
 * (no methods, default, or existence check) down to the primary node.
 * A Declaration of the unspecified form unwraps to its literal. Any other
 * node is returned unchanged.
 */
export function unwrapBareLiteral(node: ASTNode): ASTNode {
  let current = node;
  if (
    current.type === 'PipeChain' &&
    current.pipes.length === 0 &&
    current.terminator === null
  ) {
    current = current.head;
  }
  if (
    current.type === 'PostfixExpr' &&
    current.methods.length === 0 &&
    current.defaultValue === null &&
    !current.existenceCheck
  ) {
    current = current.primary;
  }
  return current.type === 'Declaration' && declarationTypeRef(current) === null
    ? current.value
    : current;
}

// ============================================================
// KINDS
// ============================================================

/** Rill kind name of a literal primary node, or null when it is not a literal. */
export function literalKind(node: ASTNode): LiteralKind | null {
  switch (node.type) {
    case 'NumberLiteral':
      return 'number';
    case 'StringLiteral':
      return 'string';
    case 'BoolLiteral':
      return 'bool';
    case 'AtomLiteral':
      return 'atom';
    case 'ListLiteral':
      return 'list';
    case 'TupleLiteral':
      return 'tuple';
    case 'OrderedLiteral':
      return 'ordered';
    case 'Dict':
    case 'DictLiteral':
      return 'dict';
    default:
      return null;
  }
}

// ============================================================
// SCALAR KINDS
// ============================================================

/** The scalar literal kinds a rule can judge statically. */
export const SCALAR_KINDS: ReadonlySet<string> = new Set([
  'number',
  'string',
  'bool',
  'atom',
]);

/** The scalar kind of a bare literal expression, or null for anything else. */
export function scalarLiteralKind(expr: ASTNode): string | null {
  const kind = literalKind(unwrapBareLiteral(expr));
  return kind !== null && SCALAR_KINDS.has(kind) ? kind : null;
}

// ============================================================
// SHAPES
// ============================================================

/** Key:shape pairs for a dict or ordered literal, or null when any is non-static. */
function entryShapes(entries: readonly DictEntryNode[]): string[] | null {
  const pairs: string[] = [];
  for (const entry of entries) {
    const key = staticEntryKey(entry);
    const value = literalShape(entry.value);
    if (key === null || value === null) return null;
    pairs.push(`${key}:${value}`);
  }
  return pairs;
}

function sequenceShapes(elements: readonly ASTNode[]): string[] | null {
  const shapes: string[] = [];
  for (const element of elements) {
    const shape = literalShape(element);
    if (shape === null) return null;
    shapes.push(shape);
  }
  return shapes;
}

/** Shape of a literal expression: a kind string, `'EMPTY'`, or null. */
export function literalShape(expr: ASTNode): string | null {
  const node = unwrapBareLiteral(expr);
  const kind = literalKind(node);
  if (
    kind === 'number' ||
    kind === 'string' ||
    kind === 'bool' ||
    kind === 'atom'
  ) {
    return kind;
  }
  switch (node.type) {
    case 'ListLiteral': {
      if (node.elements.length === 0) return EMPTY_SHAPE;
      const shapes = sequenceShapes(node.elements);
      if (shapes === null) return null;
      const distinct = [...new Set(shapes.filter((s) => s !== EMPTY_SHAPE))];
      return `list(${distinct.sort().join(',')})`;
    }
    case 'Dict':
    case 'DictLiteral': {
      if (node.entries.length === 0) return EMPTY_SHAPE;
      const pairs = entryShapes(node.entries);
      return pairs === null ? null : `dict{${pairs.sort().join(',')}}`;
    }
    case 'TupleLiteral': {
      if (node.elements.length === 0) return EMPTY_SHAPE;
      const shapes = sequenceShapes(node.elements);
      return shapes === null ? null : `tuple(${shapes.join(',')})`;
    }
    case 'OrderedLiteral': {
      if (node.entries.length === 0) return EMPTY_SHAPE;
      const pairs = entryShapes(node.entries);
      return pairs === null ? null : `ordered{${pairs.join(',')}}`;
    }
    default:
      return null;
  }
}

// ============================================================
// STATIC VALUES
// ============================================================

/** Dict method names the runtime refuses as dict keys. */
export const RESERVED_METHOD_KEYS: ReadonlySet<string> = new Set([
  'len',
  'first',
  'empty',
  'eq',
  'ne',
  'keys',
  'values',
  'entries',
]);

/** A key the runtime might refuse or store specially: brand-like, `__proto__`, or a method name. */
function isUnsafeKey(key: string): boolean {
  return key.startsWith('__') || RESERVED_METHOD_KEYS.has(key);
}

function staticSequence(elements: readonly ASTNode[]): RillValue[] | null {
  const values: RillValue[] = [];
  for (const element of elements) {
    const value = staticLiteralValue(element);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function staticEntries(
  entries: readonly DictEntryNode[]
): Array<[string, RillValue]> | null {
  const pairs: Array<[string, RillValue]> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = staticEntryKey(entry);
    if (key === null || isUnsafeKey(key) || seen.has(key)) return null;
    seen.add(key);
    const value = staticLiteralValue(entry.value);
    if (value === null) return null;
    pairs.push([key, value]);
  }
  return pairs;
}

/**
 * The runtime value of a fully static literal, or null when the expression
 * is anything else: an atom, an interpolated string, a spread, a computed or
 * reserved key, a block, closure, variable, call, or typed declaration.
 * Rules compare the result with the runtime's own structural type relations
 * instead of inferring types a second time.
 */
export function staticLiteralValue(expr: ASTNode): RillValue | null {
  const node = unwrapBareLiteral(expr);
  switch (node.type) {
    case 'NumberLiteral':
      return node.value;
    case 'BoolLiteral':
      return node.value;
    case 'StringLiteral':
      return node.parts.every((part) => typeof part === 'string')
        ? node.parts.join('')
        : null;
    case 'UnaryExpr': {
      if (node.op !== '-') return null;
      const operand = staticLiteralValue(node.operand);
      return typeof operand === 'number' ? -operand : null;
    }
    case 'ListLiteral': {
      if (node.defaultValue !== null) return null;
      return staticSequence(node.elements);
    }
    case 'TupleLiteral': {
      const values = staticSequence(node.elements);
      return values === null ? null : createTuple(values);
    }
    case 'Dict': {
      if (node.defaultValue !== null) return null;
      const pairs = staticEntries(node.entries);
      return pairs === null ? null : Object.fromEntries(pairs);
    }
    case 'DictLiteral': {
      const pairs = staticEntries(node.entries);
      return pairs === null ? null : Object.fromEntries(pairs);
    }
    case 'OrderedLiteral': {
      const pairs = staticEntries(node.entries);
      return pairs === null ? null : createOrdered(pairs);
    }
    default:
      return null;
  }
}

// ============================================================
// MIXED-TYPE PREDICATES
// ============================================================

function isCompoundShape(shape: string): boolean {
  return COMPOUND_PREFIXES.some((prefix) => shape.startsWith(prefix));
}

function hasTwoDistinct(shapes: readonly string[]): boolean {
  return shapes.length >= 2 && new Set(shapes).size >= 2;
}

/** A list literal whose elements are two or more distinct compound shapes. */
export function isMixedCompoundList(node: ASTNode): boolean {
  if (node.type !== 'ListLiteral') return false;
  const shapes: string[] = [];
  for (const element of node.elements) {
    if (element.type === 'ListSpread') return false;
    const shape = literalShape(element);
    if (shape !== null && shape !== EMPTY_SHAPE && isCompoundShape(shape)) {
      shapes.push(shape);
    }
  }
  return hasTwoDistinct(shapes);
}

/** A dict literal whose values are two or more distinct static shapes. */
export function isMixedValueDict(node: ASTNode): boolean {
  if (node.type !== 'Dict' && node.type !== 'DictLiteral') return false;
  const shapes: string[] = [];
  for (const entry of node.entries) {
    if (staticEntryKey(entry) === null) return false;
    const shape = literalShape(entry.value);
    if (shape !== null && shape !== EMPTY_SHAPE) shapes.push(shape);
  }
  return hasTwoDistinct(shapes);
}

// ============================================================
// NON-FUNCTION RESULTS
// ============================================================

/** Node types whose value is never a function, whatever their operands. */
const NON_FUNCTION_TYPES: ReadonlySet<string> = new Set([
  'BinaryExpr',
  'UnaryExpr',
  'Interpolation',
  'ListLiteral',
  'DictLiteral',
  'Dict',
  'TupleLiteral',
  'OrderedLiteral',
]);

/**
 * Whether a block's result is provably not a function: its last statement
 * is a bare scalar literal, arithmetic, logic, comparison, an interpolated
 * string, or a collection literal. A call, a variable, a member read, or
 * any piped chain may yield a function, so they are not provable.
 */
export function blockYieldsNonFunction(block: BlockNode): boolean {
  const last = block.statements.at(-1);
  if (last === undefined) return false;
  const statement = last.type === 'AnnotatedStatement' ? last.statement : last;
  const node = unwrapBareLiteral(statement.expression);
  return literalKind(node) !== null || NON_FUNCTION_TYPES.has(node.type);
}
