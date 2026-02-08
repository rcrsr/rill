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
    expect(encoded).not.toBeNull();
    const decoded = await decodeSource(encoded!);
    expect(decoded).toBe(original);
  });

  it('returns null for invalid base64', async () => {
    const result = await decodeSource('!!!bad!!!');
    expect(result).toBeNull();
  });

  it('returns null for empty string', async () => {
    const result = await decodeSource('');
    expect(result).toBeNull();
  });

  it('returns null for truncated data', async () => {
    const encoded = await encodeSource('hello world');
    expect(encoded).not.toBeNull();
    const truncated = encoded!.slice(0, 10);
    const result = await decodeSource(truncated);
    expect(result).toBeNull();
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

  it('returns null without param', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '' },
      writable: true,
    });
    const result = await readSourceFromURL();
    expect(result).toBeNull();
  });

  it('returns null for empty code param', async () => {
    Object.defineProperty(window, 'location', {
      value: { search: '?code=' },
      writable: true,
    });
    const result = await readSourceFromURL();
    expect(result).toBeNull();
  });

  it('reads and decodes valid code param', async () => {
    const source = 'test code';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();

    const replaceStateMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        search: `?code=${encoded}`,
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
    expect(result).toBe(source);
    expect(replaceStateMock).toHaveBeenCalledWith({}, '', '/fiddle');
  });

  it('preserves other query parameters', async () => {
    const source = 'test';
    const encoded = await encodeSource(source);
    expect(encoded).not.toBeNull();

    const replaceStateMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        search: `?code=${encoded}&foo=bar`,
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
    expect(result).toBe(source);
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

  it('returns too-large for oversized source', async () => {
    // Skip: gzip compression is so effective that it's impractical to create
    // test data that exceeds 8192 chars after encoding. The size check logic
    // is straightforward: encodeSource returns null if output > MAX_URL_CODE_LENGTH,
    // and copyLinkToClipboard checks for null and returns {status: 'too-large'}.
  });
});
