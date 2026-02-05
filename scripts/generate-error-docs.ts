#!/usr/bin/env npx tsx
/**
 * Generate docs/88_errors.md from ERROR_DEFINITIONS
 *
 * Reads error definitions from src/types.ts, validates required fields,
 * and generates structured markdown documentation.
 *
 * Validation:
 * - All entries must have cause, resolution, and examples fields
 * - Fails on missing documentation fields
 *
 * Usage:
 *   npx tsx scripts/generate-error-docs.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ErrorDefinition, ErrorExample } from '../src/types.js';

const OUTPUT_FILE = 'docs/88_errors.md';

/**
 * Generate markdown documentation from error definitions.
 * Validates all required fields and generates docs/88_errors.md.
 */
function generateErrorDocs(): void {
  const rootDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..'
  );
  const outputPath = path.join(rootDir, OUTPUT_FILE);

  // Import ERROR_DEFINITIONS dynamically
  // Note: We read from the compiled output in dist/
  const typesPath = path.join(rootDir, 'dist', 'types.js');
  if (!fs.existsSync(typesPath)) {
    console.error(
      'ERROR: types.js not found. Run "npm run build" first to compile TypeScript.'
    );
    process.exit(1);
  }

  // Dynamic import to get ERROR_DEFINITIONS (requires compiled dist/)
  import(typesPath)
    .then((module) => {
      const errorRegistry = module.ERROR_REGISTRY;
      if (!errorRegistry) {
        console.error('ERROR: ERROR_REGISTRY not found in types.js');
        process.exit(1);
      }

      // Extract all error definitions from registry
      const definitions: ErrorDefinition[] = [];
      for (const [, def] of errorRegistry.entries()) {
        definitions.push(def);
      }

      if (definitions.length === 0) {
        console.error('ERROR: No error definitions found in ERROR_REGISTRY');
        process.exit(1);
      }

      // Validate all definitions have required fields
      for (const def of definitions) {
        // EC-14: Missing cause field
        if (!def.cause) {
          throw new Error(`${def.errorId} missing cause field`);
        }

        // EC-15: Missing resolution field
        if (!def.resolution) {
          throw new Error(`${def.errorId} missing resolution field`);
        }

        // EC-16: Missing examples field
        if (!def.examples || def.examples.length === 0) {
          throw new Error(`${def.errorId} missing examples field`);
        }
      }

      // Group by category
      const byCategory: Record<
        string,
        { name: string; description: string; errors: ErrorDefinition[] }
      > = {
        lexer: {
          name: 'Lexer Errors',
          description:
            'Lexer errors occur during tokenization when the source text contains invalid character sequences or malformed literals.',
          errors: [],
        },
        parse: {
          name: 'Parse Errors',
          description:
            'Parse errors occur when token sequences violate rill syntax rules during AST construction.',
          errors: [],
        },
        runtime: {
          name: 'Runtime Errors',
          description:
            'Runtime errors occur during script execution when operations fail due to type mismatches, undefined references, or violated constraints.',
          errors: [],
        },
        check: {
          name: 'Check Errors',
          description:
            'Check errors occur in the `rill-check` CLI tool during file validation and configuration processing.',
          errors: [],
        },
      };

      // Categorize errors
      for (const def of definitions) {
        const categoryGroup = byCategory[def.category];
        if (!categoryGroup) {
          console.error(`ERROR: Unknown category: ${def.category}`);
          process.exit(1);
        }
        categoryGroup.errors.push(def);
      }

      // Sort errors by ID within each category
      for (const category of Object.values(byCategory)) {
        category.errors.sort((a, b) => a.errorId.localeCompare(b.errorId));
      }

      // Generate markdown
      const markdown = generateMarkdown(byCategory, definitions);

      // Write output file
      fs.writeFileSync(outputPath, markdown, 'utf-8');

      console.log(`Generated ${OUTPUT_FILE}`);
      console.log(`Total errors documented: ${definitions.length}`);
      console.log(
        `Categories: Lexer (${byCategory.lexer.errors.length}), Parse (${byCategory.parse.errors.length}), Runtime (${byCategory.runtime.errors.length}), Check (${byCategory.check.errors.length})`
      );
    })
    .catch((err) => {
      console.error('ERROR: Failed to import types.js:', err);
      process.exit(1);
    });
}

/**
 * Generate markdown content from categorized error definitions.
 */
