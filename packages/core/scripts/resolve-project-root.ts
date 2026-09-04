/**
 * Shared project root resolution for scripts/*.ts
 *
 * Resolves the packages/core directory from a script's import.meta.url.
 * Uses fileURLToPath rather than new URL(...).pathname, which mis-decodes
 * on Windows drive-letter paths (e.g. leaves a leading slash before "C:").
 */

import * as path from 'path';
import { fileURLToPath } from 'url';

export function resolveProjectRoot(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..');
}
