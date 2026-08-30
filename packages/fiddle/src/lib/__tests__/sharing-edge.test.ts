/**
 * Edge case tests for sharing module
 *
 * Covers paths not exercised by sharing-encode.test.ts and sharing-decode.test.ts:
 * - decodeSource: returns ok:false reason:corrupt when decoded string is empty
 * - encodeSource: returns ok:false reason:too-large when encoded string exceeds MAX_URL_CODE_LENGTH
 * - copyLinkToClipboard: maps encodeSource's discriminated reason to too-large vs error
 * - encodeSource: CompressionStream unavailable guard
 * - round-trip decode(encode(x)) === x through the shared collectStream drain helper
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  decodeSource,
  encodeSource,
  copyLinkToClipboard,
  MAX_URL_CODE_LENGTH,
} from '../sharing.js';

describe('sharing edge cases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================
  // decodeSource: empty result guard
  // ============================================================

  describe('decodeSource: empty result after decompress', () => {
    let originalTextDecoder: typeof globalThis.TextDecoder;

    beforeEach(() => {
      originalTextDecoder = globalThis.TextDecoder;

      class MockTextDecoder {
        decode(): string {
          return '';
        }
      }

      // @ts-expect-error — replacing constructor for test purposes
      globalThis.TextDecoder = MockTextDecoder;
    });

    afterEach(() => {
      globalThis.TextDecoder = originalTextDecoder;
    });

    it('returns ok:false reason:corrupt when decompressed result is empty string', async () => {
      // Strategy: encode a valid string, then mock TextDecoder.decode to return ''
      // so that decodeSource hits the empty-result guard.
      const encoded = await encodeSource('hello world');
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;

      const result = await decodeSource(encoded.encoded);

      expect(result).toEqual({ ok: false, reason: 'corrupt' });
    });
  });

  // ============================================================
  // encodeSource: length limit
  // ============================================================

  describe('encodeSource: MAX_URL_CODE_LENGTH limit', () => {
    it('MAX_URL_CODE_LENGTH is exported and equals 8192', () => {
      expect(MAX_URL_CODE_LENGTH).toBe(8192);
    });

    it('returns ok:false reason:too-large when encoded output exceeds MAX_URL_CODE_LENGTH', async () => {
      // Mock btoa to return a string exceeding the limit
      const btoaSpy = vi
        .spyOn(globalThis, 'btoa')
        .mockReturnValue('A'.repeat(MAX_URL_CODE_LENGTH + 1));

      const result = await encodeSource('any source code');

      expect(result).toEqual({ ok: false, reason: 'too-large' });

      btoaSpy.mockRestore();
    });
  });

  // ============================================================
  // copyLinkToClipboard: too-large vs encoding failure
  // ============================================================

  describe('copyLinkToClipboard: too-large vs encoding failure', () => {
    let originalClipboard: Clipboard | undefined;
    let originalLocation: Location;

    beforeEach(() => {
      originalClipboard = navigator.clipboard;
      originalLocation = window.location;

      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: { origin: 'http://localhost', pathname: '/' },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it('returns too-large when encodeSource reports reason:too-large', async () => {
      const btoaSpy = vi
        .spyOn(globalThis, 'btoa')
        .mockReturnValue('A'.repeat(MAX_URL_CODE_LENGTH + 1));

      const result = await copyLinkToClipboard('some source code');

      expect(result.status).toBe('too-large');
      expect(result.message).toContain('too large');

      btoaSpy.mockRestore();
    });

    it('returns error when encoding is completely broken', async () => {
      const btoaSpy = vi.spyOn(globalThis, 'btoa').mockImplementation(() => {
        throw new Error('btoa unavailable');
      });

      const result = await copyLinkToClipboard('some source code');

      // encodeSource reports reason:'error' (not 'too-large') → status: 'error'
      expect(result.status).toBe('error');

      btoaSpy.mockRestore();
    });
  });

  // ============================================================
  // encodeSource: CompressionStream unavailable
  // ============================================================

  describe('encodeSource: CompressionStream unavailable', () => {
    let originalCompressionStream: typeof globalThis.CompressionStream;

    beforeEach(() => {
      originalCompressionStream = globalThis.CompressionStream;
      // @ts-expect-error — deliberately removing CompressionStream to test guard
      globalThis.CompressionStream = undefined;
    });

    afterEach(() => {
      globalThis.CompressionStream = originalCompressionStream;
    });

    it('returns ok:false reason:unavailable when CompressionStream is unavailable', async () => {
      const result = await encodeSource('test source');

      expect(result).toEqual({ ok: false, reason: 'unavailable' });
    });
  });

  // ============================================================
  // round-trip through the shared collectStream drain helper
  // ============================================================

  describe('round-trip decode(encode(x)) === x', () => {
    it('holds for a plain string', async () => {
      const source = 'round trip check';
      const encoded = await encodeSource(source);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;

      const decoded = await decodeSource(encoded.encoded);
      expect(decoded).toEqual({ ok: true, source });
    });

    it('holds for multi-chunk payloads large enough to exercise repeated stream reads', async () => {
      // Highly compressible but long enough that gzip output spans multiple
      // reader.read() calls inside collectStream on most platforms.
      const source = 'rill -> pipes -> flow\n'.repeat(2000);
      const encoded = await encodeSource(source);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) return;

      const decoded = await decodeSource(encoded.encoded);
      expect(decoded).toEqual({ ok: true, source });
    });
  });
});
