/**
 * Locates `.^key` annotation reads in the three syntactic forms a script can
 * spell them: a postfix expression, a variable access chain, and a pipe
 * chain. Each read reports the node (or captured variable name) whose value
 * is read, and the `.values`/`.entries`-style stage between that receiver and
 * the read, if any.
 */

import type { ASTNode, PostfixExprNode } from '@rcrsr/rill';

// ============================================================
// TYPES
// ============================================================

/** What a read reaches through: a node, or the field name in a variable's access chain. */
export type ProbeStage = ASTNode | string;

export interface ProbeRead {
  readonly key: string;
  readonly at: ASTNode['span']['start'];
  /** The node being read, or the name of a captured variable read through its access chain. */
  readonly receiver: ASTNode | string;
  /** The stage the read applies to the receiver's result of, or null for a direct read. */
  readonly stage: ProbeStage | null;
}

// ============================================================
// HELPERS
// ============================================================

/** Index of the first read-key AnnotationAccess in `methods`, or -1. */
function readIndex(
  methods: PostfixExprNode['methods'],
  keys: ReadonlySet<string>
): number {
  return methods.findIndex(
    (m) => m.type === 'AnnotationAccess' && keys.has(m.key)
  );
}

/**
 * Read at position `k` of a method list applied to `input`: k=0 reads the
 * input itself; k=1 reads the result of a preceding method call.
 */
function methodsRead(
  methods: PostfixExprNode['methods'],
  keys: ReadonlySet<string>,
  input: ASTNode
): ProbeRead[] {
  const k = readIndex(methods, keys);
  const read = methods[k];
  if (read?.type !== 'AnnotationAccess') return [];
  if (k === 0) {
    return [
      { key: read.key, at: read.span.start, receiver: input, stage: null },
    ];
  }
  const [first] = methods;
  if (k === 1 && first?.type === 'MethodCall') {
    return [
      { key: read.key, at: read.span.start, receiver: input, stage: first },
    ];
  }
  return [];
}

function postfixReads(
  node: PostfixExprNode,
  keys: ReadonlySet<string>
): ProbeRead[] {
  if (node.primary.type === 'Variable' && node.primary.isPipeVar) return [];
  return methodsRead(node.methods, keys, node.primary);
}

function variableReads(node: ASTNode, keys: ReadonlySet<string>): ProbeRead[] {
  if (node.type !== 'Variable' || node.name === null || node.isPipeVar) {
    return [];
  }
  const k = node.accessChain.findIndex(
    (a) => 'kind' in a && a.kind === 'annotation' && keys.has(a.key)
  );
  const read = node.accessChain[k];
  if (read === undefined || !('kind' in read) || read.kind !== 'annotation') {
    return [];
  }
  const at = node.span.start;
  if (k === 0) {
    return [{ key: read.key, at, receiver: node.name, stage: null }];
  }
  const first = node.accessChain[0];
  if (
    k === 1 &&
    first !== undefined &&
    'kind' in first &&
    first.kind === 'literal'
  ) {
    return [{ key: read.key, at, receiver: node.name, stage: first.field }];
  }
  return [];
}

function pipeChainReads(node: ASTNode, keys: ReadonlySet<string>): ProbeRead[] {
  if (node.type !== 'PipeChain') return [];
  const reads: ProbeRead[] = [];
  let previous: ASTNode = node.head;
  let beforePrevious: ASTNode = node.head;
  node.pipes.forEach((pipe, i) => {
    const input = previous;
    // A read on the first pipe reads the head; later it reads the result of
    // the previous pipe applied to the one before it.
    const direct = (key: string, at: ProbeRead['at']): ProbeRead =>
      i === 0
        ? { key, at, receiver: input, stage: null }
        : { key, at, receiver: beforePrevious, stage: input };
    if (pipe.type === 'AnnotationAccess' && keys.has(pipe.key)) {
      reads.push(direct(pipe.key, pipe.span.start));
    } else if (
      pipe.type === 'PostfixExpr' &&
      pipe.primary.type === 'Variable' &&
      pipe.primary.isPipeVar
    ) {
      const k = readIndex(pipe.methods, keys);
      const read = pipe.methods[k];
      if (read?.type === 'AnnotationAccess') {
        if (k === 0) {
          reads.push(direct(read.key, read.span.start));
        } else if (k === 1) {
          reads.push(...methodsRead(pipe.methods, keys, input));
        }
      }
    }
    beforePrevious = previous;
    previous = pipe;
  });
  return reads;
}

// ============================================================
// COLLECTION
// ============================================================

/** Every read of one of `keys` that `node` spells directly. */
export function collectProbeReads(
  node: ASTNode,
  keys: ReadonlySet<string>
): ProbeRead[] {
  switch (node.type) {
    case 'PostfixExpr':
      return postfixReads(node, keys);
    case 'Variable':
      return variableReads(node, keys);
    case 'PipeChain':
      return pipeChainReads(node, keys);
    default:
      return [];
  }
}
