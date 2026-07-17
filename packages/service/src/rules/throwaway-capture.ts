/**
 * Warns on capture-only-to-continue patterns.
 * Capturing a value just to use it immediately in the next line, or never
 * using it at all, is unnecessary. Reads the script-wide capture and
 * reference logs collected by `facts.ts` - no independent traversal.
 *
 * Two shapes fire:
 * - A capture with no reference to its name before the next capture of the
 *   same name (or end of script): a dead capture.
 * - A capture with exactly one reference to its name, when that reference
 *   is not the head-primary expression of the immediately-following
 *   top-level statement (that adjacent-head shape belongs to
 *   CAPTURE_INLINE_CHAIN instead - see capture-chain.ts for the shared
 *   predicate that keeps the two rules from double-reporting).
 *
 * A name is disqualified script-wide (no diagnostic for any of its
 * captures) when any capture of it happens inside a Closure/Block/
 * GroupedExpr/collection-op body, or any reference to it happens inside a
 * Closure/collection-op body. Determining precisely which capture a given
 * reference binds to requires scope resolution; this rule intentionally
 * does not attempt that (see facts.ts's module doc for why
 * `packages/service/src/scope/` is rejected as the data source). The
 * consequence is accepted under-firing: a name touched anywhere inside a
 * nested closure/collection-op body goes silent everywhere in the script,
 * even for top-level captures of the same name that are genuinely dead.
 */

