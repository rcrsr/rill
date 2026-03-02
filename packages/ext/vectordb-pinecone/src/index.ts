import type { ExtensionConfigSchema } from '@rcrsr/rill';

// ============================================================
// VERSION
// ============================================================

export const VERSION = '0.0.1';

// ============================================================
// CONFIGURATION
// ============================================================
export type { PineconeConfig, PineconeExtensionConfig } from './types.js';

// ============================================================
// FACTORY
// ============================================================
export { createPineconeExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================
export const configSchema: ExtensionConfigSchema = {
  apiKey: { type: 'string', required: true, secret: true },
  index: { type: 'string', required: true },
  namespace: { type: 'string' },
  timeout: { type: 'number' },
};
