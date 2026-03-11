/**
 * Fixture: minimal valid ExtensionManifest for loader tests.
 * Exported as the named export `ExtensionManifest` matching the loader's
 * convention of looking for `mod['ExtensionManifest']`.
 */
import type { ExtensionManifest as ExtManifest } from '@rcrsr/rill';

export const ExtensionManifest: ExtManifest = {
  namespace: 'mock',
  version: '1.0.0',
  factory: (_cfg: Record<string, unknown>) => ({
    greet: {
      fn: async () => 'hello',
      params: [],
    },
  }),
};
