/**
 * Enforces snake_case naming for variable captures, closure parameters, and
 * dict keys. Checks definition sites only (not usage sites).
 *
 * Exceptions:
 * - Single-letter names are valid (common for loop variables).
 * - Quoted-string dict keys (`["maxResults": 10]`) are an intentional escape
 *   for foreign API keys the author does not own; the `keyForm: 'string'`
 *   AST flag distinguishes these from bare-identifier keys, which still fire.
 */

import type {
  ASTNode,
  CaptureNode,
  ClosureParamNode,
  DictEntryNode,
  SourceLocation,
  SourceSpan,
} from '@rcrsr/rill';
import type { Diagnostic, DiagnosticFix, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// SNAKE_CASE HELPERS
// ============================================================

/**
 * Check if a name follows snake_case convention.
 * Valid: user_name, item_list, is_valid, x, count
 * Invalid: userName, ItemList, user-name, user.name
 */
function isSnakeCase(name: string): boolean {
  if (!name) return false;

  const snakeCasePattern = /^[a-z_][a-z0-9_]*$/;
  if (!snakeCasePattern.test(name)) return false;

  if (name.includes('__')) return false;

  if (name.length > 1 && name.endsWith('_')) return false;

  return true;
}

/**
 * Convert a name to snake_case.
 * Handles camelCase, PascalCase, kebab-case, and mixed formats.
 */
function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-.\s]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// ============================================================
// DIAGNOSTIC CONSTRUCTION
// ============================================================

function createNamingDiagnostic(
  location: SourceLocation,
  name: string,
  kind: string,
  context: RuleContext,
  fix: DiagnosticFix | null,
  hint = ''
): Diagnostic {
  const base = `${kind} '${name}' should use snake_case (e.g., '${toSnakeCase(name)}')`;
  const message = hint !== '' ? `${base}. ${hint}` : base;

  return {
    location,
    severity: 'error',
    code: 'NAMING_SNAKE_CASE',
    message,
    context: extractContextLine(location.line, context.source),
    fix,
  };
}

function buildFix(
  name: string,
  range: SourceSpan,
  source: string
): DiagnosticFix | null {
  if (!name || isSnakeCase(name)) {
    return null;
  }

  const snakeCaseName = toSnakeCase(name);
  const sourceText = source.substring(range.start.offset, range.end.offset);
  const replacement = sourceText.replace(name, snakeCaseName);

  return {
    description: `Rename '${name}' to '${snakeCaseName}'`,
    applicable: true,
    range,
    replacement,
  };
}

// ============================================================
// RULE
// ============================================================

export const namingSnakeCase: Rule = {
  code: 'NAMING_SNAKE_CASE',
  nodeTypes: ['ClosureParam', 'DictEntry', 'Capture'],
  defaultSeverity: 'error',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    switch (node.type) {
      case 'ClosureParam': {
        const paramNode = node as ClosureParamNode;
        const name = paramNode.name;

        if (!isSnakeCase(name)) {
          const fix = buildFix(name, paramNode.span, context.source);
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

        if (typeof key !== 'string') {
          return [];
        }

        if (entryNode.keyForm === 'string') {
          return [];
        }

        if (!isSnakeCase(key)) {
          const fix = buildFix(key, entryNode.span, context.source);
          return [
            createNamingDiagnostic(
              entryNode.span.start,
              key,
              'Dict key',
              context,
              fix,
              `For foreign API keys you don't own, use the quoted-key form: ["${key}": ...]`
            ),
          ];
        }
        return [];
      }

      case 'Capture': {
        const captureNode = node as CaptureNode;
        const name = captureNode.name;

        if (!isSnakeCase(name)) {
          const fix = buildFix(name, captureNode.span, context.source);
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
};

registeredRules.push(namingSnakeCase);
