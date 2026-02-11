#!/usr/bin/env node
/**
 * rill-create-agent CLI entry point
 * Scaffolds new rill extension projects
 */

import { fileURLToPath } from 'node:url';
import { input, checkbox } from '@inquirer/prompts';
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
// MODE DETECTION
// ============================================================

/**
 * Determine if any flag was provided (non-interactive mode).
 *
 * @param flags - Parsed flags
 * @returns true if any flag present (non-interactive), false if no flags (interactive)
 */
function isNonInteractiveMode(flags: ParsedFlags): boolean {
  return (
    flags.extensions !== null ||
    flags.preset !== null ||
    flags.description !== null ||
    flags.packageManager !== null ||
    flags.noInstall ||
    flags.typescript
  );
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
 * Validate non-interactive mode requirements.
 *
 * @param flags - Parsed flags
 * @throws ValidationError if validation fails
 */
function validateNonInteractiveMode(flags: ParsedFlags): void {
  // EC-4: --preset and --extensions both provided
  if (flags.preset !== null && flags.extensions !== null) {
    throw new ValidationError('Cannot combine --preset and --extensions');
  }

  // EC-5: Non-interactive mode, no --extensions or --preset
  if (flags.preset === null && flags.extensions === null) {
    throw new ValidationError(
      'Provide --extensions or --preset (or omit all flags for interactive mode)'
    );
  }
}

// ============================================================
// INTERACTIVE MODE
// ============================================================

/**
 * Prompt user for extension selection and description.
 *
 * @returns Extensions and description from user input
 */
async function promptForInput(): Promise<{
  extensions: string[];
  description: string;
}> {
  // Prompt for extensions (multi-select)
  const extensions = await checkbox({
    message: 'Select extensions to include:',
    choices: [
      { name: 'Anthropic Claude', value: 'anthropic' },
      { name: 'OpenAI', value: 'openai' },
      { name: 'Google Gemini', value: 'gemini' },
      { name: 'Claude Code', value: 'claude-code' },
      { name: 'Qdrant Vector DB', value: 'qdrant' },
      { name: 'Pinecone Vector DB', value: 'pinecone' },
      { name: 'Chroma Vector DB', value: 'chroma' },
    ],
  });

  // Prompt for description
  const description = await input({
    message: 'Project description:',
    default: '',
  });

  return { extensions, description };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Parse CLI arguments and invoke scaffold function.
 *
 * Mode Selection:
 * - Any flag provided -> non-interactive (uses flag values, errors on missing required data)
 * - No flags provided -> interactive (prompts for extension selection and description)
 *
 * @param args - Command-line arguments (first positional is project name, rest are flags)
 */
export async function main(args: string[]): Promise<void> {
  try {
    // Extract project name (first positional argument)
    const projectName = args[0];

    if (!projectName) {
      console.error('Error: Missing project name');
      console.error('Usage: rill-create-agent <project-name> [options]');
      process.exit(1);
    }

    // EC-1: Invalid project name
    const validationResult = validateProjectName(projectName);
    if (validationResult !== true) {
      throw new ValidationError(validationResult);
    }

    // Parse flags (remaining args)
    const flags = parseFlags(args.slice(1));

    // Determine mode
    const nonInteractive = isNonInteractiveMode(flags);

    let extensions: string[];
    let description: string;

    if (nonInteractive) {
      // Non-interactive mode: validate flags and use values
      validateNonInteractiveMode(flags);

      if (flags.preset !== null) {
        // EC-3: Unknown preset name
        const preset = resolvePreset(flags.preset);
        extensions = [...preset.extensions];
      } else {
        extensions = flags.extensions!;
        validateExtensions(extensions);
      }

      description = flags.description ?? '';
    } else {
      // Interactive mode: prompt for input
      const input = await promptForInput();
      extensions = input.extensions;
      description = input.description;
    }

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
// Convert import.meta.url to file path and compare with process.argv[1]
// This works reliably with npx, global install, and direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
