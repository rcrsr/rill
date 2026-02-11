/**
 * Template rendering using Handlebars.
 * Resolves template paths relative to templates/ directory.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

// ============================================================
// HANDLEBARS HELPERS
// ============================================================

// Register 'eq' helper for equality comparisons in templates
Handlebars.registerHelper('eq', function (a: unknown, b: unknown): boolean {
  return a === b;
});

// ============================================================
// ERROR CLASSES
// ============================================================

/**
 * Error for file system operations (missing files, read errors).
 */
export class FileSystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSystemError';
  }
}

/**
 * Error for template compilation or rendering failures.
 */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

// ============================================================
// TEMPLATE RENDERING
// ============================================================

/**
 * Render a Handlebars template with provided variables.
 * Template paths are resolved relative to templates/ directory within package.
 *
 * @param templatePath - Template file path (e.g., 'package.json.tmpl')
 * @param variables - Data context for template rendering
 * @returns Rendered template string
 * @throws {FileSystemError} Template file not found
 * @throws {TemplateError} Template syntax error or rendering failure
 *
 * @example
 * ```typescript
 * const output = await renderTemplate('package.json.tmpl', {
 *   name: 'my-app',
 *   version: '1.0.0'
 * });
 * ```
 */
export async function renderTemplate(
  templatePath: string,
  variables: Record<string, unknown>
): Promise<string> {
  // Resolve template path relative to package's templates/ directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fullPath = join(__dirname, '..', 'templates', templatePath);

  // Read template file
  let templateSource: string;
  try {
    templateSource = await readFile(fullPath, 'utf-8');
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      err.code === 'ENOENT'
    ) {
      throw new FileSystemError(
        `Template not found: ${templatePath} (tried: ${fullPath})`
      );
    }
    throw new FileSystemError(
      `Failed to read template: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Compile and render template
  try {
    const template = Handlebars.compile(templateSource);
    return template(variables);
  } catch (err) {
    throw new TemplateError(
      `Template rendering failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
