/**
 * Invocation module barrel
 *
 * Re-exports the argument binding and callable invocation strategy used
 * by the evaluator's invocation pipeline.
 *
 * @internal
 */

// ============================================================
// ARGUMENT BINDING
// ============================================================
export type { BoundArguments } from './arguments-binder.js';
export { ArgumentsBinder } from './arguments-binder.js';

// ============================================================
// CALLABLE INVOCATION STRATEGY
// ============================================================
export { CallableInvocationStrategy } from './callable-strategy.js';

// ============================================================
// STREAM CLOSURES
// ============================================================
export { activeStreamContexts } from './stream-closures.js';
export type { StreamChannel } from './stream-closures.js';
