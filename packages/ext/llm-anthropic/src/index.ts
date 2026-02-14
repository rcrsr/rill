/**
 * @rcrsr/rill-ext-anthropic
 *
 * Extension for Anthropic Claude API integration with rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMProviderConfig as LLMExtensionConfig } from '@rcrsr/rill-ext-llm-shared';
export type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createAnthropicExtension } from './factory.js';
