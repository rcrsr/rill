/**
 * ChromaDB extension for rill.
 * Provides vector database operations using ChromaDB.
 */

// ============================================================
// PUBLIC TYPES
// ============================================================
export type { ChromaConfig, ChromaExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createChromaExtension } from './factory.js';

// ============================================================
// VERSION
// ============================================================
export const CHROMA_EXTENSION_VERSION = '0.0.1';
