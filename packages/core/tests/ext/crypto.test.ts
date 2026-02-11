/**
 * Tests for crypto extension factory
 *
 * Verifies hash, hmac, uuid, and random functions with algorithm validation.
 */

import { describe, it, expect } from 'vitest';
import {
  createCryptoExtension,
  type CryptoConfig,
} from '../../src/ext/crypto/index.js';
import { RuntimeError } from '../../src/error-classes.js';

describe('crypto extension factory', () => {
  describe('factory creation', () => {
    it('creates ExtensionResult with 4 functions (IC-9)', () => {
      const ext = createCryptoExtension();

      // Verify all 4 functions exist
      expect(ext).toHaveProperty('hash');
      expect(ext).toHaveProperty('hmac');
      expect(ext).toHaveProperty('uuid');
      expect(ext).toHaveProperty('random');

      // Verify function structure
      expect(ext.hash).toMatchObject({
        params: expect.any(Array),
        fn: expect.any(Function),
        description: expect.any(String),
        returnType: 'string',
      });
    });

    it('applies config defaults', () => {
      const ext = createCryptoExtension();

      // Should not throw - defaults applied (defaultAlgorithm='sha256')
      expect(ext).toBeDefined();
    });

    it('accepts custom default algorithm', () => {
      const config: CryptoConfig = {
        defaultAlgorithm: 'sha512',
      };

      const ext = createCryptoExtension(config);
      expect(ext).toBeDefined();
    });

    it('accepts hmacKey in config', () => {
      const config: CryptoConfig = {
        hmacKey: 'secret-key-123',
      };

      const ext = createCryptoExtension(config);
      expect(ext).toBeDefined();
    });
  });

  describe('hash() function', () => {
    it('hashes content with default algorithm (IR-23)', async () => {
      const ext = createCryptoExtension({ defaultAlgorithm: 'sha256' });
      const result = await ext.hash.fn(['hello world']);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[0-9a-f]+$/); // Hex output
      expect(result).toHaveLength(64); // SHA256 produces 64 hex chars
    });

    it('hashes content with explicit algorithm', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['hello world', 'md5']);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[0-9a-f]+$/);
      expect(result).toHaveLength(32); // MD5 produces 32 hex chars
    });

    it('produces consistent output for same input', async () => {
      const ext = createCryptoExtension();
      const result1 = await ext.hash.fn(['test', 'sha256']);
      const result2 = await ext.hash.fn(['test', 'sha256']);

      expect(result1).toBe(result2);
    });

    it('produces different output for different input', async () => {
      const ext = createCryptoExtension();
      const result1 = await ext.hash.fn(['input1', 'sha256']);
      const result2 = await ext.hash.fn(['input2', 'sha256']);

      expect(result1).not.toBe(result2);
    });

    it('supports sha256 algorithm', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['test', 'sha256']);

      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('supports sha512 algorithm', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['test', 'sha512']);

      expect(result).toMatch(/^[0-9a-f]{128}$/); // SHA512 produces 128 hex chars
    });

    it('supports md5 algorithm', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['test', 'md5']);

      expect(result).toMatch(/^[0-9a-f]{32}$/);
    });

    it('throws for invalid algorithm (EC-27)', async () => {
      const ext = createCryptoExtension();

      await expect(ext.hash.fn(['test', 'invalid-algo'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.hash.fn(['test', 'invalid-algo'])).rejects.toThrow(
        'unsupported algorithm'
      );
    });

    it('uses default algorithm when not specified', async () => {
      const ext = createCryptoExtension({ defaultAlgorithm: 'sha512' });
      const result = await ext.hash.fn(['test']);

      // SHA512 produces 128 hex chars
      expect(result).toMatch(/^[0-9a-f]{128}$/);
    });
  });

  describe('hmac() function', () => {
    it('generates HMAC signature (IR-24)', async () => {
      const ext = createCryptoExtension({
        hmacKey: 'secret-key',
        defaultAlgorithm: 'sha256',
      });
      const result = await ext.hmac.fn(['message to authenticate']);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[0-9a-f]+$/); // Hex output
      expect(result).toHaveLength(64); // SHA256 HMAC produces 64 hex chars
    });

    it('generates HMAC with explicit algorithm', async () => {
      const ext = createCryptoExtension({ hmacKey: 'secret' });
      const result = await ext.hmac.fn(['message', 'sha512']);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[0-9a-f]{128}$/); // SHA512 produces 128 hex chars
    });

    it('produces consistent output for same input and key', async () => {
      const ext = createCryptoExtension({ hmacKey: 'secret' });
      const result1 = await ext.hmac.fn(['message', 'sha256']);
      const result2 = await ext.hmac.fn(['message', 'sha256']);

      expect(result1).toBe(result2);
    });

    it('produces different output for different messages', async () => {
      const ext = createCryptoExtension({ hmacKey: 'secret' });
      const result1 = await ext.hmac.fn(['message1', 'sha256']);
      const result2 = await ext.hmac.fn(['message2', 'sha256']);

      expect(result1).not.toBe(result2);
    });

    it('throws when hmacKey not configured (EC-26)', async () => {
      const ext = createCryptoExtension(); // No hmacKey

      await expect(ext.hmac.fn(['message'])).rejects.toThrow(RuntimeError);
      await expect(ext.hmac.fn(['message'])).rejects.toThrow(
        'hmacKey required for hmac()'
      );
    });

    it('throws for invalid algorithm (EC-27)', async () => {
      const ext = createCryptoExtension({ hmacKey: 'secret' });

      await expect(ext.hmac.fn(['message', 'invalid-algo'])).rejects.toThrow(
        RuntimeError
      );
      await expect(ext.hmac.fn(['message', 'invalid-algo'])).rejects.toThrow(
        'unsupported algorithm'
      );
    });

    it('uses default algorithm when not specified', async () => {
      const ext = createCryptoExtension({
        hmacKey: 'secret',
        defaultAlgorithm: 'sha512',
      });
      const result = await ext.hmac.fn(['message']);

      // SHA512 produces 128 hex chars
      expect(result).toMatch(/^[0-9a-f]{128}$/);
    });
  });

  describe('uuid() function', () => {
    it('generates random UUID v4 (IR-25)', async () => {
      const ext = createCryptoExtension();
      const result = await ext.uuid.fn([]);

      expect(typeof result).toBe('string');
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(result).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      );
    });

    it('generates unique UUIDs', async () => {
      const ext = createCryptoExtension();
      const result1 = await ext.uuid.fn([]);
      const result2 = await ext.uuid.fn([]);

      expect(result1).not.toBe(result2);
    });

    it('generates valid v4 UUIDs', async () => {
      const ext = createCryptoExtension();

      // Generate multiple UUIDs and verify all are valid v4
      for (let i = 0; i < 10; i++) {
        const result = await ext.uuid.fn([]);
        expect(result).toMatch(/^[0-9a-f-]{36}$/);

        // Verify version and variant bits
        const parts = result.split('-');
        expect(parts).toHaveLength(5);
        expect(parts[2]![0]).toBe('4'); // Version 4
        expect(['8', '9', 'a', 'b']).toContain(parts[3]![0]); // Variant bits
      }
    });
  });

  describe('random() function', () => {
    it('generates random bytes as hex string (IR-26)', async () => {
      const ext = createCryptoExtension();
      const result = await ext.random.fn([16]);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^[0-9a-f]+$/);
      expect(result).toHaveLength(32); // 16 bytes = 32 hex chars
    });

    it('returns correct length for byte count', async () => {
      const ext = createCryptoExtension();

      const result8 = await ext.random.fn([8]);
      expect(result8).toHaveLength(16); // 8 bytes = 16 hex chars

      const result32 = await ext.random.fn([32]);
      expect(result32).toHaveLength(64); // 32 bytes = 64 hex chars

      const result64 = await ext.random.fn([64]);
      expect(result64).toHaveLength(128); // 64 bytes = 128 hex chars
    });

    it('generates different values on each call', async () => {
      const ext = createCryptoExtension();
      const result1 = await ext.random.fn([16]);
      const result2 = await ext.random.fn([16]);

      expect(result1).not.toBe(result2);
    });

    it('handles small byte counts', async () => {
      const ext = createCryptoExtension();
      const result = await ext.random.fn([1]);

      expect(result).toMatch(/^[0-9a-f]{2}$/); // 1 byte = 2 hex chars
    });

    it('handles large byte counts', async () => {
      const ext = createCryptoExtension();
      const result = await ext.random.fn([256]);

      expect(result).toMatch(/^[0-9a-f]{512}$/); // 256 bytes = 512 hex chars
    });

    it('returns empty string for zero bytes', async () => {
      const ext = createCryptoExtension();
      const result = await ext.random.fn([0]);

      expect(result).toBe('');
    });
  });

  describe('algorithm validation', () => {
    it('validates hash algorithm at runtime', async () => {
      const ext = createCryptoExtension();

      // Valid algorithms should work
      await expect(ext.hash.fn(['test', 'sha256'])).resolves.toBeDefined();
      await expect(ext.hash.fn(['test', 'sha512'])).resolves.toBeDefined();
      await expect(ext.hash.fn(['test', 'md5'])).resolves.toBeDefined();

      // Invalid algorithm should throw
      await expect(ext.hash.fn(['test', 'invalid'])).rejects.toThrow(
        RuntimeError
      );
    });

    it('validates hmac algorithm at runtime', async () => {
      const ext = createCryptoExtension({ hmacKey: 'secret' });

      // Valid algorithms should work
      await expect(ext.hmac.fn(['test', 'sha256'])).resolves.toBeDefined();
      await expect(ext.hmac.fn(['test', 'sha512'])).resolves.toBeDefined();

      // Invalid algorithm should throw
      await expect(ext.hmac.fn(['test', 'invalid'])).rejects.toThrow(
        RuntimeError
      );
    });
  });

  describe('edge cases', () => {
    it('hashes empty string', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['', 'sha256']);

      expect(result).toMatch(/^[0-9a-f]{64}$/);
      // SHA256 of empty string
      expect(result).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      );
    });

    it('generates HMAC for empty message', async () => {
      const ext = createCryptoExtension({ hmacKey: 'key' });
      const result = await ext.hmac.fn(['', 'sha256']);

      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles unicode in hash', async () => {
      const ext = createCryptoExtension();
      const result = await ext.hash.fn(['Hello 世界 🌍', 'sha256']);

      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });

    it('handles unicode in HMAC', async () => {
      const ext = createCryptoExtension({ hmacKey: 'key' });
      const result = await ext.hmac.fn(['Hello 世界 🌍', 'sha256']);

      expect(result).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
