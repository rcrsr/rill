/**
 * Shared LLM Extension Package
 *
 * Provides common types, validation, error handling, and tool orchestration
 * for all LLM provider extensions (OpenAI, Anthropic, Google Gemini).
 */

// ============================================================
// TYPES
// ============================================================
export type {
  LLMExtensionConfig,
  LLMProviderConfig,
  ProviderErrorDetector,
  ToolLoopCallbacks,
  ToolLoopResult,
} from './types.js';

// ============================================================
// VALIDATION
// ============================================================
export {
  MIN_TEMPERATURE,
  MAX_TEMPERATURE,
  validateApiKey,
  validateModel,
  validateTemperature,
  validateMessages,
  validateEmbedText,
  validateEmbedBatch,
  validateEmbedModel,
} from './validation.js';

// ============================================================
// ERROR MAPPING
// ============================================================
export { mapProviderError } from './errors.js';

// ============================================================
// TOOL ORCHESTRATION
// ============================================================
export { executeToolLoop } from './tool-loop.js';
