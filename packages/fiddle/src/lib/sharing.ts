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
interface CopyLinkResult {
  status: 'copied' | 'too-large' | 'error';
  /** URL that was copied (only when status is 'copied') */
  url?: string;
  /** Human-readable message for UI display */
  message: string;
}

/** Result of encoding source for URL sharing */
export type EncodeResult =
  | { ok: true; encoded: string }
  | {
      ok: false;
      reason: 'empty' | 'unavailable' | 'too-large' | 'error';
    };

/** Result of decoding a URL-shared code string */
export type DecodeResult =
  | { ok: true; source: string }
  | { ok: false; reason: 'absent' | 'corrupt' | 'unavailable' };

/**
 * Drain a ReadableStream into a single contiguous Uint8Array.
 */
async function collectStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

/**
 * Encode rill source code for URL sharing.
 *
 * Pipeline: UTF-8 encode -> gzip compress -> base64url encode
 *
 * Constraints:
 * - Uses built-in CompressionStream API (no external dependency)
 * - Output uses base64url alphabet (A-Z, a-z, 0-9, -, _) with no padding
 * - Returns {ok: false, reason: 'too-large'} if encoded result exceeds MAX_URL_CODE_LENGTH
 * - Returns {ok: false, reason: 'empty'} for empty or whitespace-only input
 */
export async function encodeSource(source: string): Promise<EncodeResult> {
  // Guard: empty or whitespace-only input
  if (!source.trim()) {
    return { ok: false, reason: 'empty' };
  }

  // Check for CompressionStream availability
  if (typeof CompressionStream === 'undefined') {
    console.warn('CompressionStream API not available');
    return { ok: false, reason: 'unavailable' };
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
    const compressed = await collectStream(compressedStream);

    // Base64 encode
    const binaryString = Array.from(compressed)
      .map((byte) => String.fromCharCode(byte))
      .join('');
    const base64 = btoa(binaryString);

    // Convert to base64url (RFC 4648 §5)
    const base64url = base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Check length limit
    if (base64url.length > MAX_URL_CODE_LENGTH) {
      return { ok: false, reason: 'too-large' };
    }

    return { ok: true, encoded: base64url };
  } catch (error) {
    console.warn('Failed to encode source:', error);
    return { ok: false, reason: 'error' };
  }
}

/**
 * Decode a URL-shared code string back to rill source.
 *
 * Pipeline: base64url decode -> gzip decompress -> UTF-8 decode
 *
 * Constraints:
 * - Returns {ok: false, reason: 'absent'} when there is no payload to decode
 * - Returns {ok: false, reason: 'corrupt'} on any decode/decompress failure (no throws)
 * - Handles missing padding characters in base64url input
 */
export async function decodeSource(encoded: string): Promise<DecodeResult> {
  if (!encoded) {
    return { ok: false, reason: 'absent' };
  }

  // Check for DecompressionStream availability
  if (typeof DecompressionStream === 'undefined') {
    console.warn('DecompressionStream API not available');
    return { ok: false, reason: 'unavailable' };
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
    const decompressed = await collectStream(decompressedStream);

    // UTF-8 decode
    const decoder = new TextDecoder();
    const source = decoder.decode(decompressed);

    // Guard: empty result is a corrupt payload, not valid source
    if (!source) {
      return { ok: false, reason: 'corrupt' };
    }

    return { ok: true, source };
  } catch (error) {
    console.warn('Failed to decode source:', error);
    return { ok: false, reason: 'corrupt' };
  }
}

/**
 * Read source code from the current URL's query parameters.
 *
 * Constraints:
 * - Reads `code` parameter from window.location.search
 * - Returns {ok: false, reason: 'absent'} if the parameter is missing or empty
 * - Returns {ok: false, reason: 'corrupt'} if the parameter fails to decode
 * - Cleans URL by removing `code` param via history.replaceState after a successful read
 * - Preserves other query parameters
 */
export async function readSourceFromURL(): Promise<DecodeResult> {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('code');

  if (!encoded) {
    return { ok: false, reason: 'absent' };
  }

  const result = await decodeSource(encoded);

  if (result.ok) {
    // Clean URL by removing code parameter
    params.delete('code');
    const newSearch = params.toString();
    const newUrl =
      window.location.pathname + (newSearch ? `?${newSearch}` : '');
    window.history.replaceState({}, '', newUrl);
  }

  return result;
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
  const encodeResult = await encodeSource(source);

  if (!encodeResult.ok) {
    if (encodeResult.reason === 'too-large') {
      return {
        status: 'too-large',
        message: 'Code too large to share',
      };
    }
    // 'empty' | 'unavailable' | 'error'
    return {
      status: 'error',
      message: 'Failed to encode',
    };
  }

  // Build URL
  const url = `${window.location.origin}${window.location.pathname}?code=${encodeResult.encoded}`;

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
