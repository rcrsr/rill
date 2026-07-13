/**
 * Detects invoking a stream-returning closure before iterating over its
 * result. `$stream()` consumes chunks internally, leaving no data for a
 * subsequent `seq`/`fan`/`fold`/`filter`/`acc` pass.
 *
 * Detection:
 * - Tracks variables captured from stream closures (`returnTypeTarget` of
 *   `stream`) or captured with an explicit `:stream` type annotation.
 * - Records the first invocation (`ClosureCall`) and first iteration
 *   (collection-op pipe target) for each such variable.
 * - Fires when invocation precedes iteration in source order, or when the
 *   variable is invoked but never iterated.
 */

import type {
  ASTNode,
  CaptureNode,
  ClosureCallNode,
  ClosureNode,
  PipeChainNode,
  ScriptNode,
  TypeConstructorNode,
  VariableNode,
} from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';
import { isCollectionOpCall } from './collection-ops.js';
import { traverseForRules } from './traversal.js';

// ============================================================
// PHASE 1: STREAM VARIABLE COLLECTION
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
 * Collect variable names captured from stream closures or with :stream type.
 * Capture nodes appear in PipeChain.pipes (not .terminator); only
 * Break/Return/Yield use the terminator slot.
 */
function collectStreamVariables(node: ASTNode, streamVars: Set<string>): void {
  traverseForRules(node, {
    enter(n: ASTNode) {
      if (n.type !== 'PipeChain') return;

      const chain = n;
      const capture = findTrailingCapture(chain);
      if (!capture) return;

      const varName = capture.name;

      if (
        capture.typeRef &&
        capture.typeRef.kind === 'static' &&
        capture.typeRef.typeName === 'stream'
      ) {
        streamVars.add(varName);
        return;
      }

      if (isStreamClosure(chain)) {
        streamVars.add(varName);
      }
    },
    exit() {
      // no-op
    },
  });
}

// ============================================================
// PHASE 2: USAGE COLLECTION
// ============================================================

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

/**
 * Collect first invocation and first iteration sites for stream variables.
 * Traverses the AST in source order, recording only the first occurrence of
 * each.
 */
function collectStreamUsages(
  node: ASTNode,
  streamVars: Set<string>,
  firstInvocation: Map<string, ClosureCallNode>,
  firstIteration: Map<string, ASTNode>
): void {
  traverseForRules(node, {
    enter(n: ASTNode) {
      if (n.type === 'ClosureCall') {
        const call = n;
        if (
          streamVars.has(call.name) &&
          call.accessChain.length === 0 &&
          !firstInvocation.has(call.name)
        ) {
          firstInvocation.set(call.name, call);
        }
        return;
      }

      if (n.type === 'PipeChain') {
        const chain = n;
        const varName = getPipeHeadVariableName(chain);
        if (
          varName !== null &&
          streamVars.has(varName) &&
          !firstIteration.has(varName)
        ) {
          for (const pipe of chain.pipes) {
            if (isCollectionOpCall(pipe)) {
              firstIteration.set(varName, pipe);
              break;
            }
          }
        }
      }
    },
    exit() {
      // no-op
    },
  });
}

// ============================================================
// RULE
// ============================================================

export const streamPreIteration: Rule = {
  code: 'STREAM_PRE_ITERATION',
  nodeTypes: ['Script'],
  defaultSeverity: 'warning',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const scriptNode = node as ScriptNode;
    const diagnostics: Diagnostic[] = [];

    const streamVars = new Set<string>();
    collectStreamVariables(scriptNode, streamVars);

    if (streamVars.size === 0) {
      return diagnostics;
    }

    const firstInvocation = new Map<string, ClosureCallNode>();
    const firstIteration = new Map<string, ASTNode>();
    collectStreamUsages(
      scriptNode,
      streamVars,
      firstInvocation,
      firstIteration
    );

    for (const varName of streamVars) {
      const invocation = firstInvocation.get(varName);
      const iteration = firstIteration.get(varName);

      if (!invocation) {
        continue;
      }

      const invokedBeforeIteration =
        !iteration ||
        invocation.span.start.line < iteration.span.start.line ||
        (invocation.span.start.line === iteration.span.start.line &&
          invocation.span.start.column < iteration.span.start.column);

      if (invokedBeforeIteration) {
        diagnostics.push({
          location: invocation.span.start,
          severity: 'warning',
          code: 'STREAM_PRE_ITERATION',
          message: `Stream invoked before iteration; chunks consumed internally. '$${varName}' at line ${invocation.span.start.line}`,
          context: extractContextLine(
            invocation.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

registeredRules.push(streamPreIteration);
