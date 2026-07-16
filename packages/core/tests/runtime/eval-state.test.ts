/**
 * Rill Runtime Tests: EvalState cache and annotation module functions
 *
 * Covers:
 * - getEvalState caches one EvalState instance per RuntimeContext (required
 *   for stream concurrency: a fresh object per call would silently reset
 *   activeStreamChannel/activeStreamChunkType/streamScopeStack between reads).
 * - getEvalState returns distinct state per RuntimeContext.
 * - Initial EvalState field values on first creation.
 * - getAnnotation reads from ctx.annotationStack.
 * - getIterationLimit floors fractional operator-level limits and falls
 *   back to the default for non-positive/non-numeric limits.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeContext } from '@rcrsr/rill';
import { getEvalState } from '../../src/runtime/core/eval/state.js';
import {
  getAnnotation,
  getIterationLimit,
} from '../../src/runtime/core/eval/handlers/annotations.js';

describe('getEvalState', () => {
  it('returns the same EvalState instance for the same context', () => {
    const ctx = createRuntimeContext();

    const first = getEvalState(ctx);
    const second = getEvalState(ctx);

    expect(first).toBe(second);
  });

  it('returns distinct EvalState instances for distinct contexts', () => {
    const ctxA = createRuntimeContext();
    const ctxB = createRuntimeContext();

    const stateA = getEvalState(ctxA);
    const stateB = getEvalState(ctxB);

    expect(stateA).not.toBe(stateB);
  });

  it('initializes fields to their default values', () => {
    const ctx = createRuntimeContext();

    const state = getEvalState(ctx);

    expect(state.ctx).toBe(ctx);
    expect(state.activeStreamChannel).toBeNull();
    expect(state.activeStreamChunkType).toBeNull();
    expect(state.streamScopeStack).toEqual([]);
  });

  it('gives each context its own streamScopeStack array reference', () => {
    const ctxA = createRuntimeContext();
    const ctxB = createRuntimeContext();

    const stateA = getEvalState(ctxA);
    const stateB = getEvalState(ctxB);

    expect(stateA.streamScopeStack).not.toBe(stateB.streamScopeStack);
  });
});

describe('getAnnotation', () => {
  it('retrieves annotation value from stack', () => {
    const ctx = createRuntimeContext();
    ctx.annotationStack.push({ limit: 100, custom: 'value' });
    const state = getEvalState(ctx);

    expect(getAnnotation(state, 'limit')).toBe(100);
    expect(getAnnotation(state, 'custom')).toBe('value');
    expect(getAnnotation(state, 'missing')).toBeUndefined();
  });

  it('returns undefined when annotation stack is empty', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getAnnotation(state, 'limit')).toBeUndefined();
  });

  it('returns value from top of stack when multiple scopes exist', () => {
    const ctx = createRuntimeContext();
    ctx.annotationStack.push({ limit: 100 });
    ctx.annotationStack.push({ limit: 50 });
    const state = getEvalState(ctx);

    expect(getAnnotation(state, 'limit')).toBe(50);
  });
});

describe('getIterationLimit', () => {
  it('returns default when no operator-level annotations are given', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getIterationLimit(state)).toBe(10000);
  });

  it('returns the operator-level limit when set', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getIterationLimit(state, { limit: 100 })).toBe(100);
  });

  it('floors fractional limits', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getIterationLimit(state, { limit: 100.7 })).toBe(100);
  });

  it('returns default for non-positive limits', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getIterationLimit(state, { limit: 0 })).toBe(10000);
    expect(getIterationLimit(state, { limit: -5 })).toBe(10000);
  });

  it('returns default for non-numeric limits', () => {
    const ctx = createRuntimeContext();
    const state = getEvalState(ctx);

    expect(getIterationLimit(state, { limit: 'not a number' })).toBe(10000);
  });
});
