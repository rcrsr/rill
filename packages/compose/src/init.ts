import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComposeError } from './errors.js';

// ============================================================
// EXTENSION DEFINITIONS
// ============================================================

interface ExtensionDef {
  readonly package: string;
  readonly namespace: string;
  readonly config: Record<string, string>;
  readonly envVars: readonly string[];
}

const KNOWN_EXTENSIONS: Record<string, ExtensionDef> = {
  anthropic: {
    package: '@rcrsr/rill-ext-llm-anthropic',
    namespace: 'llm',
    config: { api_key: '${ANTHROPIC_API_KEY}' },
    envVars: ['ANTHROPIC_API_KEY'],
  },
  openai: {
    package: '@rcrsr/rill-ext-llm-openai',
    namespace: 'llm',
    config: { api_key: '${OPENAI_API_KEY}' },
    envVars: ['OPENAI_API_KEY'],
  },
  qdrant: {
    package: '@rcrsr/rill-ext-qdrant',
    namespace: 'db',
    config: {
      url: '${QDRANT_URL}',
      api_key: '${QDRANT_API_KEY}',
    },
    envVars: ['QDRANT_URL', 'QDRANT_API_KEY'],
  },
  fetch: {
    package: '@rcrsr/rill/ext/fetch',
    namespace: 'net',
    config: {},
    envVars: [],
  },
  kv: {
    package: '@rcrsr/rill/ext/kv',
    namespace: 'kv',
    config: {},
    envVars: [],
  },
  fs: {
    package: '@rcrsr/rill/ext/fs',
    namespace: 'fs',
    config: {},
    envVars: [],
  },
};

// ============================================================
// PUBLIC TYPES
// ============================================================

export interface InitOptions {
  readonly extensions?: readonly string[] | undefined;
}

// ============================================================
// PROJECT NAME VALIDATION
// ============================================================

/**
 * Validate project name against npm package naming rules.
 * Based on npm package naming rules.
 * Rules:
 * - Cannot be empty or '.'
 * - Must contain only lowercase alphanumeric, hyphens, underscores
 * - Scoped names (@scope/name) allowed
 * - No path traversal characters (/ except in scope, \, ..)
 *
 * @param name - Project name to validate
 * @returns true if valid, error message otherwise
 */
function validateProjectName(name: string): true | string {
  if (!name || name.trim().length === 0) {
    return 'Project name must be valid npm package name';
  }

  if (name === '.') {
    return 'Project name must be valid npm package name';
  }

  if (name.includes('..') || name.includes('\\')) {
    return 'Project name must be valid npm package name';
  }

  const scopedPattern = /^@[a-z0-9-_]+\/[a-z0-9-_]+$/;
  const unscopedPattern = /^[a-z0-9-_]+$/;

  if (name.startsWith('@')) {
    if (!scopedPattern.test(name)) {
      return 'Project name must be valid npm package name';
    }
  } else {
    if (name.includes('/')) {
      return 'Project name must be valid npm package name';
    }
    if (!unscopedPattern.test(name)) {
      return 'Project name must be valid npm package name';
    }
  }

  return true;
}

// ============================================================
// DIRECTORY NAME DERIVATION
// ============================================================

/**
 * Derive the directory name from a package name.
 * Scoped names like @scope/my-agent → my-agent.
 * Unscoped names are used as-is.
 */
function toDirName(name: string): string {
  if (name.startsWith('@')) {
    const slashIdx = name.indexOf('/');
    return name.slice(slashIdx + 1);
  }
  return name;
}

// ============================================================
// FILE GENERATORS
// ============================================================

function buildAgentJson(
  name: string,
  extensions: readonly string[]
): Record<string, unknown> {
  const extensionsRecord: Record<
    string,
    { package: string; config: Record<string, string> }
  > = {};

  for (const extName of extensions) {
    const def = KNOWN_EXTENSIONS[extName];
    if (!def) continue;
    extensionsRecord[def.namespace] = {
      package: def.package,
      config: def.config,
    };
  }

  return {
    name,
    version: '0.1.0',
    runtime: '@rcrsr/rill@^0.8.0',
    entry: 'main.rill',
    description: '',
    skills: [],
    extensions: extensionsRecord,
    host: {
      timeout: 30000,
    },
  };
}

function buildEnvExample(extensions: readonly string[]): string {
  const vars = new Set<string>();
  for (const extName of extensions) {
    const def = KNOWN_EXTENSIONS[extName];
    if (!def) continue;
    for (const v of def.envVars) {
      vars.add(v);
    }
  }

  if (vars.size === 0) return '';
  return [...vars].map((v) => `${v}=`).join('\n') + '\n';
}

function buildPackageJson(name: string): Record<string, unknown> {
  return { name };
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Creates a new project directory with agent.json, main.rill,
 * .env.example, and package.json.
 *
 * @param name - Package name (may be scoped, e.g. @scope/my-agent)
 * @param options - Optional init configuration
 * @throws ComposeError (phase: 'init') for all error conditions
 */
export async function initProject(
  name: string,
  options?: InitOptions | undefined
): Promise<void> {
  // EC-26: Invalid project name
  const nameResult = validateProjectName(name);
  if (nameResult !== true) {
    throw new ComposeError(`Invalid project name: ${name}`, 'init');
  }

  const dirName = toDirName(name);
  const dirPath = path.resolve(dirName);

  // EC-25: Directory already exists
  if (existsSync(dirPath)) {
    throw new ComposeError(`Directory already exists: ${dirName}`, 'init');
  }

  const extensions = options?.extensions ?? [];

  // EC-27: Unknown extension name
  for (const extName of extensions) {
    if (!KNOWN_EXTENSIONS[extName]) {
      throw new ComposeError(`Unknown extension: ${extName}`, 'init');
    }
  }

  // Write all files, wrapping fs errors as EC-28
  try {
    mkdirSync(dirPath);

    const agentJson = buildAgentJson(name, extensions);
    writeFileSync(
      path.join(dirPath, 'agent.json'),
      JSON.stringify(agentJson, null, 2) + '\n',
      'utf-8'
    );

    writeFileSync(
      path.join(dirPath, 'main.rill'),
      '"Hello, World!" -> log\n',
      'utf-8'
    );

    const envExample = buildEnvExample(extensions);
    if (envExample.length > 0) {
      writeFileSync(path.join(dirPath, '.env.example'), envExample, 'utf-8');
    }

    const packageJson = buildPackageJson(name);
    writeFileSync(
      path.join(dirPath, 'package.json'),
      JSON.stringify(packageJson, null, 2) + '\n',
      'utf-8'
    );
  } catch (err) {
    if (err instanceof ComposeError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ComposeError(`Failed to create project: ${message}`, 'init');
  }
}
