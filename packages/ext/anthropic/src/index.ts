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

export type { LLMExtensionConfig, AnthropicExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createAnthropicExtension } from './factory.js';
