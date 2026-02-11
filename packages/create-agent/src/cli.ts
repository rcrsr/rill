#!/usr/bin/env node
/**
 * rill-create-agent CLI entry point
 * Scaffolds new rill extension projects
 */

import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { scaffold, type ScaffoldConfig } from './scaffold.js';
import {
  getExtensionConfig,
  resolvePreset,
  ValidationError,
} from './extensions.js';

// ============================================================
// TYPES
// ============================================================

interface ParsedFlags {
  extensions: string[] | null;
  preset: string | null;
  description: string | null;
  packageManager: 'npm' | 'pnpm' | 'yarn' | null;
  noInstall: boolean;
  typescript: boolean;
}

// ============================================================
// NPM PACKAGE NAME VALIDATION
// ============================================================

/**
 * Validate project name against npm package naming rules.
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
  // AC-15: Empty project name
  if (!name || name.trim().length === 0) {
    return 'Project name must be valid npm package name';
  }

  // AC-16: Project name = .
  if (name === '.') {
    return 'Project name must be valid npm package name';
  }

  // Check for path traversal
  if (name.includes('..') || name.includes('\\')) {
    return 'Project name must be valid npm package name';
  }

  // Handle scoped packages (@scope/name)
  const scopedPattern = /^@[a-z0-9-_]+\/[a-z0-9-_]+$/;
  const unscopedPattern = /^[a-z0-9-_]+$/;

  if (name.startsWith('@')) {
    if (!scopedPattern.test(name)) {
      return 'Project name must be valid npm package name';
    }
  } else {
    // Check for slashes in unscoped names
    if (name.includes('/')) {
      return 'Project name must be valid npm package name';
    }
    if (!unscopedPattern.test(name)) {
      return 'Project name must be valid npm package name';
    }
  }

  return true;
}

/**
 * Validate package manager value.
 *
 * @param value - Package manager string
 * @returns true if valid, error message otherwise
 */
function validatePackageManager(
  value: string
): value is 'npm' | 'pnpm' | 'yarn' {
  return value === 'npm' || value === 'pnpm' || value === 'yarn';
}

// ============================================================
// ARGUMENT PARSING
// ============================================================

/**
 * Parse CLI flags from arguments.
 * Extracts --extensions, --preset, --description, --package-manager, --no-install, --typescript.
 *
 * @param args - Command-line arguments (excluding project name)
 * @returns Parsed flags object
 */
function parseFlags(args: string[]): ParsedFlags {
  const flags: ParsedFlags = {
    extensions: null,
    preset: null,
    description: null,
    packageManager: null,
    noInstall: false,
    typescript: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--extensions') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new ValidationError('--extensions requires a value');
      }
      flags.extensions = value.split(',').map((ext) => ext.trim());
      i++; // Skip next arg
    } else if (arg === '--preset') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new ValidationError('--preset requires a value');
      }
      flags.preset = value;
      i++; // Skip next arg
    } else if (arg === '--description') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new ValidationError('--description requires a value');
      }
      flags.description = value;
      i++; // Skip next arg
    } else if (arg === '--package-manager') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        throw new ValidationError('--package-manager requires a value');
      }
      // AC-19: Unknown package manager value
      if (!validatePackageManager(value)) {
        throw new ValidationError(
          `Invalid --package-manager value: ${value}. Must be one of: npm, pnpm, yarn`
        );
      }
      flags.packageManager = value;
      i++; // Skip next arg
    } else if (arg === '--no-install') {
      flags.noInstall = true;
    } else if (arg === '--typescript') {
      flags.typescript = true;
    } else if (!arg.startsWith('--')) {
      throw new ValidationError(`Unknown argument: ${arg}`);
    } else {
      throw new ValidationError(`Unknown flag: ${arg}`);
    }
  }

  return flags;
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Get list of valid extension names for error messages.
 *
 * @returns Comma-separated list of valid extension names
 */
function getValidExtensionNames(): string {
  const extensions = [
    'anthropic',
    'openai',
    'gemini',
    'claude-code',
    'qdrant',
    'pinecone',
    'chroma',
  ];
  return extensions.join(', ');
}

/**
 * Validate extension names against config map.
 *
 * @param extensions - Extension names to validate
 * @throws ValidationError if any extension is unknown
 */
function validateExtensions(extensions: string[]): void {
  for (const ext of extensions) {
    const config = getExtensionConfig(ext);
    if (config === null) {
      // EC-2: Unknown extension name
      throw new ValidationError(
        `Unknown extension: ${ext}. Valid: ${getValidExtensionNames()}`
      );
    }
  }
}

/**
 * Validate that --extensions or --preset is provided.
 *
 * @param flags - Parsed flags
 * @throws ValidationError if validation fails
 */
function validateFlags(flags: ParsedFlags): void {
  // EC-4: --preset and --extensions both provided
  if (flags.preset !== null && flags.extensions !== null) {
    throw new ValidationError('Cannot combine --preset and --extensions');
  }

  // EC-5: No --extensions or --preset
  if (flags.preset === null && flags.extensions === null) {
    throw new ValidationError(
      'Provide --extensions or --preset to select extensions'
    );
  }
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Parse CLI arguments and invoke scaffold function.
 * All inputs must be provided via flags (no interactive mode).
 *
 * @param args - Command-line arguments (first positional is project name, rest are flags)
 */
export async function main(args: string[]): Promise<void> {
  try {
    // Extract project name (first positional argument)
    const projectName = args[0];

    if (!projectName) {
      console.error('Error: Missing project name');
      console.error(
        'Usage: rill-create-agent <project-name> --extensions <ext1,ext2> [options]'
      );
      process.exit(1);
    }

    // EC-1: Invalid project name
    const validationResult = validateProjectName(projectName);
    if (validationResult !== true) {
      throw new ValidationError(validationResult);
    }

    // Parse flags (remaining args)
    const flags = parseFlags(args.slice(1));

    // Validate required flags
    validateFlags(flags);

    let extensions: string[];

    if (flags.preset !== null) {
      // EC-3: Unknown preset name
      const preset = resolvePreset(flags.preset);
      extensions = [...preset.extensions];
    } else {
      extensions = flags.extensions!;
      validateExtensions(extensions);
    }

    const description = flags.description ?? '';

    // Build scaffold config
    const config: ScaffoldConfig = {
      projectName,
      extensions,
      description,
      packageManager: flags.packageManager ?? 'npm',
      typescript: flags.typescript,
      installDeps: !flags.noInstall,
      starterPattern: flags.preset
        ? resolvePreset(flags.preset).starterPattern
        : null,
    };

    // Execute scaffolding
    await scaffold(config);
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    // Re-throw other errors
    throw error;
  }
}

// ============================================================
// CLI EXECUTION
// ============================================================

// Only run main if this file is executed directly (not imported)
// Use realpathSync to resolve symlinks created by npx, global install, etc.
const __thisFile = realpathSync(fileURLToPath(import.meta.url));
const __execFile = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (__execFile === __thisFile) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
