/**
 * StreamClosuresMixin: Stream creation, disposal, and inflight tracking
 *
 * Owns the stream lifecycle for script-defined stream closures:
 * - Stream creation from a ScriptCallable with a stream return type
 * - Scope-level stream tracking for disposal on scope exit (IR-14)
 * - Dispose error propagation: RuntimeError re-thrown directly; other errors
 *   wrapped as RILL-R002 (IR-14 fix, EC-9/EC-10)
 *
 * Methods added:
 * - invokeStreamClosure(closure, args, location) -> Promise<RillStream>  [IR-7]
 * - trackStream(stream) -> void                                           [IR-8]
 * - disposeStreams(streams) -> Promise<void>                              [IR-9]
 *
 * State:
 * - streamScopeStack: RillStream[][] — per-instance stack; no cross-instance
 *   contamination (AC-17)
 *
 * Cross-mixin dependencies (resolved at runtime via composition):
 * - createCallableContext(callable) — provided by ClosuresMixin
 * - evaluateBodyExpression(body) — provided by ControlFlowMixin (on bodyEvaluator)
 *
 * @internal
 */

import type { SourceLocation, BlockNode } from '../../../../types.js';
import { RuntimeError } from '../../../../types.js';
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
import { throwTypeHalt } from '../../types/halt.js';
import { getEvaluator } from '../evaluator.js';
import type { EvaluatorConstructor } from '../types.js';
import type { EvaluatorBase } from '../base.js';

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
  /** Push a yielded chunk value. Blocks until consumer pulls. */
  push(value: RillValue): Promise<void>;
  /** Pull the next chunk. Returns done:true when body completes. */
  pull(): Promise<
    { value: RillValue; done: false } | { value?: undefined; done: true }
  >;
  /** Signal body completion with a resolution value. */
  close(resolution: RillValue): void;
  /** Signal body failure with an error. */
  error(err: unknown): void;
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
  // Pending chunk waiting for consumer
  let pendingChunk:
    | {
        value: RillValue;
        resume: () => void;
      }
    | undefined;

  // Consumer waiting for a chunk
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

  // Terminal state
  let closed = false;
  let closedResolution: RillValue | undefined;
  let closedError: unknown | undefined;

  return {
    async push(value: RillValue): Promise<void> {
      if (closed) return;

      // If consumer is already waiting, deliver immediately
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ value, done: false });
        return;
      }

      // Otherwise, wait for consumer to pull
      return new Promise<void>((resolve) => {
        pendingChunk = { value, resume: resolve };
      });
    },

    async pull() {
      // If there's a pending chunk from the producer, consume it
      if (pendingChunk) {
        const chunk = pendingChunk;
        pendingChunk = undefined;
        chunk.resume(); // unblock producer
        return { value: chunk.value, done: false as const };
      }

      // If body already completed, return done
      if (closed) {
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
      closed = true;
      closedResolution = _resolution;
      // Wake up waiting consumer
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.resolve({ done: true });
      }
    },

    error(err: unknown): void {
      closed = true;
      closedError = err;
      // Wake up waiting consumer with error
      if (pendingPull) {
        const pull = pendingPull;
        pendingPull = undefined;
        pull.reject(err);
      }
    },

    /** Access cached resolution value after close(). */
    get resolution(): RillValue {
      return closedResolution ?? null;
    },
  } as StreamChannel & { readonly resolution: RillValue };
}

