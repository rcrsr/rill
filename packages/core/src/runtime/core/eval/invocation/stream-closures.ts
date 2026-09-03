/**
 * Stream creation, disposal, and inflight tracking
 *
 * Owns the stream lifecycle for script-defined stream closures:
 * - Stream creation from a ScriptCallable with a stream return type
 * - Scope-level stream tracking for disposal on scope exit
 * - Dispose error propagation: halt and control signals re-thrown directly;
 *   other errors wrapped as catchable RILL_R002 halts
 *
 * Methods added:
 * - invokeStreamClosure(closure, args, location) -> Promise<RillStream>
 * - trackStream(stream) -> void
 * - disposeStreams(streams) -> Promise<void>
 *
 * State:
 * - streamScopeStack: RillStream[][] — per-instance stack; no cross-instance
 *   contamination
 *
 * Cross-module dependencies:
 * - createCallableContext(callable) — provided by closures.ts
 * - evaluateBodyExpression(body) — provided by control-flow.ts (on the body evaluator state)
 *
 * @internal
 */

import type { SourceLocation } from '../../../../types.js';
import { ControlSignal } from '../../signals.js';
import { RuntimeHaltSignal } from '../../types/halt.js';
import type { ScriptCallable } from '../../callable.js';
import { marshalArgs } from '../../callable.js';
import type { RuntimeContext } from '../../types/runtime.js';
import type {
  RillValue,
  RillStream,
  TypeStructure,
} from '../../types/structures.js';
import { inferType } from '../../types/registrations.js';
import { structureMatches, formatStructure } from '../../types/operations.js';
import { createRillStream } from '../../types/constructors.js';
import { ReturnSignal } from '../../signals.js';
import { throwFatalHostHalt, throwTypeHalt } from '../../types/halt.js';
import { getEvalState } from '../state.js';
import type { EvalState } from '../state.js';
import { evaluateBodyExpression } from '../handlers/control-flow.js';
import { createCallableContext } from '../handlers/closures.js';
import { ERROR_IDS, ERROR_ATOMS } from '../../../../error-registry.js';

// ============================================================
// STREAM CHANNEL INTERNALS
// These helpers are co-located with invokeStreamClosure because
// they exist solely to support stream body ↔ generator handoff.
// ============================================================

/**
 * Rendezvous channel for stream closure body ↔ async generator communication.
 * The body pushes yielded values; the generator pulls them one at a time.
 * Backpressure: push() blocks until the consumer calls pull().
 *
 * @internal
 */
export interface StreamChannel {
  /**
   * Push a yielded chunk value. The returned promise resolves when this
   * specific chunk is consumed by a pull (or immediately once the channel
   * is terminated). Chunks are delivered FIFO, so concurrent pushes (e.g.
   * from `fan`) are each queued and delivered in turn rather than
   * overwriting one another.
   */
  push(value: RillValue): Promise<void>;
  /** Pull the next chunk. Returns done:true when body completes. */
  pull(): Promise<
    { value: RillValue; done: false } | { value?: undefined; done: true }
  >;
  /** Signal body completion with a resolution value. */
  close(resolution: RillValue): void;
  /** Signal body failure with an error. */
  error(err: unknown): void;
  /**
   * Stop the channel without recording a resolution. Any parked push()
   * promises resolve immediately and any future push() returns at once, so a
   * body suspended at a yield can run to completion. Used by the resolve path
   * and by scope-exit disposal to unblock a partially consumed body.
   */
  cancel(): void;
}

/**
 * Create a rendezvous channel for stream chunk handoff.
 *
 * Producer (body) calls push() which blocks until consumer calls pull().
 * Consumer (async generator) calls pull() which blocks until producer pushes.
 * close() and error() signal body termination.
 *
 * @internal
 */