function generateMarkdown(
  byCategory: Record<
    string,
    { name: string; description: string; errors: ErrorDefinition[] }
  >,
  allDefinitions: ErrorDefinition[]
): string {
  const lines: string[] = [];

  // Header
  lines.push('# rill Error Reference');
  lines.push('');
  lines.push(
    '*Comprehensive error documentation for troubleshooting and debugging*'
  );
  lines.push('');
  lines.push(
    'This document catalogs all error conditions in rill with descriptions, common causes, and resolution strategies. Each error has a unique ID formatted as `RILL-{category}{number}` (e.g., `RILL-R001`).'
  );
  lines.push('');
  lines.push('**Error Categories:**');
  lines.push('');
  lines.push('- **L**: Lexer errors (tokenization failures)');
  lines.push('- **P**: Parse errors (syntax violations)');
  lines.push('- **R**: Runtime errors (execution failures)');
  lines.push('- **C**: Check errors (CLI tool validation)');
  lines.push('');
  lines.push('**Navigation:**');
  lines.push('');

  // Navigation links
  for (const [category, group] of Object.entries(byCategory)) {
    if (group.errors.length === 0) continue;
    const first = group.errors[0]!.errorId;
    const last = group.errors[group.errors.length - 1]!.errorId;
    const anchor = categoryToAnchor(category);
    lines.push(`- [${group.name} (${first} - ${last})](#${anchor})`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  // Category sections
  for (const [category, group] of Object.entries(byCategory)) {
    if (group.errors.length === 0) continue;

    lines.push(`## ${group.name}`);
    lines.push('');
    lines.push(group.description);
    lines.push('');

    // Individual errors
    for (const def of group.errors) {
      lines.push(`### ${def.errorId.toLowerCase()}`);
      lines.push('');
      lines.push(`**Description:** ${def.description}`);
      lines.push('');
      lines.push(`**Cause:** ${def.cause}`);
      lines.push('');
      lines.push(`**Resolution:** ${def.resolution}`);
      lines.push('');

      // Examples
      if (def.examples && def.examples.length > 0) {
        lines.push('**Example:**');
        lines.push('');
        lines.push('```text');

        // Generate examples based on the examples array
        for (let i = 0; i < def.examples.length; i++) {
          const example = def.examples[i]!;
          if (i > 0) lines.push('');
          lines.push(`# ${example.description}`);
          lines.push(example.code);
        }

        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }
  }

  // Error Handling Patterns section
  lines.push('## Error Handling Patterns');
  lines.push('');
  lines.push('### Defensive Checks');
  lines.push('');
  lines.push('Prevent runtime errors with existence and type checks:');
  lines.push('');
  lines.push('```rill');
  lines.push('# Check variable existence before use');
  lines.push('[apiKey: "secret123"] => $config');
  lines.push('$config.?apiKey ? $config.apiKey ! "default-key"');
  lines.push('');
  lines.push('# Check type before method call');
  lines.push('"test" => $value');
  lines.push('$value :? string ? ($value -> .upper) ! $value');
  lines.push('');
  lines.push('# Validate before conversion');
  lines.push('"42" => $input');
  lines.push('$input -> .is_match("^[0-9]+$") ? (.num) ! 0');
  lines.push('```');
  lines.push('');
  lines.push('### Default Values');
  lines.push('');
  lines.push('Provide fallbacks for missing properties:');
  lines.push('');
  lines.push('```rill');
  lines.push('# Field with default');
  lines.push('[name: "Alice", age: 30] => $user');
  lines.push('$user.email ?? "no-email@example.com"');
  lines.push('');
  lines.push('# Annotation with default');
  lines.push('|x|($x) => $fn');
  lines.push('$fn.^timeout ?? 30');
  lines.push('');
  lines.push('# Dict dispatch with default');
  lines.push('[a: 1, b: 2, c: 3] => $lookup');
  lines.push('"b" -> $lookup ?? "not found"');
  lines.push('```');
  lines.push('');
  lines.push('### Type Assertions');
  lines.push('');
  lines.push('Explicitly verify and convert types:');
  lines.push('');
  lines.push('```rill');
  lines.push('# Assert type before operation');
  lines.push('"  hello  " => $input');
  lines.push('$input:string -> .trim');
  lines.push('');
  lines.push('# Check type before calling method');
  lines.push('[1, 2, 3] => $items');
  lines.push('$items :? list ? ($items -> .len) ! 0');
  lines.push('');
  lines.push('# Convert with validation');
  lines.push('"42" => $value');
  lines.push('$value -> .str -> .is_match("^[0-9]+$") ? (.num:number) ! 0');
  lines.push('```');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Getting Help');
  lines.push('');
  lines.push(
    'Each error message includes a help URL linking to this documentation:'
  );
  lines.push('');
  lines.push('```');
  lines.push('Error: Variable foo is not defined');
  lines.push(
    'Help: https://github.com/rcrsr/rill/blob/v0.5.0/docs/88_errors.md#rill-r005'
  );
  lines.push('```');
  lines.push('');
  lines.push('The URL format is:');
  lines.push('');
  lines.push('```');
  lines.push(
    'https://github.com/rcrsr/rill/blob/v{version}/docs/88_errors.md#{error-id}'
  );
  lines.push('```');
  lines.push('');
  lines.push('Where:');
  lines.push('- `{version}` is the rill package version (e.g., `v0.5.0`)');
  lines.push('- `{error-id}` is the lowercase error ID (e.g., `rill-r005`)');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Contributing');
  lines.push('');
  lines.push(
    'Found an error not documented here? [Submit an issue](https://github.com/rcrsr/rill/issues/new) with:'
  );
  lines.push('');
  lines.push('1. Error ID and message');
  lines.push('2. Code that triggers the error');
  lines.push('3. Expected vs actual behavior');
  lines.push('4. rill version');
  lines.push('');
  lines.push(
    'We maintain this documentation to help users resolve issues quickly and understand error conditions.'
  );
  lines.push('');

  return lines.join('\n');
}

/**
 * Convert category name to anchor link.
 */
function categoryToAnchor(category: string): string {
  const names: Record<string, string> = {
    lexer: 'lexer-errors',
    parse: 'parse-errors',
    runtime: 'runtime-errors',
    check: 'check-errors',
  };
  return names[category] || category;
}

generateErrorDocs();
