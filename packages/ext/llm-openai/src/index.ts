/**
 * @rcrsr/rill-ext-openai
 *
 * Extension for OpenAI API integration with rill scripts.
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
export type { OpenAIExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createOpenAIExtension } from './factory.js';
