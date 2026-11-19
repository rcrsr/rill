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
  BracketAccess,
  CaptureNode,
  ClosureCallNode,
  ClosureNode,
  DestructNode,
  DestructureNode,
  DictEntryNode,
  DictLiteralNode,
  DictNode,
  OrderedLiteralNode,
  PipeChainNode,
  PropertyAccess,
  SourceSpan,
  TypeRef,
} from '@rcrsr/rill';

import { opensScope } from '../opens-scope.js';
import { traverseForRules } from './traversal.js';
import { getCollectionOpBody, isCollectionOpCall } from './collection-ops.js';
import { chainlessVariableName } from './helpers.js';
import { isEntriesRead } from './static-type.js';
import {
  isMixedCompoundList,
  isMixedValueDict,
  unwrapBareLiteral,
} from './literal-shape.js';

// ============================================================
// PUBLIC TYPES
// ============================================================

/** A single Capture node observed during the walk, tagged with its closure depth. */
export interface CaptureEntry {
  readonly node: CaptureNode;
  readonly closureDepth: number;
  /** Count of Closure/collection-op ancestors strictly above this node. */
  readonly closureOrOpDepth: number;
  /** Count of Closure/Block/GroupedExpr/Interpolation/collection-op ancestors strictly above this node. */
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
  /** Count of Closure/Block/GroupedExpr/Interpolation/collection-op ancestors strictly above this node. */
  readonly bindingScopeDepth: number;
  /**
   * Source span of the reference site itself, when it is narrower than
   * `node.span` - currently only set for a dynamic field-key segment
   * (`.$var`) inside a `Variable` node's access chain, where `node` is the
   * enclosing `Variable` (the chain's head) but the actual reference text is
   * the `.$var` segment further along the chain. Absent for `Variable`- and
   * `ClosureCall`-node references, which use `node.span` directly.
   */
  readonly span?: SourceSpan;
}

/** Precomputed boolean facts and capture-log window for one AST subtree. */
export interface SubtreeFacts {
  /** Count of Closure ancestors strictly above this node. */
  readonly closureDepth: number;
  /** [captureStart, captureEnd) window into ScriptFacts.captureLog. */
  readonly captureStart: number;
  readonly captureEnd: number;
  /** [referenceStart, referenceEnd) window into ScriptFacts.referenceLog. */
  readonly referenceStart: number;
  readonly referenceEnd: number;
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
  /** Variables captured exactly once from a bare mixed-compound list literal, never a closure parameter. */
  readonly mixedListVars: ReadonlySet<string>;
  /** Variables captured exactly once from a bare mixed-value dict literal, never a closure parameter. */
  readonly mixedDictVars: ReadonlySet<string>;
  /** Variables captured exactly once from a bare dict or ordered literal, never a closure parameter, mapped to that literal. */
  readonly dictLiteralVars: ReadonlyMap<
    string,
    DictNode | DictLiteralNode | OrderedLiteralNode
  >;
  /** First zero-accessChain ClosureCall per callee name, in source order. */
  readonly firstClosureCall: ReadonlyMap<string, ClosureCallNode>;
  /** First collection-op pipe applied to a bare-variable head, per variable name, in source order. */
  readonly firstPipeIteration: ReadonlyMap<string, ASTNode>;
  /** True if any Variable node's access chain contains a dynamically-keyed field access (`computed`, `variable`, or `block` kind). */
  readonly hasDynamicFieldAccess: boolean;
  /** Every ClosureParam name observed, script-wide (order and duplicates not preserved). */
  readonly paramNames: ReadonlySet<string>;
  /** Every literal (`.field`) field name accessed via a Variable's access chain, script-wide. */
  readonly literalFieldAccessNames: ReadonlySet<string>;
  /**
   * Closure literals that are the direct value of a `DictEntry` - the
   * documented dict-bound closure idiom (`dict[k: { $... }]`), where a bare
   * `$` inside the closure body binds late to whatever the entry is invoked
   * with, not to a definition-time value. Populated when a `DictEntry`'s
   * value unwraps (through a pipe-less `PipeChain` and a method-less
   * `PostfixExpr`) to a `Closure` primary.
   */
  readonly dictBoundClosures: ReadonlySet<ASTNode>;
  /**
   * Names bound exactly once script-wide (counting captures, destructure
   * targets, and closure params), where that one binding is a typed capture
   * or typed closure param with a non-dynamic type.
   */
  readonly declaredTypes: ReadonlyMap<string, TypeRef>;
  /** Variables captured exactly once from a chain whose value is an `.entries` read. */
  readonly entriesVars: ReadonlySet<string>;
  /** Bodies of collection ops fed by an `.entries` read or an `entriesVars` variable. */
  readonly entriesBodies: ReadonlySet<ASTNode>;
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
  const lastPipe = chain.pipes.at(-1);
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