function createStreamChannel(): StreamChannel {
  // FIFO queue of chunks pushed but not yet pulled. Each entry carries the
  // resume callback that resolves the originating push() promise once the
  // chunk is consumed. A queue (rather than a single slot) is what lets
  // concurrent producers — e.g. the parallel bodies of `fan` — each deliver a
  // chunk instead of overwriting one another and losing all but the last.
  const queue: { value: RillValue; resume: () => void }[] = [];

  // Consumer waiting for a chunk. There is only ever one consumer (the async
  // generator), so a single slot suffices.
  let pendingPull:
    | {
        resolve: (
          result:
            | { value: RillValue; done: false }
            | { value?: undefined; done: true }
        ) => void;
        reject: (err: unknown) => void;
      }
    | undefined;

  // `terminated` tells producers to stop blocking: set by close(), error(),
  // and cancel(). `settled` tracks whether a terminal resolution/error has
  // been recorded, so a cancel() that unblocks the body does not stop the
  // body's own close()/error() from recording its result.
  let terminated = false;
  let settled = false;
  let closedResolution: RillValue | undefined;
  let closedError: unknown | undefined;

  return {
    async push(value: RillValue): Promise<void> {
      // Once terminated, further chunks are discarded and the push resolves
      // immediately so a suspended body can run to completion.
      if (terminated) return;

      return new Promise<void>((resolve) => {
        // If a consumer is already waiting, deliver immediately; the chunk is
        // consumed the moment it is handed over, so resolve the push too.
        if (pendingPull) {
          const pull = pendingPull;
          pendingPull = undefined;
          pull.resolve({ value, done: false });
          resolve();
          return;
        }
        // Otherwise queue the chunk; resume fires when a pull consumes it.
        queue.push({ value, resume: resolve });
      });
    },

    async pull() {
      // Deliver the oldest queued chunk, unblocking its producer.
      if (queue.length > 0) {
        const chunk = queue.shift()!;
        chunk.resume(); // unblock producer
        return { value: chunk.value, done: false as const };
      }

      // No queued chunks and the body has terminated: surface error or done.
      if (terminated) {
        if (closedError !== undefined) throw closedError;
        return { done: true as const };
      }

      // Wait for producer to push
      return new Promise<
        { value: RillValue; done: false } | { value?: undefined; done: true }
      >((resolve, reject) => {
        pendingPull = { resolve, reject };
      });
    },

    close(_resolution: RillValue): void {
      if (settled) return;
      settled = true;
      closedResolution = _resolution;
      terminated = true;
      // Wake up waiting consumer
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ done: true });
      }
    },

    error(err: unknown): void {
      if (settled) return;
      settled = true;
      closedError = err;
      terminated = true;
      // Wake up waiting consumer with error
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.reject(err);
      }
    },

    cancel(): void {
      terminated = true;
      // Unblock every parked producer so a suspended body can finish.
      while (queue.length > 0) {
        queue.shift()!.resume();
      }
      // Wake a waiting consumer with done (no more chunks are coming).
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ done: true });
      }
    },

    /** Access cached resolution value after close(). */
    get resolution(): RillValue {
      return closedResolution ?? null;
    },
  } as StreamChannel & { readonly resolution: RillValue };
}

/**
 * Allows child EvalState (e.g. created by seq via getEvalState(callableCtx)) to locate
 * the active stream channel by walking the RuntimeContext parent chain.
 * Populated by invokeStreamClosure for the duration of the stream body execution.
 */
export const activeStreamContexts = new WeakMap<
  RuntimeContext,
  {
    channel: StreamChannel & { readonly resolution: RillValue };
    chunkType: TypeStructure | null;
  }
>();

// ============================================================
// MODULE FUNCTIONS
// ============================================================

/**
 * Push a stream scope, run `body(s, arg)`, then dispose any unconsumed
 * streams created inside it.
 *
 * `arg` is threaded through to `body` instead of captured in a closure, so
 * callers on hot paths (e.g. `evaluateBlock`) can pass a plain function
 * reference without allocating a per-call arrow function.
 *
 * Reads/writes the class-field `streamScopeStack` on `s`; never allocates
 * a fresh local stack (streamScopeStack is owned by StreamClosuresEvaluator).
 */
export async function runInStreamScope<T, A>(
  s: EvalState,
  arg: A,
  body: (s: EvalState, arg: A) => Promise<T>
): Promise<T> {
  s.streamScopeStack.push([]);
  try {
    return await body(s, arg);
  } finally {
    const streams = s.streamScopeStack.pop() ?? [];
    await disposeStreams(s, streams);
  }
}

/**
 * Track a stream in the current scope for cleanup on scope exit.
 * Streams with dispose functions get cleaned up when their scope exits.
 */
export function trackStream(s: EvalState, stream: RillStream): void {
  const current = s.streamScopeStack[s.streamScopeStack.length - 1];
  if (current) {
    current.push(stream);
  }
}

/**
 * Dispose a list of unconsumed streams in reverse creation order.
 * Propagates dispose errors as RILL_R002 — does not swallow.
 *
 * Halt and control signals are re-thrown directly.
 * Other errors are wrapped as a fatal host halt (RILL_R002): dispose
 * failures are not user-recoverable and must not be swallowed by guard/retry,
 * matching the lifecycle policy in collections.ts:expandStream.
 *
 * Idempotent on empty arrays and repeated calls after stack drain.
 */
