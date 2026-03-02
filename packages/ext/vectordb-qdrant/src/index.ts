import type { ExtensionConfigSchema } from '@rcrsr/rill';

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// CONFIGURATION
// ============================================================
export type { QdrantConfig, QdrantExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createQdrantExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  url: { type: 'string', required: true },
  apiKey: { type: 'string', secret: true },
  collection: { type: 'string', required: true },
  dimensions: { type: 'number' },
  distance: { type: 'string' },
  timeout: { type: 'number' },
};