  const closure = head.primary;
  const returnType = closure.returnTypeTarget;
  if (!returnType) return false;

  return returnType.kind === 'static' && returnType.typeName === 'stream';
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

  const variable = head.primary;
  if (variable.isPipeVar || variable.name === null) return null;
  if (variable.accessChain.length > 0) return null;

  return variable.name;
}

/**
 * Unwrap a `DictEntry`'s value to the `Closure` node it holds, when the
 * value is nothing but that closure - a pipe-less `PipeChain` whose head is
 * a method-less `PostfixExpr` wrapping a `Closure` primary. Returns null for
 * any other shape (a piped expression, a closure with trailing methods,
 * etc.), which is not the dict-bound closure idiom.
 */
function dictBoundClosureFromEntry(entry: DictEntryNode): ClosureNode | null {
  const value = entry.value;
  if (value.type !== 'PipeChain') return null;
  if (value.pipes.length > 0) return null;
  const head = value.head;
  if (head.type !== 'PostfixExpr') return null;
  if (head.methods.length > 0) return null;
  if (head.primary.type !== 'Closure') return null;
  return head.primary;
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
  if (head.type !== 'PostfixExpr') return false;
  const primary = head.primary;
  if (primary.type !== 'Variable') return false;
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

/**
 * Every access on a Variable in source order: the access chain plus the
 * final access of a `.?` existence probe (`.?field`, `.?$k`, `.?[expr]`).
 */
function allAccessesSelf(node: ASTNode): PropertyAccess[] {
  if (node.type !== 'Variable') return [];
  const final = node.existenceCheck?.finalAccess;
  return final === undefined || final === null
    ? node.accessChain
    : [...node.accessChain, final];
}

/** True for a Variable node with a literal `.len` field access, including `.?len`. */
function hasLenFieldAccessSelf(node: ASTNode): boolean {
  return allAccessesSelf(node).some(
    (access) =>
      'kind' in access && access.kind === 'literal' && access.field === 'len'
  );
}

/** True for a Variable node with a bracket-index access, including `.?[i]`. */
function hasBracketAccessSelf(node: ASTNode): boolean {
  return allAccessesSelf(node).some(
    (access) => 'accessKind' in access && access.accessKind === 'bracket'
  );
}

/** True when a bracket expression is a static number: `0` or `-1`. */
function isStaticNumberBracket(access: BracketAccess): boolean {
  const expr = access.expression;
  if (expr.type !== 'PipeChain' || expr.pipes.length > 0) return false;
  let head = expr.head;
  if (head.type === 'UnaryExpr' && head.op === '-') head = head.operand;
  return (
    head.type === 'PostfixExpr' &&
    head.methods.length === 0 &&
    head.primary.type === 'NumberLiteral'
  );
}

/**
 * True for a Variable node with a dynamically-keyed access: a `variable`
 * field access (`.$var`) or a bracket access (`[expr]`, `.?[expr]`) whose
 * expression is not a static number literal. A number bracket indexes a
 * list or string and can never name a dict key.
 */
function hasDynamicFieldAccessSelf(node: ASTNode): boolean {
  return allAccessesSelf(node).some((access) =>
    'accessKind' in access
      ? !isStaticNumberBracket(access)
      : access.kind === 'variable'
  );
}

/** Literal (`.field`) field names accessed by a Variable node, including `.?field`. */
function literalFieldAccessNamesSelf(node: ASTNode): string[] {
  const names: string[] = [];
  for (const access of allAccessesSelf(node)) {
    if ('kind' in access && access.kind === 'literal') {
      names.push(access.field);
    }
  }
  return names;
}

// ============================================================
// FACT COLLECTION
// ============================================================

/** Mutable per-frame accumulator, parallel to the traversal stack. */
interface Accumulator {
  closureDepth: number;
  captureStart: number;
  referenceStart: number;
  hasBreak: boolean;
  hasSideEffect: boolean;
  hasBareDollar: boolean;
  hasClosure: boolean;
  hasExplicitCapture: boolean;
  hasStatusProbe: boolean;
  hasLenFieldAccess: boolean;
  hasBracketAccess: boolean;
}

/** Add every variable name bound by a destructure pattern (including nested ones) to `counts`. */
function countDestructureTargets(
  node: DestructureNode | DestructNode,
  counts: Map<string, number>
): void {
  for (const element of node.elements) {
    if (element.name !== null) {
      counts.set(element.name, (counts.get(element.name) ?? 0) + 1);
    }
    if (element.nested !== null) {
      countDestructureTargets(element.nested, counts);
    }
  }
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
  const mixedListCandidates = new Set<string>();
  const mixedDictCandidates = new Set<string>();
  const dictLiteralCandidates = new Map<
    string,
    DictNode | DictLiteralNode | OrderedLiteralNode
  >();
  const firstClosureCall = new Map<string, ClosureCallNode>();
  const firstPipeIteration = new Map<string, ASTNode>();
  let hasDynamicFieldAccess = false;
  const paramNames = new Set<string>();
  const destructureCounts = new Map<string, number>();
  const literalFieldAccessNames = new Set<string>();
  const dictBoundClosures = new Set<ASTNode>();
  const paramCounts = new Map<string, number>();
  const paramTypes = new Map<string, TypeRef>();
  const entriesCandidates = new Set<string>();
  const entriesBodies = new Set<ASTNode>();
  const entriesBodyCandidates: Array<readonly [string, ASTNode]> = [];

  const stack: Accumulator[] = [];
  let currentClosureDepth = 0;
  let currentClosureOrOpDepth = 0;
  let currentBindingScopeDepth = 0;

  // Collection-op body nodes that are a bare `{...}` Block (not an explicit
  // `fn(x) { ... }` Closure). Populated when the enclosing HostCall is entered,
  // consulted when that specific Block node is entered/exited below, so the
  // extra closureOrOpDepth bump scopes only the resolved body subtree - not
  // the call's other arguments (e.g. `fold`/`acc`'s seed value).
  const collectionOpBlockBodies = new Set<ASTNode>();

  traverseForRules(root, {
    enter(node: ASTNode) {
      stack.push({
        closureDepth: currentClosureDepth,
        captureStart: captureLog.length,
        referenceStart: referenceLog.length,
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

      if (isCollectionOp) {
        const body = getCollectionOpBody(node);
        if (body && body.type === 'Block') {
          collectionOpBlockBodies.add(body);
        }
      }

      if (node.type === 'Closure') {
        currentClosureDepth++;
        currentClosureOrOpDepth++;
        currentBindingScopeDepth++;
      } else if (opensScope(node)) {
        currentBindingScopeDepth++;
        if (collectionOpBlockBodies.has(node)) {
          currentClosureOrOpDepth++;
        }
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

      if (node.type === 'Variable') {
        for (const access of node.accessChain) {
          if (
            'kind' in access &&
            access.kind === 'variable' &&
            access.variableName !== null
          ) {
            referenceLog.push({
              name: access.variableName,
              node,
              closureOrOpDepth: currentClosureOrOpDepth,
              bindingScopeDepth: currentBindingScopeDepth,
              span: access.span,
            });
          }
        }
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

        const [onlyPipe] = node.pipes;
        if (node.pipes.length === 1 && onlyPipe?.type === 'Capture') {
          const literal = unwrapBareLiteral(node.head);
          if (isMixedCompoundList(literal)) {
            mixedListCandidates.add(onlyPipe.name);
          } else if (isMixedValueDict(literal)) {
            mixedDictCandidates.add(onlyPipe.name);
          }
          if (
            literal.type === 'Dict' ||
            literal.type === 'DictLiteral' ||
            literal.type === 'OrderedLiteral'
          ) {
            dictLiteralCandidates.set(onlyPipe.name, literal);
          }
        }

        if (capture) {
          const before = node.pipes.at(-2) ?? node.head;
          if (isEntriesRead(before)) entriesCandidates.add(capture.name);
        }

        node.pipes.forEach((pipe, index) => {
          if (!isCollectionOpCall(pipe)) return;
          const body = getCollectionOpBody(pipe);
          if (body === null) return;
          const input = index === 0 ? node.head : node.pipes[index - 1];
          if (input === undefined) return;
          if (isEntriesRead(input)) {
            entriesBodies.add(body);
          } else if (index === 0) {
            const name = chainlessVariableName(unwrapBareLiteral(input));
            if (name !== null) entriesBodyCandidates.push([name, body]);
          }
        });

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

      if (hasDynamicFieldAccessSelf(node)) {
        hasDynamicFieldAccess = true;
      }

      if (node.type === 'ClosureParam') {
        paramNames.add(node.name);
        paramCounts.set(node.name, (paramCounts.get(node.name) ?? 0) + 1);
        if (node.typeRef !== null && node.typeRef.kind !== 'dynamic') {
          paramTypes.set(node.name, node.typeRef);
        }
      }

      if (node.type === 'Destructure' || node.type === 'Destruct') {
        countDestructureTargets(node, destructureCounts);
      }

      if (node.type === 'DictEntry') {
        const closure = dictBoundClosureFromEntry(node);
        if (closure) {
          dictBoundClosures.add(closure);
        }
      }

      for (const field of literalFieldAccessNamesSelf(node)) {
        literalFieldAccessNames.add(field);
      }
    },

    exit(node: ASTNode) {
      if (node.type === 'Closure') {
        currentClosureDepth--;
        currentClosureOrOpDepth--;
        currentBindingScopeDepth--;
      } else if (opensScope(node)) {
        currentBindingScopeDepth--;
        if (collectionOpBlockBodies.has(node)) {
          currentClosureOrOpDepth--;
        }
      }

      const acc = stack.pop();
      if (!acc) return;

      const facts: SubtreeFacts = {
        closureDepth: acc.closureDepth,
        captureStart: acc.captureStart,
        captureEnd: captureLog.length,
        referenceStart: acc.referenceStart,
        referenceEnd: referenceLog.length,
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

      const parent = stack.at(-1);
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

  // A destructure target rebinds a name just as a capture does, so it counts
  // toward the single-capture requirement.
  const captureCounts = new Map<string, number>(destructureCounts);
  for (const entry of captureLog) {
    const name = entry.node.name;
    captureCounts.set(name, (captureCounts.get(name) ?? 0) + 1);
  }
  const qualifies = (name: string): boolean =>
    captureCounts.get(name) === 1 && !paramNames.has(name);
  const mixedListVars = new Set([...mixedListCandidates].filter(qualifies));
  const mixedDictVars = new Set([...mixedDictCandidates].filter(qualifies));
  const dictLiteralVars = new Map(
    [...dictLiteralCandidates].filter(([name]) => qualifies(name))
  );

  const entriesVars = new Set([...entriesCandidates].filter(qualifies));
  for (const [name, body] of entriesBodyCandidates) {
    if (entriesVars.has(name)) entriesBodies.add(body);
  }

  const declaredTypes = new Map<string, TypeRef>();
  const bindingCount = (name: string): number =>
    (captureCounts.get(name) ?? 0) + (paramCounts.get(name) ?? 0);
  for (const entry of captureLog) {
    const { name, typeRef } = entry.node;
    if (
      typeRef !== null &&
      typeRef.kind !== 'dynamic' &&
      bindingCount(name) === 1
    ) {
      declaredTypes.set(name, typeRef);
    }
  }
  for (const [name, typeRef] of paramTypes) {
    if (bindingCount(name) === 1) declaredTypes.set(name, typeRef);
  }

  return {
    bySubtree,
    script: {
      captureLog,
      referenceLog,
      streamVars,
      mixedListVars,
      mixedDictVars,
      dictLiteralVars,
      firstClosureCall,
      firstPipeIteration,
      hasDynamicFieldAccess,
      paramNames,
      literalFieldAccessNames,
      dictBoundClosures,
      declaredTypes,
      entriesVars,
      entriesBodies,
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