async function disposeStreams(
  s: EvalState,
  streams: RillStream[]
): Promise<void> {
  for (let i = streams.length - 1; i >= 0; i--) {
    const stream = streams[i]!;
    // Only dispose streams that are not fully consumed
    if (stream.done) continue;
    const disposeFn = (
      stream as unknown as Record<string, (() => void) | undefined>
    )['__rill_stream_dispose'];
    if (typeof disposeFn === 'function') {
      try {
        disposeFn();
      } catch (err) {
        // Propagate dispose errors — do not swallow
        if (err instanceof RuntimeHaltSignal || err instanceof ControlSignal) {
          throw err;
        }
        throwFatalHostHalt(
          { sourceId: s.ctx.sourceId, fn: 'disposeStreams' },
          ERROR_ATOMS[ERROR_IDS.RILL_R002],
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
}

/**
 * Create a RillStream from a stream-typed ScriptCallable.
 *
 * Initializes a callable context, marshals arguments, spins up a dedicated
 * body evaluator with an active stream channel, and returns a lazy
 * RillStream whose async generator pulls from that channel.
 *
 * Error contracts:
 * - Chunk type mismatch at yield → TYPE_MISMATCH (validated by evaluateYield)
 * - Resolution type mismatch → TYPE_MISMATCH
 * - Body RillError preserved with original code; dispose runs before re-throw
 */
export async function invokeStreamClosure(
  s: EvalState,
  callable: ScriptCallable,
  args: RillValue[],
  callLocation?: SourceLocation
): Promise<RillValue> {
  const callableCtx = createCallableContext(s, callable);

  // Marshal positional args to named record.
  const record = marshalArgs(args, callable.params, {
    functionName: '<anonymous>',
    location: callLocation,
  });

  // Bind each named value into the callable context.
  for (const [name, value] of Object.entries(record)) {
    callableCtx.variables.set(name, value);
  }

  // Block closure pipe sync
  if (callable.params[0]?.name === '$') {
    callableCtx.pipeValue = record['$']!;
  }

  // Extract chunk and ret types from the stream structure
  const streamStructure = callable.returnType.structure as {
    kind: 'stream';
    chunk?: TypeStructure;
    ret?: TypeStructure;
  };

  // Create channel and async generator for lazy body execution
  const channel = createStreamChannel() as StreamChannel & {
    readonly resolution: RillValue;
  };

  // Create a dedicated EvalState for the stream body so that concurrent
  // execution of the body IIFE and the outer consumer (e.g. outer seq)
  // never share mutable state (state.ctx, state.activeStreamChannel).
  //
  // getEvalState creates a fresh EvalState and caches it under callableCtx —
  // this is also the registration so inner builtins like seq that call
  // getEvalState(callableCtx) receive the body state (with
  // activeStreamChannel set) rather than a fresh one.
  const bodyEvaluator = getEvalState(callableCtx);
  bodyEvaluator.activeStreamChannel = channel;
  bodyEvaluator.activeStreamChunkType = streamStructure.chunk ?? null;

  // Start body execution asynchronously.
  // The body runs concurrently with consumption, blocking at each yield
  // until the consumer pulls the next chunk.
  // bodyEvaluator.ctx is already callableCtx (set at construction).
  // No mutations to this.ctx or this.activeStreamChannel are made here.
  const bodyPromise = (async () => {
    // activeStreamContexts allows rare nested cases where a host function
    // creates a fresh EvalState via getEvalState(someChildCtx) and yields.
    activeStreamContexts.set(callableCtx, {
      channel,
      chunkType: streamStructure.chunk ?? null,
    });
    try {
      const result = await evaluateBodyExpression(bodyEvaluator, callable.body);
      // Validate resolution type if declared
      if (streamStructure.ret !== undefined) {
        if (!structureMatches(result, streamStructure.ret)) {
          const expected = formatStructure(streamStructure.ret);
          const actual = inferType(result);
          throwTypeHalt(
            {
              location: callLocation,
              sourceId: callableCtx.sourceId,
              fn: 'stream-resolve',
            },
            'TYPE_MISMATCH',
            `Stream resolution type mismatch: expected ${expected}, got ${actual}`,
            'runtime',
            { expected, actual }
          );
        }
      }
      channel.close(result);
    } catch (error) {
      if (error instanceof ReturnSignal) {
        // return in stream body sets resolution value
        const result = error.value;
        if (streamStructure.ret !== undefined) {
          if (!structureMatches(result, streamStructure.ret)) {
            const expected = formatStructure(streamStructure.ret);
            const actual = inferType(result);
            try {
              throwTypeHalt(
                {
                  location: callLocation,
                  sourceId: callableCtx.sourceId,
                  fn: 'stream-resolve',
                },
                'TYPE_MISMATCH',
                `Stream resolution type mismatch: expected ${expected}, got ${actual}`,
                'runtime',
                { expected, actual }
              );
            } catch (haltErr) {
              channel.error(haltErr);
            }
            return;
          }
        }
        channel.close(result);
      } else {
        channel.error(error);
      }
    } finally {
      activeStreamContexts.delete(callableCtx);
    }
  })();

  // Create async generator that pulls from the channel
  async function* generateChunks(): AsyncGenerator<RillValue> {
    try {
      while (true) {
        const result = await channel.pull();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      // Ensure body promise settles to prevent unhandled rejections
      await bodyPromise.catch(() => {});
    }
  }

  // Build the RillStream
  const stream = createRillStream({
    chunks: generateChunks(),
    resolve: async () => {
      // A partially consumed body may be suspended inside push(), waiting for
      // a pull that will never come. Cancel the channel so that park resolves
      // and the body runs to its resolution (close/error), then await it.
      channel.cancel();
      await bodyPromise.catch(() => {});
      return channel.resolution;
    },
    dispose: () => {
      // Scope-exit disposal of an unconsumed stream: unblock any suspended
      // body so it can settle rather than leaking a parked push().
      channel.cancel();
    },
    chunkType: streamStructure.chunk,
    retType: streamStructure.ret,
  });

  return stream;
}
