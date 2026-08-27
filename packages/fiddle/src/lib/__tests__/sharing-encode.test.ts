/**
 * Tests for encodeSource function
 *
 * Validates URL encoding, compression, and round-trip preservation.
 */

import { describe, it, expect, vi } from 'vitest';
import { encodeSource, decodeSource, MAX_URL_CODE_LENGTH } from '../sharing.js';

describe('encodeSource', () => {
  it('encodes simple string', async () => {
    const result = await encodeSource('hello');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.encoded).toBe('string');
    }
  });

  it('output is URL-safe', async () => {
    const result = await encodeSource('hello world');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Base64url alphabet: [A-Za-z0-9_-]
      expect(result.encoded).toMatch(/^[A-Za-z0-9_-]+$/);
      // No padding
      expect(result.encoded).not.toContain('=');
      // No standard base64 chars
      expect(result.encoded).not.toContain('+');
      expect(result.encoded).not.toContain('/');
    }
  });

  it('returns ok:false reason:empty for empty string', async () => {
    const result = await encodeSource('');
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns ok:false reason:empty for whitespace-only', async () => {
    const result = await encodeSource('   ');
    expect(result).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns ok:false reason:too-large when encoded output exceeds MAX_URL_CODE_LENGTH', async () => {
    const btoaSpy = vi
      .spyOn(globalThis, 'btoa')
      .mockReturnValue('A'.repeat(MAX_URL_CODE_LENGTH + 1));

    const result = await encodeSource('any source code');

    expect(result).toEqual({ ok: false, reason: 'too-large' });

    btoaSpy.mockRestore();
  });

  it('round-trip preserves ASCII', async () => {
    const source = 'hello world';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeSource(encoded.encoded);
    expect(decoded).toEqual({ ok: true, source });
  });

  it('round-trip preserves unicode', async () => {
    const source = 'Hello 世界 🌍 emoji';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeSource(encoded.encoded);
    expect(decoded).toEqual({ ok: true, source });
  });

  it('round-trip preserves rill operators', async () => {
    const source = '1 -> log\n$x => { $x + 1 }\n{a: 1}';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeSource(encoded.encoded);
    expect(decoded).toEqual({ ok: true, source });
  });

  it('round-trip preserves whitespace', async () => {
    const source = 'line1\n\tline2\n  line3\r\n';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeSource(encoded.encoded);
    expect(decoded).toEqual({ ok: true, source });
  });
});
