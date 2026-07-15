import type { EvaluatorInterface } from './interface.js';

/**
 * Transitional alias. During the function migration, EvalState is the full
 * evaluator surface, so converted functions can call unconverted class
 * methods as s.method(...). Phase 6 collapses this to:
 *   { ctx, activeStreamChannel, activeStreamChunkType, streamScopeStack }
 */
export type EvalState = EvaluatorInterface;
