import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

// ============================================================
// NDJSON FRAMING UTILITIES
// ============================================================

/**
 * Reads one newline-terminated JSON line from the given stream.
 * Creates a readline interface, reads the first line, then closes.
 */
export async function readJsonLine(stream: Readable): Promise<unknown> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  return new Promise<unknown>((resolve, reject) => {
    let resolved = false;

    rl.once('line', (line: string) => {
      resolved = true;
      rl.close();
      try {
        resolve(JSON.parse(line) as unknown);
      } catch (err) {
        reject(new Error(`Invalid JSON line: ${String(err)}`));
      }
    });

    rl.once('close', () => {
      if (!resolved) {
        reject(new Error('Stream ended without a JSON line'));
      }
    });

    rl.once('error', (err: Error) => {
      reject(err);
    });
  });
}

/**
 * Serializes value to JSON and writes it to the stream followed by `\n`.
 * Never use console.log here — that would contaminate stdout protocol.
 */
export function writeJsonLine(stream: Writable, value: unknown): void {
  stream.write(JSON.stringify(value) + '\n');
}
