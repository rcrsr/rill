/**
 * Edge case tests for sharing module
 *
 * Covers paths not exercised by sharing-encode.test.ts and sharing-decode.test.ts:
 * - decodeSource: returns null when decoded string is empty (line 179)
 * - encodeSource: returns null when encoded string exceeds MAX_URL_CODE_LENGTH (line 95-97)
 * - copyLinkToClipboard: returns too-large when encode returns null but test encode works (lines 255-264)
 * - encodeSource: CompressionStream unavailable guard (lines 41-44)
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
  // decodeSource: empty result guard (line 179)
  // ============================================================

  describe('decodeSource: empty result after decompress', () => {
    it('returns null when decompressed result is empty string', async () => {
      // Strategy: encode a valid string, then mock TextDecoder.decode to return ''
      // so that decodeSource hits the empty-result guard at line 179.
      const originalTextDecoder = globalThis.TextDecoder;

      class MockTextDecoder {
        decode(): string {
          return '';
        }
      }

      // @ts-expect-error — replacing constructor for test purposes
      globalThis.TextDecoder = MockTextDecoder;

      const encoded = await encodeSource('hello world');
      expect(encoded).not.toBeNull();

      const result = await decodeSource(encoded!);

      expect(result).toBeNull();

      globalThis.TextDecoder = originalTextDecoder;
    });
  });

  // ============================================================
  // encodeSource: length limit (lines 95-97)
  // ============================================================

  describe('encodeSource: MAX_URL_CODE_LENGTH limit', () => {
    it('MAX_URL_CODE_LENGTH is exported and equals 8192', () => {
      expect(MAX_URL_CODE_LENGTH).toBe(8192);
    });

    it('returns null when encoded output exceeds MAX_URL_CODE_LENGTH', async () => {
      // Mock btoa to return a string exceeding the limit
      const btoaSpy = vi
        .spyOn(globalThis, 'btoa')
        .mockReturnValue('A'.repeat(MAX_URL_CODE_LENGTH + 1));

      const result = await encodeSource('any source code');

      expect(result).toBeNull();

      btoaSpy.mockRestore();
    });
  });

  // ============================================================
  // copyLinkToClipboard: too-large path (lines 255-264)
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

    it('returns too-large when source encodes to null but test string encodes fine', async () => {
      // First call to encodeSource (for the real source) returns null.
      // Second call to encodeSource (for "test") returns a valid string.
      // This distinguishes "too-large" from "encoding broken".
      let callCount = 0;
      const btoaSpy = vi.spyOn(globalThis, 'btoa').mockImplementation((str) => {
        callCount++;
        if (callCount === 1) {
          // First encode call (real source) - exceed the limit
          return 'A'.repeat(MAX_URL_CODE_LENGTH + 1);
        }
        // Subsequent calls (test encode) - return valid base64
        return Buffer.from(str, 'binary').toString('base64');
      });

      const result = await copyLinkToClipboard('some source code');

      expect(result.status).toBe('too-large');
      expect(result.message).toContain('too large');

      btoaSpy.mockRestore();
    });

    it('returns error when encoding is completely broken', async () => {
      // Both encodeSource calls return null (encoding is broken).
      const btoaSpy = vi.spyOn(globalThis, 'btoa').mockImplementation(() => {
        throw new Error('btoa unavailable');
      });

      const result = await copyLinkToClipboard('some source code');

      // When encodeSource(source) returns null AND encodeSource('test') also returns null,
      // it means encoding is broken → status: 'error'
      expect(result.status).toBe('error');

      btoaSpy.mockRestore();
    });
  });

  // ============================================================
  // encodeSource: CompressionStream unavailable
  // ============================================================

  describe('encodeSource: CompressionStream unavailable', () => {
    it('returns null when CompressionStream is unavailable', async () => {
      const original = globalThis.CompressionStream;
      // @ts-expect-error — deliberately removing CompressionStream to test guard
      globalThis.CompressionStream = undefined;

      const result = await encodeSource('test source');

      expect(result).toBeNull();

      globalThis.CompressionStream = original;
    });
  });
});
