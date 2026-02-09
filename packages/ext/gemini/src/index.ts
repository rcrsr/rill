/**
 * @rcrsr/rill-ext-gemini
 *
 * Extension for Google Gemini API integration with rill scripts.
 */

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.7.2';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export type { LLMExtensionConfig, GeminiExtensionConfig } from './types.js';

// ============================================================
// EXTENSION FACTORY
// ============================================================

export { createGeminiExtension } from './factory.js';