/**
 * Allows child evaluators (e.g. created by seq via getEvaluator(callableCtx)) to locate
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
// MIXIN FACTORY
// ============================================================

function createStreamClosuresMixin(Base: EvaluatorConstructor<EvaluatorBase>) {
  return class StreamClosuresEvaluator extends Base {
    /**
     * Stack of active stream lists for IR-14 scope exit cleanup.
     * Each entry represents a scope boundary. Streams are tracked in
     * creation order; disposed in reverse order on scope exit.
     */
    private streamScopeStack: RillStream[][] = [];

    /**
     * Override: push a stream scope, evaluate the block, then dispose any
     * unconsumed streams created inside it (IR-14).
     *
     * Co-located with `streamScopeStack` to keep all stream-lifecycle state
     * and overrides inside this mixin.
     */
    protected async evaluateBlock(node: BlockNode): Promise<RillValue> {
      this.streamScopeStack.push([]);
      try {
        // Base chain provides evaluateBlock via ControlFlowMixin; TypeScript
        // cannot see it through the mixin composition, so reach it via the
        // prototype chain rather than widening `super` to `any`.
        return await Object.getPrototypeOf(
          StreamClosuresEvaluator.prototype
        ).evaluateBlock.call(this, node);
      } finally {
        const streams = this.streamScopeStack.pop() ?? [];
        await this.disposeStreams(streams);
      }
    }

    /**
     * Track a stream in the current scope for cleanup on scope exit (IR-14).
     * Streams with dispose functions get cleaned up when their scope exits.
     */
    protected trackStream(stream: RillStream): void {
      const current = this.streamScopeStack[this.streamScopeStack.length - 1];
      if (current) {
        current.push(stream);
      }
    }

    /**
     * Dispose a list of unconsumed streams in reverse creation order (IR-14).
     * Propagates dispose errors as RILL-R002 — does not swallow.
     *
     * RuntimeError instances are re-thrown directly (IR-14 fix, EC-10).
     * Non-RuntimeError errors are wrapped as RILL-R002 (EC-9).
     *
     * Idempotent on empty arrays and repeated calls after stack drain.
     */
    protected async disposeStreams(streams: RillStream[]): Promise<void> {
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
            // Propagate dispose errors — do not swallow (IR-14)
            if (err instanceof RuntimeError) throw err;
            throw new RuntimeError(
              'RILL-R002',
              err instanceof Error ? err.message : String(err)
            );
          }
        }
      }
    }

    /**
     * Create a RillStream from a stream-typed ScriptCallable (IR-7).
     *
     * Initializes a callable context, marshals arguments, spins up a dedicated
     * body evaluator with an active stream channel, and returns a lazy
     * RillStream whose async generator pulls from that channel.
     *
     * Error contracts:
     * - Chunk type mismatch at yield → TYPE_MISMATCH (validated by evaluateYield)
     * - Resolution type mismatch → TYPE_MISMATCH
     * - Body RillError preserved with original code; dispose runs before re-throw (EC-8/AC-13)
     */
    protected async invokeStreamClosure(
      callable: ScriptCallable,
      args: RillValue[],
      callLocation?: SourceLocation
    ): Promise<RillValue> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callableCtx = (this as any).createCallableContext(callable);

      // Marshal positional args to named record (IC-1).
      const record = marshalArgs(args, callable.params, {
        functionName: '<anonymous>',
        location: callLocation,
      });

      // Bind each named value into the callable context.
      for (const [name, value] of Object.entries(record)) {
        callableCtx.variables.set(name, value);
      }

      // IR-4: Block closure pipe sync
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

      // Create a dedicated evaluator for the stream body so that concurrent
      // execution of the body IIFE and the outer consumer (e.g. outer seq)
      // never share mutable state (this.ctx, this.activeStreamChannel).
      //
      // getEvaluator creates new Evaluator(callableCtx) and caches it under
      // callableCtx — this is also the registration so inner builtins like seq
      // that call getEvaluator(callableCtx) receive the body evaluator (with
      // activeStreamChannel set) rather than a fresh one.
      const bodyEvaluator = getEvaluator(callableCtx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bodyEvaluator as any).activeStreamChannel = channel;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (bodyEvaluator as any).activeStreamChunkType =
        streamStructure.chunk ?? null;

      // Start body execution asynchronously.
      // The body runs concurrently with consumption, blocking at each yield
      // until the consumer pulls the next chunk.
      // bodyEvaluator.ctx is already callableCtx (set by its constructor).
      // No mutations to this.ctx or this.activeStreamChannel are made here.
      const bodyPromise = (async () => {
        // activeStreamContexts allows rare nested cases where a host function
        // creates a fresh evaluator via getEvaluator(someChildCtx) and yields.
        activeStreamContexts.set(callableCtx, {
          channel,
          chunkType: streamStructure.chunk ?? null,
        });
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (bodyEvaluator as any).evaluateBodyExpression(
            callable.body
          );
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

      // Build the RillStream (IR-13)
      const stream = createRillStream({
        chunks: generateChunks(),
        resolve: async () => {
          // Wait for body to complete
          await bodyPromise.catch(() => {});
          return channel.resolution;
        },
        chunkType: streamStructure.chunk,
        retType: streamStructure.ret,
      });

      return stream;
    }
  };
}

// Export with type assertion to work around TS4094 limitation
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const StreamClosuresMixin = createStreamClosuresMixin as any;
