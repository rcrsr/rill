/**
 * Declared-Type Flow Through Postfix and Pipe Targets
 *
 * Carried variants of postfix-expression and pipe-target evaluation. Each
 * pairs the produced value with the declared type that travels beside it, so
 * a declaration survives only through the constructs that carry one and every
 * other construct reports its own type (no declaration).
 *
 * Carrying primaries: variable reads, type assertions, grouped expressions
 * and `.!code` probes. Carrying steps: bracket access on a declared
 * collection and own-field reads. Carrying pipe targets: type assertions,
 * pass blocks, own-field method reads, grouped expressions, `$.field` reads,
 * the synthetic `$` postfix, and destructures. Element projection comes from
 * the located element (locateField, projectLocated). A pipe that selects from
 * a declared collection (`"a" -> $d`) is a variable target handled in core.ts,
 * which carries the selected element's declared type.
 *
 * @internal
 */

import type {
  PostfixExprNode,
  PrimaryNode,
  PipeTargetNode,
  BodyNode,
} from '../../../../types.js';
import type { Carried, DeclaredSlot } from '../../types/declared.js';
import type { ControlFlowContext } from '../../types/runtime.js';
import type { RillValue } from '../../types/structures.js';
import { isVacant } from '../../types/guards.js';
import { isMissingTypePropertyHalt } from '../../types/type-properties.js';
import { throwFatalHostHalt, throwTypeHalt } from '../../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import type { EvalState } from '../state.js';
import { getNodeLocation } from '../shared.js';
import {
  evaluateMethod,
  evaluateAnnotationAccess,
  locateOwnFieldRead,
} from './methods.js';
import {
  applyBracketIndexCarried,
  evaluateVariableCarried,
  evaluateExistenceCheck,
} from './variables.js';
import { evaluateBody } from './control-flow.js';
import { evaluateTypeAssertionCarried } from './types.js';
import { evaluateStatusProbeCarried } from './recovery.js';
import { evaluatePassBlock } from './literals.js';
import { evaluateGroupedExprCarried } from './expressions.js';
import { evaluateDestructure } from './extraction.js';
import { projectLocated } from './field-access.js';
import { evaluatePrimary, evaluatePipeTarget, matchesErrorId } from './core.js';

// ============================================================
// POSTFIX
// ============================================================

/** True when `error` is a missing member/annotation/field a `??` default recovers. */
function isRecoverableMissing(error: unknown): boolean {
  return (
    matchesErrorId(
      error,
      ERROR_IDS.RILL_R007,
      ERROR_ATOMS[ERROR_IDS.RILL_R007]
    ) ||
    matchesErrorId(
      error,
      ERROR_IDS.RILL_R008,
      ERROR_ATOMS[ERROR_IDS.RILL_R008]
    ) ||
    matchesErrorId(
      error,
      ERROR_IDS.RILL_R009,
      ERROR_ATOMS[ERROR_IDS.RILL_R009]
    ) ||
    isMissingTypePropertyHalt(error)
  );
}

/**
 * Evaluate a primary and report its declared type. Variable reads, type
 * assertions, grouped expressions and status probes carry a declaration; every
 * other primary takes its own type.
 */
export function evaluatePrimaryCarried(
  s: EvalState,
  primary: PrimaryNode
): Promise<Carried> {
  // Not async: each branch returns its evaluator's promise directly, so the
  // dispatch adds no async frame on the path every expression takes.
  switch (primary.type) {
    case 'Variable':
      return evaluateVariableCarried(s, primary);

    case 'GroupedExpr':
      return evaluateGroupedExprCarried(s, primary);

    case 'StatusProbe':
      return evaluateStatusProbeCarried(s, primary);

    case 'TypeAssertion':
      return evaluatePostfixAssertionCarried(s, primary);

    default:
      return evaluateOwnPrimary(s, primary);
  }
}

/** A postfix `expr:type`: the operand is evaluated once, then asserted. */
async function evaluatePostfixAssertionCarried(
  s: EvalState,
  primary: Extract<PrimaryNode, { type: 'TypeAssertion' }>
): Promise<Carried> {
  if (!primary.operand) {
    throwTypeHalt(
      {
        location: primary.span.start,
        sourceId: s.ctx.sourceId,
        fn: ':',
      },
      'INVALID_INPUT',
      'Postfix type assertion requires operand',
      'runtime',
      undefined,
      'host'
    );
  }
  const operand = await evaluatePostfixExprCarried(s, primary.operand);
  return evaluateTypeAssertionCarried(s, primary, operand);
}

