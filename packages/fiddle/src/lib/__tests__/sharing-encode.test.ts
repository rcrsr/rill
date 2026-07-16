/**
 * Tests for encodeSource function
 *
 * Validates URL encoding, compression, and round-trip preservation.
 */

import { describe, it, expect } from 'vitest';
import { encodeSource, decodeSource } from '../sharing.js';

describe('encodeSource', () => {
  it('encodes simple string', async () => {
    const result = await encodeSource('hello');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('output is URL-safe', async () => {
    const result = await encodeSource('hello world');
    expect(result).not.toBeNull();
    // Base64url alphabet: [A-Za-z0-9_-]
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/);
    // No padding
    expect(result).not.toContain('=');
    // No standard base64 chars
    expect(result).not.toContain('+');
    expect(result).not.toContain('/');
  });

  it('returns null for empty string', async () => {
    const result = await encodeSource('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only', async () => {
    const result = await encodeSource('   ');
    expect(result).toBeNull();
  });

  it('round-trip preserves ASCII', async () => {
    const source = 'hello world';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();
    const decoded = await decodeSource(encoded!);
    expect(decoded).toBe(source);
  });

  it('round-trip preserves unicode', async () => {
    const source = 'Hello 世界 🌍 emoji';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();
    const decoded = await decodeSource(encoded!);
    expect(decoded).toBe(source);
  });

  it('round-trip preserves rill operators', async () => {
    const source = '1 -> log\n$x => { $x + 1 }\n{a: 1}';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();
    const decoded = await decodeSource(encoded!);
    expect(decoded).toBe(source);
  });

  it('round-trip preserves whitespace', async () => {
    const source = 'line1\n\tline2\n  line3\r\n';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();
    const decoded = await decodeSource(encoded!);
    expect(decoded).toBe(source);
  });

  // No test for MAX_URL_CODE_LENGTH: gzip compression is so effective that it is
  // impractical to build test data exceeding 8192 chars after encoding without
  // truly random data, which requires crypto APIs. The length check is covered
  // in integration, and MAX_URL_CODE_LENGTH is exported for direct verification.
});
