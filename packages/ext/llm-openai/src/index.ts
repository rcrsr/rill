/**
 * @rcrsr/rill-ext-openai
 *
 * Extension for OpenAI API integration with rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMProviderConfig as LLMExtensionConfig } from '@rcrsr/rill-ext-llm-shared';
export type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createOpenAIExtension } from './factory.js';
