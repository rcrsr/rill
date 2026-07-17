/**
 * Single-pass fact collection for the rules engine.
 *
 * Several rules need boolean "does this subtree contain X" facts (break,
 * side effects, bare-`$` usage, explicit captures) that used to be
 * recomputed per-rule via their own `traverseForRules` walk over the same
 * nodes - quadratic in the worst case for deeply nested scripts. This
 * module walks the AST exactly once, accumulating those facts bottom-up
 * alongside a capture log and stream-usage maps, so every rule that needs
 * them reads from a single precomputed `AstFacts` instead of re-walking.
 *
 * The merge semantics mirror the boundary-tracking style formerly
 * hand-rolled per-rule: a `Closure` node
 * always scopes captures/break/side-effects/explicit-captures to itself: a
 * fact true inside a nested closure body is not true of the enclosing body
 * being classified. `seq`/`acc` additionally catch `break` locally (nested
 * sequential operators own their own break boundary), and every collection
 * operator (`seq`/`fan`/`fold`/`filter`/`acc`) scopes bare-`$` usage to
 * itself, since the `$` inside a nested collection-op body refers to that
 * operator's own iteration variable, not the enclosing body's.
 *
 * This walk also maintains a script-wide `referenceLog` (every `Variable`
 * and `ClosureCall` reference, in source order, tagged with two extra
 * depth counters: `closureOrOpDepth` and `bindingScopeDepth`) for
 * THROWAWAY_CAPTURE. Two existing facilities were considered and rejected
 * for this:
 * - `loops.ts`'s `collectVariableReferences` (loops.ts:21-86) is an
 *   incomplete hand-rolled switch: it has no case for `HostCall`/
 *   `ClosureCall`/`MethodCall` args, `Dict`/`Tuple`/`List` elements,
 *   `Closure` bodies, `GuardBlock`/`RetryBlock`, `Destructure`, `Slice`, or
 *   `TypeAssertion`. Reusing it here would silently undercount references,
 *   turning a live capture into a false "dead capture" diagnostic - a
 *   correctness defect, not a style preference, so extending the existing
 *   single walk with a facts-driven reference log is licensed over reusing
 *   or patching that helper.
 * - `packages/service/src/scope/` resolves binding *identity* (which
 *   declaration a name refers to) but does not count references, and each
 *   of its entry points (`resolve-scope.ts`, `find-definition.ts`,
 *   `get-hover.ts`) re-walks the AST via `walkAst` independently per call.
 *   Driving THROWAWAY_CAPTURE off it would reintroduce the quadratic
 *   per-rule walk this module exists to eliminate (see the module-level
 *   rationale above).
 */

import type {
  ASTNode,
  CaptureNode,
  ClosureCallNode,
  ClosureNode,
  PipeChainNode,
  TypeConstructorNode,
  VariableNode,
} from '@rcrsr/rill';

import { traverseForRules } from './traversal.js';
import { isCollectionOpCall } from './collection-ops.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

/** A single Capture node observed during the walk, tagged with its closure depth. */
export interface CaptureEntry {
  readonly node: CaptureNode;
  readonly closureDepth: number;
  /** Count of Closure/collection-op ancestors strictly above this node. */
  readonly closureOrOpDepth: number;
  /** Count of Closure/Block/GroupedExpr/collection-op ancestors strictly above this node. */
  readonly bindingScopeDepth: number;
}

/**
 * A single variable reference observed during the walk: a `Variable` node
 * with a non-null, non-pipe name, or a `ClosureCall` node (whose `name` is
 * itself a variable reference - `$double(5)` reads `$double`).
 */
export interface ReferenceEntry {
  readonly name: string;
  readonly node: ASTNode;
  /** Count of Closure/collection-op ancestors strictly above this node. */
  readonly closureOrOpDepth: number;
  /** Count of Closure/Block/GroupedExpr/collection-op ancestors strictly above this node. */
  readonly bindingScopeDepth: number;
}

