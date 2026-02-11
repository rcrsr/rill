/**
 * Project scaffolding: creates directory, renders templates, installs dependencies.
 * Orchestrates template rendering and file system operations.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { getExtensionConfig } from './extensions.js';
import { renderTemplate, FileSystemError } from './templates.js';

// ============================================================
// TYPES
// ============================================================

/**
 * Configuration for project scaffolding.
 */
export interface ScaffoldConfig {
  /** Valid npm package name, min 1 character */
  projectName: string;
  /** Extension names from config map, may be empty */
  extensions: string[];
  /** Used in comments, may be empty string */
  description: string;
  /** Package manager to use for install */
  packageManager: 'npm' | 'pnpm' | 'yarn';
  /** Generate TypeScript project */
  typescript: boolean;
  /** Run package manager install after scaffolding */
  installDeps: boolean;
  /** Starter pattern name, null for default template */
  starterPattern: string | null;
}

// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error for dependency installation failures.
 */
export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallError';
  }
}

// ============================================================
// TEMPLATE VARIABLE BUILDERS
// ============================================================

/**
 * Build template variables from scaffold config.
 * Transforms config into Handlebars context object.
 */
function buildTemplateVariables(
  config: ScaffoldConfig
): Record<string, unknown> {
  // Gather extension configs
  const extensionConfigs = config.extensions
    .map((name) => getExtensionConfig(name))
    .filter((cfg): cfg is NonNullable<typeof cfg> => cfg !== null);

  // Build imports array for host.ts
  const imports = extensionConfigs.map((ext) => ({
    factoryName: ext.factoryName,
    packageName: ext.npmPackage,
  }));

  // Build extensions array for host.ts (with hoist calls)
  const extensions = extensionConfigs.map((ext) => {
    // Build config fields for factory call
    const configFields = Object.entries(ext.configShape).map(([name, type]) => {
      let value: string;
      if (type === 'string') {
        // Check if it's an env var
        if (
          ext.envVars.includes(name.toUpperCase()) ||
          ext.envVars.includes(
            `${ext.namespace.toUpperCase()}_${name.toUpperCase()}`
          )
        ) {
          value = `process.env.${name.toUpperCase()}`;
        } else if (
          ext.envVars.some((envVar) =>
            envVar.endsWith(`_${name.toUpperCase()}`)
          )
        ) {
          const envVar = ext.envVars.find((ev) =>
            ev.endsWith(`_${name.toUpperCase()}`)
          );
          value = `process.env.${envVar}`;
        } else {
          value = `process.env.${name.toUpperCase()} ?? ''`;
        }
      } else if (type === 'number') {
        value = 'undefined';
      } else if (type === 'boolean') {
        value = 'undefined';
      } else {
        value = 'undefined';
      }
      return { name, value };
    });

    return {
      namespace: ext.namespace,
      factoryName: ext.factoryName,
      configFields,
      npmPackage: ext.npmPackage,
    };
  });

  // Collect all env vars
  const envVars = extensionConfigs.flatMap((ext) => ext.envVars);

  // Build extension packages for package.json
  const extensionPackages = extensionConfigs.map((ext) => ext.npmPackage);

  // Extract basename for package.json name (handles full paths in tests)
  const projectName = basename(config.projectName);

  return {
    projectName,
    description: config.description,
    packageManager: config.packageManager,
    typescript: config.typescript,
    imports,
    extensions,
    envVars,
    extensionPackages,
    starterPattern: config.starterPattern,
  };
}

// ============================================================
// SCAFFOLDING
// ============================================================

/**
 * Scaffold a new rill project with templates and dependencies.
 * Creates project directory, renders all templates, and optionally installs dependencies.
 *
 * @param config - Scaffolding configuration
 * @throws {FileSystemError} Directory already exists (EC-6)
 * @throws {InstallError} npm install fails (EC-8)
 *
 * @example
 * ```typescript
 * await scaffold({
 *   projectName: 'my-agent',
 *   extensions: ['anthropic'],
 *   description: 'AI chatbot',
 *   packageManager: 'pnpm',
 *   typescript: true,
 *   installDeps: true,
 *   starterPattern: null,
 * });
 * ```
 */
export async function scaffold(config: ScaffoldConfig): Promise<void> {
  const projectDir = config.projectName;

  // Create project directory (fail if exists)
  try {
    mkdirSync(projectDir, { recursive: false });
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'EEXIST'
    ) {
      throw new FileSystemError(
        `Directory ${basename(config.projectName)} already exists`
      );
    }
    throw new FileSystemError(
      `Failed to create directory: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Create src directory
  const srcDir = join(projectDir, 'src');
  try {
    mkdirSync(srcDir);
  } catch (err) {
    throw new FileSystemError(
      `Failed to create src directory: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Build template variables
  const variables = buildTemplateVariables(config);

  // Define template mappings
  const templates = [
    { template: 'package.json.tmpl', output: 'package.json' },
    { template: 'host.ts.tmpl', output: 'src/host.ts' },
    { template: 'run.ts.tmpl', output: 'src/run.ts' },
    { template: 'agent.rill.tmpl', output: 'src/agent.rill' },
    { template: '.env.example.tmpl', output: '.env.example' },
    { template: 'CLAUDE.md.tmpl', output: 'CLAUDE.md' },
  ];

  // Add tsconfig.json if TypeScript enabled
  if (config.typescript) {
    templates.push({ template: 'tsconfig.json.tmpl', output: 'tsconfig.json' });
  }

  // Render and write all templates
  for (const { template, output } of templates) {
    const rendered = await renderTemplate(template, variables);
    const outputPath = join(projectDir, output);

    try {
      writeFileSync(outputPath, rendered, 'utf-8');
    } catch (err) {
      throw new FileSystemError(
        `Failed to write ${output}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Install dependencies if requested
  if (config.installDeps) {
    const installCmd = `${config.packageManager} install`;

    try {
      execSync(installCmd, {
        cwd: projectDir,
        stdio: 'inherit',
      });
    } catch (err) {
      throw new InstallError(
        `Failed to install dependencies: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Output success message
  console.log(`\n✓ Project ${config.projectName} created successfully!`);
  console.log(`\nNext steps:`);
  console.log(`  cd ${config.projectName}`);
  if (!config.installDeps) {
    console.log(`  ${config.packageManager} install`);
  }
  console.log(`  ${config.packageManager} start`);
}
