/**
 * Type definitions for OpenAI extension.
 * Defines configuration, message types, and result structures.
 */

import type { LLMProviderConfig } from '@rcrsr/rill-ext-llm-shared';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for OpenAI extension.
 * Re-exports LLMProviderConfig from shared package.
 */
export type OpenAIExtensionConfig = LLMProviderConfig;
