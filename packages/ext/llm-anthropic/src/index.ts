/**
 * @rcrsr/rill-ext-anthropic
 *
 * Extension for Anthropic Claude API integration with rill scripts.
 */

import type { ExtensionConfigSchema } from '@rcrsr/rill';

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  api_key: { type: 'string', required: true, secret: true },
  model: { type: 'string', required: true },
  base_url: { type: 'string' },
  temperature: { type: 'number' },
  max_tokens: { type: 'number' },
  timeout: { type: 'number' },
  max_retries: { type: 'number' },
  system: { type: 'string' },
  embed_model: { type: 'string' },
};

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMProviderConfig as LLMExtensionConfig } from '@rcrsr/rill-ext-llm-shared';
export type { AnthropicExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createAnthropicExtension } from './factory.js';