/** Precomputed boolean facts and capture-log window for one AST subtree. */
export interface SubtreeFacts {
  /** Count of Closure ancestors strictly above this node. */
  readonly closureDepth: number;
  /** [captureStart, captureEnd) window into ScriptFacts.captureLog. */
  readonly captureStart: number;
  readonly captureEnd: number;
  /** True if a `break` appears in this subtree, masked under Closure and under seq/acc HostCall. */
  readonly hasBreak: boolean;
  /** True if a HostCall or ClosureCall appears in this subtree, masked under Closure. */
  readonly hasSideEffect: boolean;
  /** True if a bare pipe-var `$` appears in this subtree, masked under Closure and any collection-op HostCall. */
  readonly hasBareDollar: boolean;
  /** True if a Closure literal appears in this subtree. Never masked. */
  readonly hasClosure: boolean;
  /** True if an explicit `$ => $x` capture pipe appears in this subtree, masked under Closure. */
  readonly hasExplicitCapture: boolean;
  /** True if a StatusProbe (`.!`) appears in this subtree. Never masked. */
  readonly hasStatusProbe: boolean;
  /** True if a `.len` literal field access appears in this subtree, masked under Closure and any collection-op HostCall. */
  readonly hasLenFieldAccess: boolean;
  /** True if a bracket-index access (`[n]`) appears in this subtree, masked under Closure and any collection-op HostCall. */
  readonly hasBracketAccess: boolean;
}

/** Script-wide facts collected alongside the per-subtree walk. */
export interface ScriptFacts {
  /** Every Capture node observed, in enter order. */
  readonly captureLog: readonly CaptureEntry[];
  /** Every Variable/ClosureCall reference observed, in enter order. */
  readonly referenceLog: readonly ReferenceEntry[];
  /** Variable names captured from a stream-returning closure or a `:stream` annotation. */
  readonly streamVars: ReadonlySet<string>;
  /** First zero-accessChain ClosureCall per callee name, in source order. */
  readonly firstClosureCall: ReadonlyMap<string, ClosureCallNode>;
  /** First collection-op pipe applied to a bare-variable head, per variable name, in source order. */
  readonly firstPipeIteration: ReadonlyMap<string, ASTNode>;
}

/** Result of a single fact-collection pass over an AST. */
export interface AstFacts {
  readonly bySubtree: ReadonlyMap<ASTNode, SubtreeFacts>;
  readonly script: ScriptFacts;
}

// ============================================================
// STREAM-SHAPE HELPERS
// (moved verbatim from stream-pre-iteration.ts - pure shape checks, no walk)
// ============================================================

/** Find the trailing Capture node in a PipeChain's pipes array. */
function findTrailingCapture(chain: PipeChainNode): CaptureNode | null {
  const lastPipe = chain.pipes[chain.pipes.length - 1];
  if (lastPipe && lastPipe.type === 'Capture') {
    return lastPipe;
  }
  return null;
}

/** Check if a PipeChain's head is a stream-returning closure. */
function isStreamClosure(chain: PipeChainNode): boolean {
  const head = chain.head;
  if (head.type !== 'PostfixExpr') return false;

  if (head.primary.type !== 'Closure') return false;

  const closure = head.primary as ClosureNode;
  const returnType = closure.returnTypeTarget;
  if (!returnType) return false;

  if ('type' in returnType && returnType.type === 'TypeConstructor') {
    return (returnType as TypeConstructorNode).constructorName === 'stream';
  }

  if ('kind' in returnType && returnType.kind === 'static') {
    return returnType.typeName === 'stream';
  }

  return false;
}

/**
 * Extract the variable name from a PipeChain head if it's a simple variable
 * reference. Returns null for complex heads.
 */
function getPipeHeadVariableName(chain: PipeChainNode): string | null {
  const head = chain.head;
  if (head.type !== 'PostfixExpr') return null;

  if (head.primary.type !== 'Variable') return null;
  if (head.methods.length > 0) return null;

  const variable = head.primary as VariableNode;
  if (variable.isPipeVar || variable.name === null) return null;
  if (variable.accessChain.length > 0) return null;

  return variable.name;
}

// ============================================================
// SELF-CONTRIBUTION AND MASK PREDICATES
// ============================================================

/**
 * Explicit-capture shape check for a single node: `$ => $x` at the head of
 * a PipeChain. Closure-boundary tracking (a capture nested inside a closure
 * literal does not count toward the enclosing body) is handled by the
 * merge-mask below, not by this predicate.
 */
function isExplicitCapturePipeChain(node: ASTNode): boolean {
  if (node.type !== 'PipeChain') return false;
  const head = node.head;
  if (!head || head.type !== 'PostfixExpr') return false;
  const primary = head.primary;
  if (!primary || primary.type !== 'Variable') return false;
  if (!primary.isPipeVar) return false;
  for (const pipe of node.pipes) {
    if (pipe.type === 'Capture') return true;
  }
  return false;
}

