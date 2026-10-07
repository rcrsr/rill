/**
 * Evaluator Shared Utilities
 *
 * Shared module-level evaluator utilities. Each function takes
 * the evaluator state as its first parameter, replacing `this` access with
 * an explicit `s` argument.
 *
 * @internal
 */

import type { ASTNode, SourceLocation } from '../../../types.js';
import { isCallable } from '../callable.js';
import type { RillCallable } from '../callable.js';
import type { RillValue } from '../types/structures.js';
import { isOrdered, isPlainDict, isStream } from '../types/guards.js';
import {
  throwAbortHalt,
  throwAutoExceptionHalt,
  throwCatchableHostHalt,
  type TypeHaltSite,
} from '../types/halt.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../error-registry.js';
import type { EvalState } from './state.js';
import { invokeCallable } from './handlers/closures.js';

/**
 * Default maximum iteration count for iterators and loops, and the headroom
 * added to maxCallDepth for the run-wide in-flight call ceiling.
 */
export const DEFAULT_MAX_ITERATIONS = 10000;

/**
 * Get source location from an AST node.
 * Used for error reporting with precise location information.
 */
export function getNodeLocation(
  _s: EvalState,
  node?: ASTNode
): SourceLocation | undefined {
  return node?.span.start;
}

/**
 * Check if execution has been aborted via AbortSignal.
 * Throws a non-catchable RuntimeHaltSignal via throwAbortHalt
 * when the signal is aborted.
 */
export function checkAborted(s: EvalState, node?: ASTNode): void {
  if (s.ctx.signal?.aborted) {
    const site: TypeHaltSite = {
      location: getNodeLocation(s, node),
      sourceId: s.ctx.sourceId,
      fn: 'checkAborted',
    };
    throwAbortHalt(site);
  }
}

/**
 * Check if the current pipe value matches any autoException pattern.
 * Only checks string values. Throws a non-catchable RuntimeHaltSignal
 * via throwAutoExceptionHalt on match.
 */
export function checkAutoExceptions(
  s: EvalState,
  value: RillValue,
  node?: ASTNode
): void {
  if (typeof value !== 'string' || s.ctx.autoExceptions.length === 0) {
    return;
  }

  for (const pattern of s.ctx.autoExceptions) {
    if (pattern.test(value)) {
      const site: TypeHaltSite = {
        location: getNodeLocation(s, node),
        sourceId: s.ctx.sourceId,
        fn: 'checkAutoExceptions',
      };
      throwAutoExceptionHalt(site, pattern.source, value);
    }
  }
}

/**
 * Wrap a promise with a timeout.
 * Returns original promise if no timeout configured.
 *
 * The pending timer is always cleared once the race settles — whether the
 * wrapped promise wins or the timeout fires — so a completed operation never
 * holds the event loop open waiting on a dead timer.
 *
 * On expiry the race rejects with a catchable `RuntimeHaltSignal` (atom
 * `RILL_R012`), so `guard { slow() }` and `retry { slow() }` can recover a
 * timeout the same way they recover any other operational halt.
 */
