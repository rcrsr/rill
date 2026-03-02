/**
 * ChromaDB extension for rill.
 * Provides vector database operations using ChromaDB.
 */

import type { ExtensionConfigSchema } from '@rcrsr/rill';

// ============================================================
// PUBLIC TYPES
// ============================================================
export type { ChromaConfig, ChromaExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createChromaExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  url: { type: 'string' },
  collection: { type: 'string', required: true },
  embeddingFunction: { type: 'string' },
  timeout: { type: 'number' },
};

// ============================================================
// VERSION
// ============================================================
export const CHROMA_EXTENSION_VERSION = '0.0.1';