/**
 * True for HostCall nodes that establish their own `break` boundary:
 * nested `seq`/`acc` catch `break` locally, so a `break` inside one does
 * not propagate to an enclosing operator being classified.
 */
function isBreakBoundary(node: ASTNode): boolean {
  return (
    node.type === 'HostCall' && (node.name === 'seq' || node.name === 'acc')
  );
}

/** True for a Variable node whose access chain contains a literal `.len` field access. */
function hasLenFieldAccessSelf(node: ASTNode): boolean {
  if (node.type !== 'Variable') return false;
  return node.accessChain.some(
    (access) =>
      'kind' in access && access.kind === 'literal' && access.field === 'len'
  );
}

/** True for a Variable node whose access chain contains a bracket-index access. */
function hasBracketAccessSelf(node: ASTNode): boolean {
  if (node.type !== 'Variable') return false;
  return node.accessChain.some(
    (access) => 'accessKind' in access && access.accessKind === 'bracket'
  );
}

// ============================================================
// FACT COLLECTION
// ============================================================

/** Mutable per-frame accumulator, parallel to the traversal stack. */
interface Accumulator {
  closureDepth: number;
  captureStart: number;
  hasBreak: boolean;
  hasSideEffect: boolean;
  hasBareDollar: boolean;
  hasClosure: boolean;
  hasExplicitCapture: boolean;
  hasStatusProbe: boolean;
  hasLenFieldAccess: boolean;
  hasBracketAccess: boolean;
}

/**
 * Walk `root` exactly once (via `traverseForRules`), accumulating the
 * boolean subtree facts, capture log, and stream-usage maps described in
 * the module doc. See the module doc for merge/mask semantics.
 */
