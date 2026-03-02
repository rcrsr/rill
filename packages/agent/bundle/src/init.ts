import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type ManifestExtension, ComposeError } from '@rcrsr/rill-agent-shared';

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface InitOptions {
  readonly extensions?: readonly string[] | undefined;
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Derives an alias from an npm package name.
 * Strips scope prefix if present: "@foo/bar-ext" → "bar-ext".
 */
function packageAlias(packageName: string): string {
  const slashIndex = packageName.indexOf('/');
  if (packageName.startsWith('@') && slashIndex !== -1) {
    return packageName.slice(slashIndex + 1);
  }
  return packageName;
}

/**
 * Builds the extensions record for agent.json from an array of package names.
 * Each entry uses the basename as alias.
 */
function buildExtensionsRecord(
  extensions: readonly string[]
): Record<string, ManifestExtension> {
  const result: Record<string, ManifestExtension> = {};
  for (const pkg of extensions) {
    const alias = packageAlias(pkg);
    result[alias] = { package: pkg };
  }
  return result;
}

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Scaffold a new rill agent project directory.
 *
 * Creates a directory named `name` in the current working directory,
 * then writes agent.json, main.rill, and package.json inside it.
 *
 * @param name - Project name and directory name to create
 * @param options - Optional list of extension package names to pre-configure
 * @throws ComposeError (phase: 'init') if the target directory already exists
 */
export async function initProject(
  name: string,
  options?: InitOptions
): Promise<void> {
  const projectDir = path.resolve(name);

  // EC-18: Directory already exists
  if (existsSync(projectDir)) {
    throw new ComposeError(`Directory already exists: ${name}`, 'init');
  }

  await mkdir(projectDir, { recursive: true });

  // Build extensions object for agent.json
  const extensions =
    options?.extensions !== undefined && options.extensions.length > 0
      ? buildExtensionsRecord(options.extensions)
      : {};

  // Write agent.json
  const agentManifest = {
    name,
    version: '0.1.0',
    runtime: '@rcrsr/rill@*',
    entry: 'main.rill',
    extensions,
    modules: {},
    functions: {},
    assets: [],
    skills: [],
  };
  await writeFile(
    path.join(projectDir, 'agent.json'),
    JSON.stringify(agentManifest, null, 2),
    'utf-8'
  );

  // Write main.rill
  const mainRill = `# Entry script for ${name}\n"Hello from ${name}!"\n`;
  await writeFile(path.join(projectDir, 'main.rill'), mainRill, 'utf-8');

  // Write package.json
  const packageJson = {
    name,
    version: '0.1.0',
    type: 'module',
    scripts: {
      build: 'rill-agent-bundle build agent.json',
      check: 'rill-agent-bundle check --platform node dist/',
    },
    dependencies: {
      '@rcrsr/rill-agent-bundle': '^0.8.6',
    },
  };
  await writeFile(
    path.join(projectDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
    'utf-8'
  );
}