export function withTimeout<T>(
  s: EvalState,
  promise: Promise<T>,
  timeoutMs: number | undefined,
  functionName: string,
  node?: ASTNode
): Promise<T> {
  if (timeoutMs === undefined) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Build the catchable halt via throwCatchableHostHalt (which throws),
      // then forward it to reject so the race surfaces a RuntimeHaltSignal.
      try {
        throwCatchableHostHalt(
          {
            location: getNodeLocation(s, node),
            sourceId: s.ctx.sourceId,
            fn: functionName,
          },
          ERROR_ATOMS[ERROR_IDS.RILL_R012],
          `Function '${functionName}' timed out after ${timeoutMs}ms`,
          { functionName, timeoutMs }
        );
      } catch (haltSignal) {
        reject(haltSignal as Error);
      }
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

/** Fields a script may read from a stream: the iterator step protocol. */
export const STREAM_STEP_FIELDS: ReadonlySet<string> = new Set([
  'done',
  'value',
  'next',
]);

/** True for values whose fields scripts may read: plain dicts and streams. */
export function isFieldReceiver(
  value: RillValue
): value is Record<string, RillValue> {
  return isPlainDict(value) || isStream(value);
}

/**
 * Read an own field from a field receiver. Streams expose only the step
 * fields. Returns undefined for other values, other stream keys, and
 * inherited members.
 */
export function readOwnField(
  value: RillValue,
  key: string
): RillValue | undefined {
  if (!isFieldReceiver(value)) return undefined;
  return readValidatedField(value, key);
}

/** Read an own field from a value already confirmed by isFieldReceiver. */
function readValidatedField(
  value: Record<string, RillValue>,
  key: string
): RillValue | undefined {
  if (isStream(value) && !STREAM_STEP_FIELDS.has(key)) return undefined;
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

/**
 * Access a field on a dict value with property-style callable auto-invocation.
 * Shared by closures.ts, variables.ts, field-access.ts, and methods.ts for
 * consistent property access.
 *
 * @param s - Evaluator state
 * @param value - The dict to access
 * @param field - The field name
 * @param location - Source location for error reporting
 * @param allowMissing - If true, returns null for missing fields instead of throwing
 * @returns The field value
 * @throws RuntimeHaltSignal (catchable) if value is not a dict or field is
 *   missing (unless allowMissing)
 */
export async function accessDictField(
  s: EvalState,
  value: RillValue,
  field: string,
  location?: SourceLocation,
  allowMissing = false
): Promise<RillValue> {
  // Ordered values dispatch first: their JS wrapper object would otherwise
  // be read as a plain field holder. Iterator field reads (.done, .value,
  // .next) are plain dict reads and go through readOwnField below, which
  // also admits streams (step fields only) and rejects every other value.
  if (isOrdered(value)) {
    const entry = value.entries.find(([key]) => key === field);
    if (entry === undefined) {
      if (allowMissing) {
        return null;
      }
      throwCatchableHostHalt(
        { location, sourceId: s.ctx.sourceId, fn: 'accessDictField' },
        ERROR_ATOMS[ERROR_IDS.RILL_R009],
        `Undefined ordered key: ${field}`
      );
    }
    return entry[1];
  }

  if (!isFieldReceiver(value)) {
    if (allowMissing) {
      return null;
    }
    throwCatchableHostHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'accessDictField' },
      ERROR_ATOMS[ERROR_IDS.RILL_R003],
      `Cannot access field '${field}' on non-dict`
    );
  }

  // Receiver already validated above; read the own field directly.
  const dictValue = readValidatedField(value, field);

  // Check if field exists
  if (dictValue === undefined || dictValue === null) {
    if (allowMissing) {
      return null;
    }
    throwCatchableHostHalt(
      { location, sourceId: s.ctx.sourceId, fn: 'accessDictField' },
      ERROR_ATOMS[ERROR_IDS.RILL_R009],
      `Dict has no field '${field}'`
    );
  }

  // Property-style callable: auto-invoke when accessed
  if (isCallable(dictValue)) {
    if (dictValue.isProperty) {
      // ApplicationCallable: pass [dict] as args (no boundDict mechanism)
      // ScriptCallable: pass [] - dict is bound via boundDict -> pipeValue
      const args = dictValue.kind === 'script' ? [] : [value];
      return await invokeCallable(s, dictValue as RillCallable, args, location);
    }
  }

  return dictValue;
}

// setDictField lives in types/dict-keys.ts (a types-layer module with no
// EvalState dependency) so protocols/*.ts, constructors.ts, runtime.ts, and
// operations.ts can import it directly without reaching into eval/, which
// they must not depend on (see §NOD.2.1). Re-exported here so existing
// eval/handlers/* call sites keep importing it from this module.
export { setDictField } from '../types/dict-keys.js';