export function collectFacts(root: ASTNode): AstFacts {
  const bySubtree = new Map<ASTNode, SubtreeFacts>();
  const captureLog: CaptureEntry[] = [];
  const referenceLog: ReferenceEntry[] = [];
  const streamVars = new Set<string>();
  const firstClosureCall = new Map<string, ClosureCallNode>();
  const firstPipeIteration = new Map<string, ASTNode>();

  const stack: Accumulator[] = [];
  let currentClosureDepth = 0;
  let currentClosureOrOpDepth = 0;
  let currentBindingScopeDepth = 0;

  traverseForRules(root, {
    enter(node: ASTNode) {
      stack.push({
        closureDepth: currentClosureDepth,
        captureStart: captureLog.length,
        hasBreak: node.type === 'Break',
        hasSideEffect: node.type === 'HostCall' || node.type === 'ClosureCall',
        hasBareDollar: node.type === 'Variable' && node.isPipeVar,
        hasClosure: node.type === 'Closure',
        hasExplicitCapture: isExplicitCapturePipeChain(node),
        hasStatusProbe: node.type === 'StatusProbe',
        hasLenFieldAccess: hasLenFieldAccessSelf(node),
        hasBracketAccess: hasBracketAccessSelf(node),
      });

      const isCollectionOp = isCollectionOpCall(node);

      if (node.type === 'Closure') {
        currentClosureDepth++;
        currentClosureOrOpDepth++;
        currentBindingScopeDepth++;
      } else if (node.type === 'Block' || node.type === 'GroupedExpr') {
        currentBindingScopeDepth++;
      } else if (isCollectionOp) {
        currentClosureOrOpDepth++;
        currentBindingScopeDepth++;
      }

      if (node.type === 'Capture') {
        captureLog.push({
          node,
          closureDepth: currentClosureDepth,
          closureOrOpDepth: currentClosureOrOpDepth,
          bindingScopeDepth: currentBindingScopeDepth,
        });
      }

      if (node.type === 'Variable' && node.name !== null && !node.isPipeVar) {
        referenceLog.push({
          name: node.name,
          node,
          closureOrOpDepth: currentClosureOrOpDepth,
          bindingScopeDepth: currentBindingScopeDepth,
        });
      }

      if (node.type === 'ClosureCall') {
        referenceLog.push({
          name: node.name,
          node,
          closureOrOpDepth: currentClosureOrOpDepth,
          bindingScopeDepth: currentBindingScopeDepth,
        });
      }

      if (node.type === 'PipeChain') {
        const capture = findTrailingCapture(node);
        if (capture) {
          const varName = capture.name;
          const typeRef = capture.typeRef;
          if (
            (typeRef &&
              typeRef.kind === 'static' &&
              typeRef.typeName === 'stream') ||
            isStreamClosure(node)
          ) {
            streamVars.add(varName);
          }
        }

        const varName = getPipeHeadVariableName(node);
        if (varName !== null && !firstPipeIteration.has(varName)) {
          for (const pipe of node.pipes) {
            if (isCollectionOpCall(pipe)) {
              firstPipeIteration.set(varName, pipe);
              break;
            }
          }
        }
      }

      if (node.type === 'ClosureCall') {
        if (node.accessChain.length === 0 && !firstClosureCall.has(node.name)) {
          firstClosureCall.set(node.name, node);
        }
      }
    },

    exit(node: ASTNode) {
      if (node.type === 'Closure') {
        currentClosureDepth--;
        currentClosureOrOpDepth--;
        currentBindingScopeDepth--;
      } else if (node.type === 'Block' || node.type === 'GroupedExpr') {
        currentBindingScopeDepth--;
      } else if (isCollectionOpCall(node)) {
        currentClosureOrOpDepth--;
        currentBindingScopeDepth--;
      }

      const acc = stack.pop();
      if (!acc) return;

      const facts: SubtreeFacts = {
        closureDepth: acc.closureDepth,
        captureStart: acc.captureStart,
        captureEnd: captureLog.length,
        hasBreak: acc.hasBreak,
        hasSideEffect: acc.hasSideEffect,
        hasBareDollar: acc.hasBareDollar,
        hasClosure: acc.hasClosure,
        hasExplicitCapture: acc.hasExplicitCapture,
        hasStatusProbe: acc.hasStatusProbe,
        hasLenFieldAccess: acc.hasLenFieldAccess,
        hasBracketAccess: acc.hasBracketAccess,
      };
      bySubtree.set(node, facts);

      const parent = stack[stack.length - 1];
      if (!parent) return;

      const isClosureBarrier = node.type === 'Closure';
      const isCollectionOp = isCollectionOpCall(node);

      const maskBreak = isClosureBarrier || isBreakBoundary(node);
      const maskSideEffect = isClosureBarrier;
      const maskBareDollar = isClosureBarrier || isCollectionOp;
      const maskExplicitCapture = isClosureBarrier;
      // A `.len`/bracket access inside a nested closure literal or a nested
      // collection-op body (bare-block form: `seq({ ... })` parses to a
      // Block, not a Closure, so isCollectionOp must be checked alongside
      // isClosureBarrier here too) belongs to that inner scope's own
      // iteration/shape, not to the loop being classified - same boundary as
      // hasBareDollar.
      const maskLenAndBracket = isClosureBarrier || isCollectionOp;

      parent.hasBreak ||= maskBreak ? false : facts.hasBreak;
      parent.hasSideEffect ||= maskSideEffect ? false : facts.hasSideEffect;
      parent.hasBareDollar ||= maskBareDollar ? false : facts.hasBareDollar;
      parent.hasClosure ||= facts.hasClosure;
      parent.hasExplicitCapture ||= maskExplicitCapture
        ? false
        : facts.hasExplicitCapture;
      parent.hasStatusProbe ||= facts.hasStatusProbe;
      parent.hasLenFieldAccess ||= maskLenAndBracket
        ? false
        : facts.hasLenFieldAccess;
      parent.hasBracketAccess ||= maskLenAndBracket
        ? false
        : facts.hasBracketAccess;
    },
  });

  return {
    bySubtree,
    script: {
      captureLog,
      referenceLog,
      streamVars,
      firstClosureCall,
      firstPipeIteration,
    },
  };
}

/**
 * Return the Capture nodes directly owned by `node`'s subtree - excluding
 * any nested inside a closure literal within that subtree - in source
 * order. Reads a slice of the shared capture log rather than walking.
 */
export function capturesInSubtree(
  facts: AstFacts,
  node: ASTNode
): CaptureNode[] {
  const subtreeFacts = facts.bySubtree.get(node);
  if (!subtreeFacts) return [];

  const result: CaptureNode[] = [];
  for (let i = subtreeFacts.captureStart; i < subtreeFacts.captureEnd; i++) {
    const entry = facts.script.captureLog[i];
    if (entry && entry.closureDepth === subtreeFacts.closureDepth) {
      result.push(entry.node);
    }
  }
  return result;
}