/** A primary that takes its own type. */
async function evaluateOwnPrimary(
  s: EvalState,
  primary: PrimaryNode
): Promise<Carried> {
  return { value: await evaluatePrimary(s, primary), declared: undefined };
}

/**
 * Apply postfix steps to a carried receiver. Bracket access projects the
 * element type; a plain own-field read projects the field type; annotation
 * access, method calls and invokes take their own type.
 */
async function applyPostfixStepsCarried(
  s: EvalState,
  methods: PostfixExprNode['methods'],
  start: Carried,
  fn: string
): Promise<Carried> {
  let value = start.value;
  let declared = start.declared;
  for (const method of methods) {
    if (method.type === 'AnnotationAccess') {
      value = await evaluateAnnotationAccess(
        s,
        value,
        method.key,
        method.span.start,
        declared
      );
      declared = undefined;
    } else if (method.type === 'IndexAccess') {
      const element = await applyBracketIndexCarried(
        s,
        value,
        method.index,
        getNodeLocation(s, method),
        fn,
        declared
      );
      value = element.value;
      declared = element.declared;
    } else {
      const located =
        declared !== undefined && method.type === 'MethodCall'
          ? locateOwnFieldRead(s, method, value)
          : undefined;
      const projected =
        located === undefined ? undefined : projectLocated(declared, located);
      value = await evaluateMethod(s, method, value);
      declared = projected;
    }
  }
  return { value, declared };
}

/** Evaluate a default body, which takes its own type. */
async function evaluateDefault(s: EvalState, body: BodyNode): Promise<Carried> {
  return { value: await evaluateBody(s, body), declared: undefined };
}

/**
 * Evaluate a postfix expression with its declared type. The `??` default
 * branch and the `.?` existence check take their own type.
 */
export async function evaluatePostfixExprCarried(
  s: EvalState,
  expr: PostfixExprNode
): Promise<Carried> {
  let result: Carried;
  try {
    const primary = await evaluatePrimaryCarried(s, expr.primary);
    result =
      expr.methods.length === 0
        ? primary
        : await applyPostfixStepsCarried(
            s,
            expr.methods,
            primary,
            'evaluatePostfixExpr'
          );
  } catch (error) {
    if (expr.defaultValue !== null && isRecoverableMissing(error)) {
      return evaluateDefault(s, expr.defaultValue);
    }
    throw error;
  }

  // The existence check and the default body run outside the try so a
  // missing-field halt raised while evaluating the default body is not
  // re-caught by the recovery above (which would evaluate it twice).
  if (expr.existenceCheck) {
    return {
      value: await evaluateExistenceCheck(
        s,
        result.value,
        expr.existenceCheck,
        expr
      ),
      declared: undefined,
    };
  }

  if (expr.defaultValue !== null && isVacant(result.value)) {
    return evaluateDefault(s, expr.defaultValue);
  }

  return result;
}

// ============================================================
// PIPE TARGETS
// ============================================================

/**
 * Postfix pipe target: a synthetic `$` primary reads the input (with its
 * declaration); a real primary is evaluated as a pipe target first.
 */