import type {
  ASTNode,
  CaptureNode,
  ScriptNode,
  StatementNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import type { CaptureEntry, ReferenceEntry } from './facts.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { findChainCapture } from './capture-chain.js';

// ============================================================
// HELPERS
// ============================================================

/**
 * Names disqualified from THROWAWAY_CAPTURE reporting: any name captured
 * inside a nested binding scope (Closure/Block/GroupedExpr/collection-op),
 * or referenced inside a nested closure/collection-op body.
 */
function collectDisqualifiedNames(
  captureLog: readonly CaptureEntry[],
  referenceLog: readonly ReferenceEntry[]
): Set<string> {
  const disqualified = new Set<string>();
  for (const capture of captureLog) {
    if (capture.bindingScopeDepth > 0) {
      disqualified.add(capture.node.name);
    }
  }
  for (const reference of referenceLog) {
    if (reference.closureOrOpDepth > 0) {
      disqualified.add(reference.name);
    }
  }
  return disqualified;
}

/** Top-level, non-disqualified captures eligible for liveness analysis. */
function collectCandidates(
  captureLog: readonly CaptureEntry[],
  disqualified: ReadonlySet<string>
): CaptureEntry[] {
  return captureLog.filter(
    (entry) =>
      entry.bindingScopeDepth === 0 && !disqualified.has(entry.node.name)
  );
}

/**
 * Map each candidate capture to the source offset of the next candidate
 * capture of the same name, or `Infinity` if it is the last.
 */
function computeNextCandidateOffsets(
  candidates: readonly CaptureEntry[]
): ReadonlyMap<CaptureNode, number> {
  const nextOffsetByCapture = new Map<CaptureNode, number>();
  const lastOffsetByName = new Map<string, number>();

  for (let i = candidates.length - 1; i >= 0; i--) {
    const candidate = candidates[i]!;
    const name = candidate.node.name;
    nextOffsetByCapture.set(
      candidate.node,
      lastOffsetByName.get(name) ?? Infinity
    );
    lastOffsetByName.set(name, candidate.node.span.start.offset);
  }

  return nextOffsetByCapture;
}

/** Group the reference log by variable name, preserving source order. */
function groupReferencesByName(
  referenceLog: readonly ReferenceEntry[]
): ReadonlyMap<string, ReferenceEntry[]> {
  const byName = new Map<string, ReferenceEntry[]>();
  for (const reference of referenceLog) {
    const existing = byName.get(reference.name);
    if (existing) {
      existing.push(reference);
    } else {
      byName.set(reference.name, [reference]);
    }
  }
  return byName;
}

/** Map each top-level statement's trailing capture to its statement index. */
function indexTopLevelCaptures(
  statements: readonly ASTNode[]
): ReadonlyMap<CaptureNode, number> {
  const indexByCapture = new Map<CaptureNode, number>();
  statements.forEach((statement, index) => {
    if (statement.type !== 'Statement') return;
    const capture = findChainCapture((statement as StatementNode).expression);
    if (capture) {
      indexByCapture.set(capture, index);
    }
  });
  return indexByCapture;
}

/**
 * True when `refNode` sits anywhere inside the top-level statement
 * immediately following `captureNode`'s own top-level statement.
 *
 * A use on the very next line is not "away from its capture", whatever its
 * position within that statement. Testing only the head-primary would
 * report `x => $x` / `guard { $x.field }` as a distant single use and tell
 * the author to inline something already adjacent. Containment is decided
 * by source offset rather than by descending the statement, because rules
 * must not sub-walk the AST (see no-subwalks.test.ts).
 */
function isImmediatelyChained(
  captureNode: CaptureNode,
  refNode: ASTNode,
  statements: readonly ASTNode[],
  topLevelCaptureIndex: ReadonlyMap<CaptureNode, number>
): boolean {
  const statementIndex = topLevelCaptureIndex.get(captureNode);
  if (statementIndex === undefined) return false;

  const nextStatement = statements[statementIndex + 1];
  if (!nextStatement || nextStatement.type !== 'Statement') return false;

  // Half-open interval on the reference's start offset. A statement's end
  // offset is exclusive, and a Variable node's span is zero-width, so
  // comparing ends would read a reference at the head of the next statement
  // as belonging to the previous one.
  const refStart = refNode.span.start.offset;
  return (
    refStart >= nextStatement.span.start.offset &&
    refStart < nextStatement.span.end.offset
  );
}

function deadCaptureDiagnostic(
  captureNode: CaptureNode,
  source: string
): Diagnostic {
  return {
    code: 'THROWAWAY_CAPTURE',
    message: `'$${captureNode.name}' is captured but never referenced`,
    severity: 'info',
    location: captureNode.span.start,
    context: extractContextLine(captureNode.span.start.line, source),
    fix: null,
  };
}

function singleDistantUseDiagnostic(
  captureNode: CaptureNode,
  source: string
): Diagnostic {
  return {
    code: 'THROWAWAY_CAPTURE',
    message: `'$${captureNode.name}' is captured and used only once, away from its capture; consider inlining instead`,
    severity: 'info',
    location: captureNode.span.start,
    context: extractContextLine(captureNode.span.start.line, source),
    fix: null,
  };
}

// ============================================================
// RULE
// ============================================================

export const throwawayCapture: Rule = {
  code: 'THROWAWAY_CAPTURE',
  nodeTypes: ['Script'],
  defaultSeverity: 'info',
  category: 'formatting',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const scriptNode = node as ScriptNode;
    const { captureLog, referenceLog } = context.facts.script;

    const disqualified = collectDisqualifiedNames(captureLog, referenceLog);
    const candidates = collectCandidates(captureLog, disqualified);
    const nextOffsetByCapture = computeNextCandidateOffsets(candidates);
    const referencesByName = groupReferencesByName(referenceLog);
    const topLevelCaptureIndex = indexTopLevelCaptures(scriptNode.statements);

    const diagnostics: Diagnostic[] = [];

    for (const candidate of candidates) {
      const captureNode = candidate.node;
      const offset = captureNode.span.start.offset;
      const nextOffset = nextOffsetByCapture.get(captureNode) ?? Infinity;

      const refs = (referencesByName.get(captureNode.name) ?? []).filter(
        (reference) => {
          const refOffset = reference.node.span.start.offset;
          return refOffset > offset && refOffset < nextOffset;
        }
      );

      if (refs.length === 0) {
        diagnostics.push(deadCaptureDiagnostic(captureNode, context.source));
        continue;
      }

      if (refs.length === 1) {
        const isChained = isImmediatelyChained(
          captureNode,
          refs[0]!.node,
          scriptNode.statements,
          topLevelCaptureIndex
        );
        if (!isChained) {
          diagnostics.push(
            singleDistantUseDiagnostic(captureNode, context.source)
          );
        }
      }
    }

    return diagnostics;
  },
};

registeredRules.push(throwawayCapture);
