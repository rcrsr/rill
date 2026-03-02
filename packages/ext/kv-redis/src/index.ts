/**
 * @rcrsr/rill-ext-kv-redis
 *
 * Redis kv backend implementation for rill scripting language.
 *
 * @packageDocumentation
 */

import type { ExtensionConfigSchema } from '@rcrsr/rill';

export type {
  RedisKvMountConfig,
  RedisKvConfig,
  SchemaEntry,
} from './types.js';
export { createRedisKvExtension } from './factory.js';

// ============================================================
// CONFIG SCHEMA
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  url: { type: 'string', required: true, secret: true },
  mounts: { type: 'string' },
};
