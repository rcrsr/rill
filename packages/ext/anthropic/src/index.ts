/**
 * @rcrsr/rill-ext-anthropic
 *
 * Extension for Anthropic Claude API integration with rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.7.2';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMExtensionConfig, AnthropicExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createAnthropicExtension } from './factory.js';
