/**
 * Code block evaluation.
 *
 * A code block is never a value: it runs where it is written, in a child
 * scope, and yields its last statement.
 * @internal
 */

import type { BlockNode, SourceLocation } from '../../../../types.js';
import type { RillValue, TypeStructure } from '../../types/structures.js';
import type { ScriptCallable } from '../../callable.js';
import { isScriptCallable } from '../../callable.js';
import { isHeldBlock } from '../../types/held-block.js';
import {
  createChildContext,
  pushCallFrame,
  popCallFrame,
} from '../../context.js';
import { setPipe } from '../../types/declared.js';
import { RillError } from '../../../../types.js';
import { RuntimeHaltSignal, throwFatalHostHalt } from '../../types/halt.js';
import { appendTraceFrame, getStatus, mergeRaw } from '../../types/status.js';
import { createTraceFrame, TRACE_KINDS } from '../../types/trace.js';
import { isExtensionThrow, markExtensionThrow } from '../../extension-throw.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';
import type { EvalState } from '../state.js';
import { getNodeLocation, withChildScope } from '../shared.js';
import { evaluateBodyExpression } from './control-flow.js';
import { formatCallSite, invokeCallable } from './closures.js';
import { restorePipe } from './declared-flow.js';

/**
 * Run a code block once in a child scope.
 *
 * `$` is bound to `dollar`, or left unbound when `dollar` is null so that
 * reading it halts RILL-R005. `return` ends the block with its value; `break`
 * passes through to the enclosing loop. `declared` is the type `$` carries.
 * The run adds no call depth.
 */
export async function runCodeBlock(
  s: EvalState,
  block: BlockNode,
  dollar: RillValue | null,
  declared?: TypeStructure
): Promise<RillValue> {
  const location = getNodeLocation(s, block);
  if (block.statements.length === 0) {
    throwFatalHostHalt(
      {
        location,
        sourceId: s.ctx.sourceId,
        fn: 'runCodeBlock',
      },
      ERROR_ATOMS[ERROR_IDS.RILL_R043],
      'Code block produced no value',
      { context: 'Code block' }
    );
  }

  const blockCtx = createChildContext(s.ctx);
  if (dollar === null) {
    blockCtx.pipeValue = null;
    blockCtx.pipeDeclared = undefined;
  } else {
    setPipe(blockCtx, dollar, declared);
  }

  const outer = s.ctx;
  pushCallFrame(outer, {
    location: block.span,
    functionName: '<function>',
    sourceId: outer.sourceId,
  });
  try {
    return await withChildScope(s, blockCtx, () =>
      evaluateBodyExpression(s, block)
    );
  } catch (e) {
    markExtensionThrow(e);
    // Snapshot the call stack before the frame pops. The first snapshot wins,
    // so nested calls keep the deepest stack.
    if (
      e instanceof RillError &&
      outer.callStack.length > 0 &&
      e.context?.['callStack'] === undefined
    ) {
      const wasExtensionThrow = isExtensionThrow(e);
      const withStack = e.withContext({ callStack: [...outer.callStack] });
      if (wasExtensionThrow) markExtensionThrow(withStack);
      throw withStack;
    }
    if (e instanceof RuntimeHaltSignal) {
      const priorRaw = getStatus(e.value).raw;
      const stacked =
        outer.callStack.length > 0 && !('callStack' in priorRaw)
          ? mergeRaw(e.value, { callStack: [...outer.callStack] })
          : e.value;
      const enriched = appendTraceFrame(
        stacked,
        createTraceFrame({
          site: formatCallSite(location, outer.sourceId),
          kind: TRACE_KINDS.ACCESS,
          fn: 'invokeRegularScriptCallable',
        })
      );
      const signal = new RuntimeHaltSignal(enriched, e.catchable);
      markExtensionThrow(signal);
      throw signal;
    }
    throw e;
  } finally {
    popCallFrame(outer);
  }
}

/**
 * Run a held block once. The run counts one call depth level, so a held block
 * that selects itself is bounded by the call-depth ceiling.
 *
 * `$` is bound to `dollar` for the run, or left unbound when `dollar` is
 * null so that reading it halts RILL-R005. `$@` inside the block resolves
 * lexically, in the scope where the block was written.
 */
async function runHeldBlock(
  s: EvalState,
  held: ScriptCallable,
  dollar: RillValue | null,
  declared?: TypeStructure,
  location?: SourceLocation
): Promise<RillValue> {
  const savedValue = s.ctx.pipeValue;
  const savedDeclared = s.ctx.pipeDeclared;
  if (dollar === null) {
    s.ctx.pipeValue = null;
    s.ctx.pipeDeclared = undefined;
  } else {
    setPipe(s.ctx, dollar, declared);
  }
  try {
    return await invokeCallable(s, held, [], location);
  } finally {
    restorePipe(s.ctx, savedValue, savedDeclared);
  }
}

/** A selected value, and whether selecting it ran a held block. */
export interface SelectedValue {
  readonly value: RillValue;
  readonly ran: boolean;
}

/**
 * Resolve a value a selection produced. A held block runs with `$` bound to
 * `dollar` and its result is returned with `ran: true`. Any other value,
 * including a function, is returned unchanged.
 */
export async function resolveSelected(
  s: EvalState,
  value: RillValue,
  dollar: RillValue | null,
  declared?: TypeStructure,
  location?: SourceLocation
): Promise<SelectedValue> {
  if (!isHeldBlock(value) || !isScriptCallable(value)) {
    return { value, ran: false };
  }
  return {
    value: await runHeldBlock(s, value, dollar, declared, location),
    ran: true,
  };
}
