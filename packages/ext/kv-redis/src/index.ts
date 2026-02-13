/**
 * @rcrsr/rill-ext-kv-redis
 *
 * Redis kv backend implementation for rill scripting language.
 *
 * @packageDocumentation
 */

export type {
  RedisKvMountConfig,
  RedisKvConfig,
  SchemaEntry,
} from './types.js';
export { createRedisKvExtension } from './factory.js';
