/**
 * Naming Convention Rules
 * Enforces snake_case naming for variables, parameters, and dict keys.
 */

import type {
  ValidationRule,
  Diagnostic,
  Fix,
  ValidationContext,
  FixContext,
} from '../types.js';
import type {
  ASTNode,
  ClosureParamNode,
  DictEntryNode,
  CaptureNode,
  SourceLocation,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// NAMING VALIDATION
// ============================================================

/**
 * Check if a name follows snake_case convention.
 * Valid: user_name, item_list, is_valid, x, count
 * Invalid: userName, ItemList, user-name, user.name
 */
function isSnakeCase(name: string): boolean {
  // Empty string is invalid
  if (!name) return false;

  // Must match: lowercase letters, numbers, underscores only
  // Must start with letter or underscore
  // No consecutive underscores, no trailing underscore
  const snakeCasePattern = /^[a-z_][a-z0-9_]*$/;
  if (!snakeCasePattern.test(name)) return false;

  // Reject consecutive underscores
  if (name.includes('__')) return false;

  // Reject trailing underscore (unless single underscore)
  if (name.length > 1 && name.endsWith('_')) return false;

  return true;
}

/**
 * Convert a name to snake_case.
 * Handles camelCase, PascalCase, kebab-case, and mixed formats.
 */
function toSnakeCase(name: string): string {
  return (
    name
      // Handle consecutive uppercase (XMLParser -> xml_parser)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      // Insert underscore before uppercase letters (camelCase -> camel_case)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      // Replace hyphens and dots with underscores
      .replace(/[-.\s]+/g, '_')
      // Convert to lowercase
      .toLowerCase()
      // Remove consecutive underscores
      .replace(/_+/g, '_')
      // Remove leading/trailing underscores
      .replace(/^_+|_+$/g, '')
  );
}

/**
 * Create a diagnostic for snake_case violation.
 */
function createNamingDiagnostic(
  location: SourceLocation,
  name: string,
  kind: string,
  context: ValidationContext,
  fix: Fix | null
): Diagnostic {
  const message = `${kind} '${name}' should use snake_case (e.g., '${toSnakeCase(name)}')`;

  return {
    location,
    severity: 'error',
    code: 'NAMING_SNAKE_CASE',
    message,
    context: extractContextLine(location.line, context.source),
    fix,
  };
}

// ============================================================
// NAMING_SNAKE_CASE RULE
// ============================================================

/**
 * Validates that variable definitions, parameters, and dict keys use snake_case.
 *
 * Checks definition sites only (not variable usage):
 * - Captures: :> $user_name, :> $item_list, :> $is_valid
 * - Closure params: |user_name, count| { }
 * - Dict keys: [user_name: "Alice", is_active: true]
 *
 * Exceptions:
 * - Single-letter names are valid (common for loop variables)
 *
 * References:
 * - docs/16_conventions.md:10-53
 */
export const NAMING_SNAKE_CASE: ValidationRule = {
  code: 'NAMING_SNAKE_CASE',
  category: 'naming',
  severity: 'error',
  nodeTypes: ['ClosureParam', 'DictEntry', 'Capture'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    switch (node.type) {
      case 'ClosureParam': {
        const paramNode = node as ClosureParamNode;
        const name = paramNode.name;

        if (!isSnakeCase(name)) {
          const fix = this.fix?.(node, context) ?? null;
          return [
            createNamingDiagnostic(
              paramNode.span.start,
              name,
              'Parameter',
              context,
              fix
            ),
          ];
        }
        return [];
      }

      case 'DictEntry': {
        const entryNode = node as DictEntryNode;
        const key = entryNode.key;

        // Skip multi-key entries (tuple keys) - only validate string keys
        if (typeof key !== 'string') {
          return [];
        }

        if (!isSnakeCase(key)) {
          const fix = this.fix?.(node, context) ?? null;
          return [
            createNamingDiagnostic(
              entryNode.span.start,
              key,
              'Dict key',
              context,
              fix
            ),
          ];
        }
        return [];
      }

      case 'Capture': {
        const captureNode = node as CaptureNode;
        const name = captureNode.name;

        if (!isSnakeCase(name)) {
          const fix = this.fix?.(node, context) ?? null;
          return [
            createNamingDiagnostic(
              captureNode.span.start,
              name,
              'Captured variable',
              context,
              fix
            ),
          ];
        }
        return [];
      }

      default:
        return [];
    }
  },

  fix(node: ASTNode, context: FixContext): Fix | null {
    let name: string | null = null;
    let range = node.span;

    // Extract name and determine replacement range
    switch (node.type) {
      case 'ClosureParam': {
        const paramNode = node as ClosureParamNode;
        name = paramNode.name;
        break;
      }

      case 'DictEntry': {
        const entryNode = node as DictEntryNode;
        // Skip multi-key entries (tuple keys) - only fix string keys
        if (typeof entryNode.key === 'string') {
          name = entryNode.key;
          // For dict entries, replace only the key portion before the colon
        }
        break;
      }

      case 'Capture': {
        const captureNode = node as CaptureNode;
        name = captureNode.name;
        break;
      }

      default:
        return null;
    }

    if (!name || isSnakeCase(name)) {
      return null;
    }

    const snakeCaseName = toSnakeCase(name);

    // Get original source text for this node
    const sourceText = context.source.substring(
      range.start.offset,
      range.end.offset
    );

    // Replace the original name with snake_case version
    // This preserves $ prefix for variables and : for dict entries
    const replacement = sourceText.replace(name, snakeCaseName);

    return {
      description: `Rename '${name}' to '${snakeCaseName}'`,
      applicable: true,
      range,
      replacement,
    };
  },
};
