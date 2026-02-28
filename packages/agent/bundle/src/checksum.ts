import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Compute a SHA-256 checksum over the contents of all given files.
 * Files are sorted deterministically before hashing.
 * Returns `sha256:<hex>`.
 */
export async function computeChecksum(
  filePaths: readonly string[]
): Promise<string> {
  const sorted = [...filePaths].sort();
  const hash = createHash('sha256');

  for (const filePath of sorted) {
    hash.update(readFileSync(filePath));
  }

  return `sha256:${hash.digest('hex')}`;
}
