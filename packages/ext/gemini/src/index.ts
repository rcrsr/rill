/**
 * @rcrsr/rill-ext-gemini
 *
 * Extension for Google Gemini API integration with rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMProviderConfig as LLMExtensionConfig } from '@rcrsr/rill-ext-llm-shared';
export type { GeminiExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createGeminiExtension } from './factory.js';
