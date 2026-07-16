import type { RuntimeContext } from '../types/runtime.js';
import type {
  TypeStructure,
  RillValue,
  RillStream,
} from '../types/structures.js';
import type { StreamChannel } from './invocation/stream-closures.js';
import type { CallableInvocationStrategy } from './invocation/callable-strategy.js';

/**
 * EvalState — the shared evaluation state threaded through all module-level
 * eval functions.
 *
 * Concrete data shape (no methods): `ctx` plus the per-context mutable
 * fields formerly held on the composed Evaluator instance.
 */
export interface EvalState {
  ctx: RuntimeContext;
  activeStreamChannel:
    | (StreamChannel & { readonly resolution: RillValue })
    | null;
  activeStreamChunkType: TypeStructure | null;
  streamScopeStack: RillStream[][];
  invocationStrategy: CallableInvocationStrategy | undefined;
}

/**
 * WeakMap cache of EvalState per RuntimeContext.
 *
 * Key: RuntimeContext object reference
 * Value: EvalState for that context
 *
 * Cache eviction happens automatically when the RuntimeContext is
 * garbage collected, since WeakMap keys don't prevent GC.
 */
const evalStateCache = new WeakMap<RuntimeContext, EvalState>();

/**
 * Get or create the EvalState for a given RuntimeContext.
 *
 * EvalState instances are cached per context to avoid recreating the same
 * state multiple times during script execution.
 *
 * @param ctx - The runtime context
 * @returns EvalState (cached or newly created)
 *
 * @internal — not exported from packages/core/src/index.ts.
 */
export function getEvalState(ctx: RuntimeContext): EvalState {
  let state = evalStateCache.get(ctx);
  if (!state) {
    state = {
      ctx,
      activeStreamChannel: null,
      activeStreamChunkType: null,
      streamScopeStack: [],
      invocationStrategy: undefined,
    };
    evalStateCache.set(ctx, state);
  }
  return state;
}