async function evaluatePostfixTargetCarried(
  s: EvalState,
  target: PostfixExprNode,
  input: Carried
): Promise<Carried> {
  let result: Carried;
  try {
    const primary = target.primary;
    const isSyntheticPipeVar =
      primary.type === 'Variable' &&
      primary.isPipeVar &&
      primary.name === null &&
      primary.accessChain.length === 0;
    // Non-synthetic primaries only reach this node through the pipe-target
    // parser's index and postfix-chain attachment paths. A StatusProbe (`.!`)
    // wrapper is not a PipeTargetNode member and halts as unsupported.
    let start: Carried;
    if (isSyntheticPipeVar) {
      start = input;
    } else if (
      primary.type === 'HostCall' ||
      primary.type === 'TypeConstructor' ||
      primary.type === 'TypeNameExpr' ||
      primary.type === 'PassBlock' ||
      primary.type === 'TimeoutBlock' ||
      primary.type === 'WhileLoop' ||
      primary.type === 'DoWhileLoop' ||
      primary.type === 'TypeAssertion' ||
      primary.type === 'TypeCheck'
    ) {
      start = await evaluatePipeTarget(s, primary, input);
    } else if (primary.type === 'StatusProbe') {
      return throwTypeHalt(
        {
          location: getNodeLocation(s, target),
          sourceId: s.ctx.sourceId,
          fn: '->',
        },
        'INVALID_INPUT',
        `Unsupported pipe target type: ${primary.type}`,
        'runtime',
        { nodeType: primary.type },
        'host'
      );
    } else {
      return throwFatalHostHalt(
        {
          location: getNodeLocation(s, target),
          sourceId: s.ctx.sourceId,
          fn: 'evaluatePipeChain',
        },
        ERROR_ATOMS[ERROR_IDS.RILL_R002],
        `Unexpected pipe target primary: ${primary.type}`
      );
    }
    result =
      target.methods.length === 0
        ? start
        : await applyPostfixStepsCarried(
            s,
            target.methods,
            start,
            'evaluatePipeChain'
          );
  } catch (error) {
    // Mirrors evaluatePostfixExprCarried's recovery.
    if (target.defaultValue !== null && isRecoverableMissing(error)) {
      return evaluateDefault(s, target.defaultValue);
    }
    throw error;
  }
  if (target.existenceCheck) {
    return {
      value: await evaluateExistenceCheck(
        s,
        result.value,
        target.existenceCheck,
        target
      ),
      declared: undefined,
    };
  }
  if (target.defaultValue !== null && isVacant(result.value)) {
    return evaluateDefault(s, target.defaultValue);
  }
  return result;
}

/**
 * Whether a pipe target may carry a declaration, decided without awaiting so
 * the common non-carrying targets skip the carrying dispatch entirely. Must
 * list the same targets as the cases of `evaluateCarryingPipeTarget`.
 */
export function isCarryingPipeTarget(target: PipeTargetNode): boolean {
  switch (target.type) {
    case 'TypeAssertion':
    case 'PassBlock':
    case 'MethodCall':
    case 'GroupedExpr':
    case 'PostfixExpr':
    case 'Destructure':
    case 'Destruct':
      return true;
    case 'Variable':
      return target.isPipeVar && (target.name === null || target.name === '');
    default:
      return false;
  }
}

/**
 * Evaluate a pipe target that carries a declaration. Returns undefined for
 * every other target, which takes its own type and runs through the plain
 * target switch.
 */
export async function evaluateCarryingPipeTarget(
  s: EvalState,
  target: PipeTargetNode,
  input: Carried
): Promise<Carried | undefined> {
  switch (target.type) {
    case 'TypeAssertion': {
      // A written operand is evaluated once; otherwise the input is asserted.
      const operand = target.operand
        ? await evaluatePostfixExprCarried(s, target.operand)
        : input;
      return evaluateTypeAssertionCarried(s, target, operand);
    }

    case 'PassBlock': {
      // The pass block returns the input unchanged, so its declaration stays.
      const value = await evaluatePassBlock(s, target);
      return { value, declared: input.declared };
    }

    case 'MethodCall': {
      // A plain own-field read on a declared collection projects the field
      // type; every other method takes its own type.
      const located =
        input.declared !== undefined
          ? locateOwnFieldRead(s, target, input.value)
          : undefined;
      const projected =
        located === undefined
          ? undefined
          : projectLocated(input.declared, located);
      const value = await evaluateMethod(s, target, input.value);
      return { value, declared: projected };
    }

    case 'GroupedExpr':
      return evaluateGroupedExprCarried(s, target);

    case 'Variable': {
      // `$.field` is property access on the pipe value and projects from it.
      if (
        target.isPipeVar &&
        (target.name === null || target.name === '') &&
        target.accessChain.length > 0
      ) {
        return evaluateVariableCarried(s, target);
      }
      return undefined;
    }

    case 'PostfixExpr':
      return evaluatePostfixTargetCarried(s, target, input);

    case 'Destructure':
    case 'Destruct': {
      const value = await evaluateDestructure(
        s,
        target,
        input.value,
        input.declared
      );
      return { value, declared: input.declared };
    }

    default:
      return undefined;
  }
}

// ============================================================
// PIPE SLOT SAVE/RESTORE
// ============================================================

/**
 * Restore the pipe value together with its declaration slot. The slot is
 * keyed by value identity, so restoring only the value could leave a stale
 * slot that matches an unrelated primitive.
 */
export function restorePipe(
  ctx: ControlFlowContext,
  value: RillValue,
  slot: DeclaredSlot | undefined
): void {
  ctx.pipeValue = value;
  ctx.pipeDeclared = slot;
}
