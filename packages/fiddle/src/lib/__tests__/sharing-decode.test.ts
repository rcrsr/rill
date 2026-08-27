/**
 * Tests for decodeSource, readSourceFromURL, and copyLinkToClipboard functions
 *
 * Validates decoding, URL reading, and clipboard operations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeSource,
  decodeSource,
  readSourceFromURL,
  copyLinkToClipboard,
} from '../sharing.js';

describe('decodeSource', () => {
  it('decodes valid encoded string', async () => {
    const original = 'test';
    const encoded = await encodeSource(original);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeSource(encoded.encoded);
    expect(decoded).toEqual({ ok: true, source: original });
  });

  it('returns ok:false reason:corrupt for invalid base64', async () => {
    const result = await decodeSource('!!!bad!!!');
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
  });

  it('returns ok:false reason:absent for empty string', async () => {
    const result = await decodeSource('');
    expect(result).toEqual({ ok: false, reason: 'absent' });
  });

  it('returns ok:false reason:corrupt for truncated data', async () => {
    const encoded = await encodeSource('hello world');
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const truncated = encoded.encoded.slice(0, 10);
    const result = await decodeSource(truncated);
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('readSourceFromURL', () => {
  let originalLocation: Location;
  let originalHistory: History;

  beforeEach(() => {
    originalLocation = window.location;
    originalHistory = window.history;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: originalHistory,
      writable: true,
    });
  });

  it('returns ok:false reason:absent without param', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
    const result = await readSourceFromURL();
    expect(result).toEqual({ ok: false, reason: 'absent' });
  });

  it('returns ok:false reason:absent for empty code param', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?code=' },
      writable: true,
    });
    const result = await readSourceFromURL();
    expect(result).toEqual({ ok: false, reason: 'absent' });
  });

  it('returns ok:false reason:corrupt for a corrupt code param', async () => {
    const replaceStateMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        search: '?code=!!!bad!!!',
        pathname: '/fiddle',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: {
        replaceState: replaceStateMock,
      },
      writable: true,
    });

    const result = await readSourceFromURL();
    expect(result).toEqual({ ok: false, reason: 'corrupt' });
    // URL is not cleaned when the payload fails to decode
    expect(replaceStateMock).not.toHaveBeenCalled();
  });

  it('reads and decodes valid code param', async () => {
    const source = 'test code';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const replaceStateMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        search: `?code=${encoded.encoded}`,
        pathname: '/fiddle',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: {
        replaceState: replaceStateMock,
      },
      writable: true,
    });

    const result = await readSourceFromURL();
    expect(result).toEqual({ ok: true, source });
    expect(replaceStateMock).toHaveBeenCalledWith({}, '', '/fiddle');
  });

  it('preserves other query parameters', async () => {
    const source = 'test';
    const encoded = await encodeSource(source);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const replaceStateMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        search: `?code=${encoded.encoded}&foo=bar`,
        pathname: '/fiddle',
      },
      writable: true,
    });
    Object.defineProperty(window, 'history', {
      value: {
        replaceState: replaceStateMock,
      },
      writable: true,
    });

    const result = await readSourceFromURL();
    expect(result).toEqual({ ok: true, source });
    expect(replaceStateMock).toHaveBeenCalledWith({}, '', '/fiddle?foo=bar');
  });
});

describe('copyLinkToClipboard', () => {
  let originalClipboard: Clipboard | undefined;
  let originalLocation: Location;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalLocation = window.location;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
    });
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
  });

  it('returns error for empty source', async () => {
    const result = await copyLinkToClipboard('');
    expect(result.status).toBe('error');
    expect(result.message).toBeTruthy();
  });

  it('returns error for whitespace', async () => {
    const result = await copyLinkToClipboard('   ');
    expect(result.status).toBe('error');
    expect(result.message).toBeTruthy();
  });

  it('returns copied on success', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      writable: true,
    });
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost',
        pathname: '/fiddle',
      },
      writable: true,
    });

    const result = await copyLinkToClipboard('test code');
    expect(result.status).toBe('copied');
    expect(result.url).toBeTruthy();
    expect(result.url).toContain('http://localhost/fiddle?code=');
    expect(writeTextMock).toHaveBeenCalledWith(result.url);
  });

  it('returns error when clipboard unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });

    const result = await copyLinkToClipboard('test');
    expect(result.status).toBe('error');
  });

  it('returns error on clipboard write failure', async () => {
    const writeTextMock = vi
      .fn()
      .mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      writable: true,
    });
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'http://localhost',
        pathname: '/fiddle',
      },
      writable: true,
    });

    const result = await copyLinkToClipboard('test');
    expect(result.status).toBe('error');
  });

  // No test for the too-large path here: gzip compression is so effective that
  // it is impractical to build test data exceeding 8192 chars after encoding.
  // See sharing-edge.test.ts, which mocks btoa to force the too-large branch.
});
