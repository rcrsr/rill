/**
 * Stream parser for line-delimited JSON from Claude CLI.
 * Handles chunked PTY output with ANSI escape sequences.
 */

import { RuntimeError } from '@rcrsr/rill';
import type { ClaudeMessage } from './types.js';

// ============================================================
// PARSER STATE
// ============================================================

/**
 * Stream parser for line-delimited JSON.
 * Buffers incomplete lines across chunks.
 */
export interface StreamParser {
  /**
   * Process a chunk of raw PTY output.
   * Emits parsed messages via callback.
   * Throws RuntimeError RILL-R004 for invalid JSON on complete lines.
   *
   * @param chunk - Raw data from PTY (Buffer or string)
   * @param onMessage - Callback for each parsed message
   * @throws RuntimeError with code RILL-R004 for invalid JSON
   */
  processChunk(
    chunk: Buffer | string,
    onMessage: (message: ClaudeMessage) => void
  ): void;

  /**
   * Flush remaining buffered data.
   * Call when stream ends to process incomplete lines.
   *
   * @param onMessage - Callback for final parsed messages
   * @throws RuntimeError with code RILL-R004 for invalid JSON
   */
  flush(onMessage: (message: ClaudeMessage) => void): void;
}

// ============================================================
// ANSI ESCAPE SEQUENCE REMOVAL
// ============================================================

/**
 * Regular expression matching ANSI escape sequences.
 * Matches CSI sequences (ESC[...m) and other control codes.
 * Uses String.fromCharCode to avoid ESLint no-control-regex errors.
 */
const ANSI_ESCAPE_PATTERN = new RegExp(
  [
    // CSI sequences: ESC [ ... letter
    `${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`,
    // OSC sequences: ESC ] ... BEL
    `${String.fromCharCode(0x1b)}\\][^${String.fromCharCode(0x07)}]*${String.fromCharCode(0x07)}`,
    // ESC = and ESC >
    `${String.fromCharCode(0x1b)}[=>]`,
    // Character set selection: ESC ( or ESC ) followed by code
    `${String.fromCharCode(0x1b)}[()][AB012]`,
  ].join('|'),
  'g'
);

/**
 * Strip ANSI escape sequences from text.
 *
 * @param text - Raw text with potential ANSI codes
 * @returns Clean text with ANSI sequences removed
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, '');
}

// ============================================================
// PARSER FACTORY
// ============================================================

/**
 * Create a new stream parser instance.
 *
 * @returns Stream parser with buffering state
 */
export function createStreamParser(): StreamParser {
  let buffer = '';
  let lineNumber = 0;

  /**
   * Process a single complete line.
   * Emits parsed message or throws RuntimeError on failure.
   */
  function processLine(
    line: string,
    onMessage: (message: ClaudeMessage) => void
  ): void {
    lineNumber++;

    // Skip empty lines
    if (line.trim().length === 0) {
      return;
    }

    try {
      const parsed = JSON.parse(line) as unknown;

      // Validate parsed object has 'type' discriminant
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('type' in parsed)
      ) {
        throw new Error('Missing "type" field in message');
      }

      onMessage(parsed as ClaudeMessage);
    } catch {
      // EC-7: Complete line with invalid JSON is non-recoverable
      throw new RuntimeError(
        'RILL-R004',
        `Invalid stream-json output: line ${lineNumber}: ${line}`
      );
    }
  }

  return {
    processChunk(
      chunk: Buffer | string,
      onMessage: (message: ClaudeMessage) => void
    ): void {
      // Convert Buffer to string if needed
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');

      // Append to buffer (ANSI codes included for now)
      buffer += text;

      // Process complete lines
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        // Strip ANSI from complete line before parsing
        const cleanLine = stripAnsi(rawLine);
        processLine(cleanLine, onMessage);
      }
    },

    flush(onMessage: (message: ClaudeMessage) => void): void {
      // Process remaining buffer as final line
      if (buffer.trim().length > 0) {
        const cleanLine = stripAnsi(buffer);
        processLine(cleanLine, onMessage);
        buffer = '';
      }
    },
  };
}
