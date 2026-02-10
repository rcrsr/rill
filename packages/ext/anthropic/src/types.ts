/**
 * Type definitions for Anthropic extension.
 * Defines configuration, message types, and result structures.
 */

import type { LLMProviderConfig } from '@rcrsr/rill-ext-llm-shared';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Anthropic extension.
 * Re-exports LLMProviderConfig from shared package.
 */
export type AnthropicExtensionConfig = LLMProviderConfig;
