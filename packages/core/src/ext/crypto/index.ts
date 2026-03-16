/**
 * Crypto Extension Factory
 *
 * Provides cryptographic functions via thin wrapper around node:crypto.
 * Functions: hash, hmac, uuid, random
 */

import crypto from 'node:crypto';
import { RuntimeError } from '../../error-classes.js';
import type {
  ExtensionFactoryResult,
  ExtensionConfigSchema,
  ExtensionManifest,
} from '../../runtime/ext/extensions.js';
import { toCallable } from '../../runtime/core/callable.js';
import {
  rillTypeToTypeValue,
  type RillValue,
} from '../../runtime/core/values.js';

// ============================================================
// TYPES
// ============================================================

export const configSchema: ExtensionConfigSchema = {
  defaultAlgorithm: { type: 'string' },
  hmacKey: { type: 'string', secret: true },
};

/** Crypto extension configuration */
export interface CryptoConfig {
  /** Default hash algorithm (default: 'sha256') */
  defaultAlgorithm?: string | undefined;
  /** HMAC key (required only if hmac() used) */
  hmacKey?: string | undefined;
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create crypto extension with hashing and random generation.
 *
 * Returns 4 functions: hash, hmac, uuid, random.
 *
 * @param config - Crypto configuration
 * @returns ExtensionFactoryResult with 4 crypto functions
 *
 * @example
 * ```typescript
 * const cryptoExt = createCryptoExtension({
 *   defaultAlgorithm: 'sha256',
 *   hmacKey: 'secret'
 * });
 * ```
 */
export function createCryptoExtension(
  config: CryptoConfig = {}
): ExtensionFactoryResult {
  const defaultAlgorithm = config.defaultAlgorithm ?? 'sha256';
  const hmacKey = config.hmacKey;

  // Get supported hash algorithms from crypto module
  const supportedAlgorithms = new Set(crypto.getHashes());

  // ============================================================
  // HELPERS
  // ============================================================

  /** Validate algorithm is supported */
  function validateAlgorithm(algorithm: string): void {
    if (!supportedAlgorithms.has(algorithm)) {
      // EC-27: Invalid algorithm
      throw new RuntimeError(
        'RILL-R004',
        `unsupported algorithm: ${algorithm}`,
        undefined,
        { algorithm, supported: Array.from(supportedAlgorithms) }
      );
    }
  }

  // ============================================================
  // FUNCTIONS
  // ============================================================

  /**
   * Hash content with specified or default algorithm.
   * IR-23
   */
  const hash = async (args: Record<string, RillValue>): Promise<string> => {
    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;

    // EC-27: Invalid algorithm
    validateAlgorithm(algorithm);

    const hashObject = crypto.createHash(algorithm);
    hashObject.update(input);
    return hashObject.digest('hex');
  };

  /**
   * Generate HMAC signature.
   * IR-24, EC-26 (missing hmacKey)
   */
  const hmac = async (args: Record<string, RillValue>): Promise<string> => {
    // EC-26: hmacKey missing
    if (!hmacKey) {
      throw new RuntimeError(
        'RILL-R004',
        'hmacKey required for hmac() — set in config',
        undefined,
        {}
      );
    }

    const input = args['input'] as string;
    const algorithm =
      (args['algorithm'] as string | undefined) ?? defaultAlgorithm;

    // EC-27: Invalid algorithm
    validateAlgorithm(algorithm);

    const hmacObject = crypto.createHmac(algorithm, hmacKey);
    hmacObject.update(input);
    return hmacObject.digest('hex');
  };

  /**
   * Generate random UUID v4.
   * IR-25
   */
  const uuid = async (): Promise<string> => {
    return crypto.randomUUID();
  };

  /**
   * Generate random bytes as hex string.
   * IR-26
   */
  const random = async (args: Record<string, RillValue>): Promise<string> => {
    const bytes = args['bytes'] as number;
    return crypto.randomBytes(bytes).toString('hex');
  };

  // ============================================================
  // EXTENSION RESULT
  // ============================================================

  return {
    value: {
      hash: toCallable({
        params: [
          {
            name: 'input',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Content to hash' },
          },
          {
            name: 'algorithm',
            type: { kind: 'string' },
            defaultValue: defaultAlgorithm,
            annotations: { description: 'Hash algorithm' },
          },
        ],
        fn: hash,
        annotations: { description: 'Hash content, returns hex output' },
        returnType: rillTypeToTypeValue({ kind: 'string' }),
      }),
      hmac: toCallable({
        params: [
          {
            name: 'input',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: { description: 'Content to authenticate' },
          },
          {
            name: 'algorithm',
            type: { kind: 'string' },
            defaultValue: defaultAlgorithm,
            annotations: { description: 'Hash algorithm' },
          },
        ],
        fn: hmac,
        annotations: {
          description: 'Generate HMAC signature, returns hex output',
        },
        returnType: rillTypeToTypeValue({ kind: 'string' }),
      }),
      uuid: toCallable({
        params: [],
        fn: uuid,
        annotations: { description: 'Generate random UUID v4' },
        returnType: rillTypeToTypeValue({ kind: 'string' }),
      }),
      random: toCallable({
        params: [
          {
            name: 'bytes',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: { description: 'Number of bytes' },
          },
        ],
        fn: random,
        annotations: { description: 'Generate random bytes as hex string' },
        returnType: rillTypeToTypeValue({ kind: 'string' }),
      }),
    },
  };
}

// ============================================================
// MANIFEST
// ============================================================

export const extensionManifest: ExtensionManifest = {
  factory: createCryptoExtension,
  configSchema,
};
