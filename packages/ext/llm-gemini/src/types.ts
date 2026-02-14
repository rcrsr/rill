/**
 * Type definitions for Google extension.
 * Defines configuration, message types, and result structures.
 */

import type { LLMProviderConfig } from '@rcrsr/rill-ext-llm-shared';

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * Configuration options for Google extension.
 * Re-exports LLMProviderConfig from shared package.
 */
export type GeminiExtensionConfig = LLMProviderConfig;
