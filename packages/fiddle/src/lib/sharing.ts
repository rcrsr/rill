/**
 * URL-based code sharing for rill Fiddle.
 *
 * Pipeline: source string -> UTF-8 -> gzip -> base64url -> URL parameter
 * Decode:   URL parameter -> base64url -> gunzip -> UTF-8 -> source string
 *
 * Uses browser-native CompressionStream API (no external dependencies).
 * Base64url alphabet: [A-Za-z0-9_-] (RFC 4648 §5).
 */

/** Maximum encoded length for the `code` query parameter value */
export const MAX_URL_CODE_LENGTH = 8192;

/** Result of a copy-link operation */
export interface CopyLinkResult {
  status: 'copied' | 'too-large' | 'error';
  /** URL that was copied (only when status is 'copied') */
  url?: string;
  /** Human-readable message for UI display */
  message: string;
}

/**
 * Encode rill source code for URL sharing.
 *
 * Pipeline: UTF-8 encode -> gzip compress -> base64url encode
 *
 * Constraints:
 * - Uses built-in CompressionStream API (no external dependency)
 * - Output uses base64url alphabet (A-Z, a-z, 0-9, -, _) with no padding
 * - Returns null if encoded result exceeds MAX_URL_CODE_LENGTH
 * - Returns null for empty or whitespace-only input
 */
export async function encodeSource(source: string): Promise<string | null> {
  // Guard: empty or whitespace-only input
  if (!source.trim()) {
    return null;
  }

  // Check for CompressionStream availability
  if (typeof CompressionStream === 'undefined') {
    console.warn('CompressionStream API not available');
    return null;
  }

  try {
    // UTF-8 encode
    const encoder = new TextEncoder();
    const bytes = encoder.encode(source);

    // Gzip compress
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));

    // Collect compressed bytes
    const reader = compressedStream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Combine chunks
    const compressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      compressed.set(chunk, offset);
      offset += chunk.length;
    }

    // Base64 encode
    let base64 = '';
    const binaryString = Array.from(compressed)
      .map((byte) => String.fromCharCode(byte))
      .join('');
    base64 = btoa(binaryString);

    // Convert to base64url (RFC 4648 §5)
    const base64url = base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Check length limit
    if (base64url.length > MAX_URL_CODE_LENGTH) {
      return null;
    }

    return base64url;
  } catch (error) {
    console.warn('Failed to encode source:', error);
    return null;
  }
}

/**
 * Decode a URL-shared code string back to rill source.
 *
 * Pipeline: base64url decode -> gzip decompress -> UTF-8 decode
 *
 * Constraints:
 * - Returns null on any decode/decompress failure (no throws)
 * - Handles missing padding characters in base64url input
 */
export async function decodeSource(encoded: string): Promise<string | null> {
  if (!encoded) {
    return null;
  }

  // Check for DecompressionStream availability
  if (typeof DecompressionStream === 'undefined') {
    console.warn('DecompressionStream API not available');
    return null;
  }

  try {
    // Convert base64url to base64 (restore standard alphabet and padding)
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');

    // Restore padding
    const paddingLength = (4 - (base64.length % 4)) % 4;
    base64 += '='.repeat(paddingLength);

    // Base64 decode to bytes
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Gzip decompress
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const decompressedStream = stream.pipeThrough(
      new DecompressionStream('gzip')
    );

    // Collect decompressed bytes
    const reader = decompressedStream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }

    // Combine chunks
    const decompressed = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      decompressed.set(chunk, offset);
      offset += chunk.length;
    }

    // UTF-8 decode
    const decoder = new TextDecoder();
    const source = decoder.decode(decompressed);

    // Guard: empty result
    if (!source) {
      return null;
    }

    return source;
  } catch (error) {
    console.warn('Failed to decode source:', error);
    return null;
  }
}

/**
 * Read source code from the current URL's query parameters.
 *
 * Constraints:
 * - Reads `code` parameter from window.location.search
 * - Returns null if parameter absent, empty, or decode fails
 * - Cleans URL by removing `code` param via history.replaceState after read
 * - Preserves other query parameters
 */
export async function readSourceFromURL(): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('code');

  if (!encoded) {
    return null;
  }

  const source = await decodeSource(encoded);

  if (source !== null) {
    // Clean URL by removing code parameter
    params.delete('code');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '');
    window.history.replaceState({}, '', newUrl);
  }

  return source;
}

/**
 * Build a shareable URL and copy it to the clipboard.
 *
 * Constraints:
 * - Uses window.location.origin + window.location.pathname as base
 * - Appends `?code=<encoded>` query parameter
 * - Copies full URL to clipboard via navigator.clipboard.writeText
 * - Returns status object indicating success, size-exceeded, or clipboard-error
 */
export async function copyLinkToClipboard(
  source: string
): Promise<CopyLinkResult> {
  // Guard: empty or whitespace-only source
  if (!source.trim()) {
    return {
      status: 'error',
      message: 'Cannot copy empty code',
    };
  }

  // Check for clipboard API availability
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    console.warn('Clipboard API not available');
    return {
      status: 'error',
      message: 'Clipboard not available',
    };
  }

  // Encode source
  const encoded = await encodeSource(source);

  if (encoded === null) {
    // Could be size exceeded or encoding failure
    // Try to encode a small test string to determine which
    const testEncoded = await encodeSource('test');
    if (testEncoded === null) {
      // Encoding is broken entirely
      return {
        status: 'error',
        message: 'Failed to encode',
      };
    }
    // Must be size issue
    return {
      status: 'too-large',
      message: 'Code too large to share',
    };
  }

  // Build URL
  const url = `${window.location.origin}${window.location.pathname}?code=${encoded}`;

  // Copy to clipboard
  try {
    await navigator.clipboard.writeText(url);
    return {
      status: 'copied',
      url,
      message: 'Copied!',
    };
  } catch (error) {
    console.warn('Failed to copy to clipboard:', error);
    return {
      status: 'error',
      message: 'Failed to copy',
    };
  }
}
