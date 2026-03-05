import { readFileSync } from 'fs';
import path from 'path';

/**
 * Generate Vite resolve aliases from core package.json exports.
 * Maps `@rcrsr/rill` subpath exports to source .ts files for vitest.
 *
 * @param dirname - __dirname of the calling vitest config
 * @returns Record of alias keys to absolute source paths
 */
export function rillAliases(dirname: string): Record<string, string> {
  const corePkg = JSON.parse(
    readFileSync(path.resolve(dirname, '../../core/package.json'), 'utf-8')
  );
  const entries: [string, string][] = [];
  for (const [subpath, targets] of Object.entries(corePkg.exports)) {
    const distPath = (targets as { default: string }).default;
    const srcPath = distPath
      .replace('./dist/', './src/')
      .replace(/\.js$/, '.ts');
    const key =
      subpath === '.' ? '@rcrsr/rill' : `@rcrsr/rill${subpath.slice(1)}`;
    entries.push([key, path.resolve(dirname, '../../core', srcPath)]);
  }
  // Sort longest-first so Vite matches subpaths before the root alias
  entries.sort((a, b) => b[0].length - a[0].length);
  return Object.fromEntries(entries);
}
