/**
 * Static shape of literal expressions, for rules that reason about the
 * element type a collection literal will infer. Pure helpers: no AST walk,
 * only direct unwrapping of the literal and its immediate children.
 *
 * A shape is a string naming the literal's kind and structure, `'EMPTY'`
 * for an empty collection literal, or `null` when the expression is not a
 * fully static literal (variables, calls, spreads, computed keys).
 */

import type { ASTNode, DictEntryNode } from '@rcrsr/rill';

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

/**
 * Unwrap a bare PipeChain (no pipes, no terminator) and a bare PostfixExpr
 * (no methods, default, or existence check) down to the primary node.
 * Any other node is returned unchanged.
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
    return current.primary;
  }
  return current;
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
// SHAPES
// ============================================================

function staticKey(entry: DictEntryNode): string | null {
  const { key } = entry;
  if (typeof key === 'string') return key === '...' ? null : key;
  return null;
}

/** Key:shape pairs for a dict or ordered literal, or null when any is non-static. */
function entryShapes(entries: readonly DictEntryNode[]): string[] | null {
  const pairs: string[] = [];
  for (const entry of entries) {
    const key = staticKey(entry);
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
    if (staticKey(entry) === null) return false;
    const shape = literalShape(entry.value);
    if (shape !== null && shape !== EMPTY_SHAPE) shapes.push(shape);
  }
  return hasTwoDistinct(shapes);
}
