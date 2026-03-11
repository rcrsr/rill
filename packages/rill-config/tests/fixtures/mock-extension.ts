/**
 * Fixture: minimal valid extensionManifest for loader tests.
 * Exported as the named export `extensionManifest` matching the loader's
 * convention of looking for `mod['extensionManifest']`.
 */
import type { ExtensionManifest } from '@rcrsr/rill';

export const extensionManifest: ExtensionManifest = {
  version: '1.0.0',
  factory: (_cfg: Record<string, unknown>) => ({
    greet: {
      fn: async () => 'hello',
      params: [],
    },
  }),
};
