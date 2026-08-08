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
import type {
  Diagnostic,
  DiagnosticEdit,
  DiagnosticFix,
  Rule,
  RuleContext,
} from './types.js';
import type { ReferenceEntry } from './facts.js';
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

/**
 * Derives the true `$name` text span for a `referenceLog` entry.
 *
 * `VariableNode.span` for a bare `$name` reference is a zero-width point
 * anchored at the `$` (confirmed by direct parse of `$x` in `$x + 1`: span
 * start === end) - the parser never widens it to cover the name text. Only
 * `ClosureCall` nodes (`$fn(...)`) carry a span that covers real source
 * text, so those pass through unchanged. This mirrors
 * `nameOnlySpan` in `src/scope/locate-target.ts` (same `1 + name.length`
 * anchored-at-start arithmetic), reimplemented locally: it's pure span
 * arithmetic over already-computed facts, not a binding-identity lookup, so
 * it doesn't cross the rules/scope firewall (`src/rules/**` may not import
 * `src/scope/`).
 */
function referenceSpan(entry: ReferenceEntry): SourceSpan {
  if (entry.node.type !== 'Variable') {
    return entry.node.span;
  }
  const { start } = entry.node.span;
  const width = 1 + entry.name.length;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + width,
      offset: start.offset + width,
    },
  };
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

/** Discriminates the definition-site kind a fix is being built for. */
type NamingFixKind = 'capture' | 'param' | 'dictKey';

/**
 * Build a rename fix for a naming violation at `range`, or withhold (`null`)
 * when the rename cannot be applied safely.
 *
 * Withholds (§BASIC.12.1 fail loud - the diagnostic still fires, only the
 * fix is dropped):
 * - `capture` with more than one capture of `name` in scope: binding
 *   identity is ambiguous without scope resolution, which the rules
 *   firewall (`src/rules/**` may not import `src/scope/`) forbids computing.
 * - `capture`/`param` when `toSnakeCase(name)` collides with an existing
 *   capture: renaming would merge two distinct variables.
 * - `dictKey` when the script has any dynamically-keyed field access
 *   (`.($expr)`, `.$var`, `.{...}`): a bare-identifier rename could silently
 *   retarget a computed lookup elsewhere in the script.
 *
 * For `capture`, the primary edit rewrites the declaration span and
 * `additionalEdits` carries one edit per reference to `name` in
 * `context.facts.script.referenceLog`, keeping every rewritten site
 * disjoint from the primary edit and from each other.
 */
function buildFix(
  context: RuleContext,
  kind: NamingFixKind,
  name: string,
  range: SourceSpan
): DiagnosticFix | null {
  if (!name || isSnakeCase(name)) {
    return null;
  }

  const snakeCaseName = toSnakeCase(name);
  const { captureLog, referenceLog, hasDynamicFieldAccess } =
    context.facts.script;

  if (kind === 'dictKey') {
    if (hasDynamicFieldAccess) {
      return null;
    }
  } else {
    // capture / param: withhold if the snake_case target already names a
    // captured variable (would merge two bindings).
    const collides = captureLog.some(
      (entry) => entry.node.name === snakeCaseName
    );
    if (collides) {
      return null;
    }

    if (kind === 'capture') {
      const bindingCount = captureLog.filter(
        (entry) => entry.node.name === name
      ).length;
      if (bindingCount > 1) {
        return null;
      }
    }
  }

  const sourceTextAt = (span: SourceSpan): string =>
    context.source.substring(span.start.offset, span.end.offset);

  const replacement = sourceTextAt(range).replace(name, snakeCaseName);

  let additionalEdits: readonly DiagnosticEdit[] | undefined;
  if (kind === 'capture') {
    const edits: DiagnosticEdit[] = [];
    for (const entry of referenceLog) {
      if (entry.name !== name) continue;
      const span = referenceSpan(entry);
      edits.push({
        range: span,
        replacement: sourceTextAt(span).replace(name, snakeCaseName),
      });
    }
    if (edits.length > 0) {
      additionalEdits = edits;
    }
  }

  return {
    description: `Rename '${name}' to '${snakeCaseName}'`,
    applicable: true,
    range,
    replacement,
    ...(additionalEdits ? { additionalEdits } : {}),
  };
}

// ============================================================
// RULE
// ============================================================

export const namingSnakeCase: Rule = {
  code: 'NAMING_SNAKE_CASE',
  nodeTypes: ['ClosureParam', 'DictEntry', 'Capture'],
  defaultSeverity: 'error',
  category: 'naming',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    switch (node.type) {
      case 'ClosureParam': {
        const paramNode = node as ClosureParamNode;
        const name = paramNode.name;

        if (!isSnakeCase(name)) {
          const fix = buildFix(context, 'param', name, paramNode.span);
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
          const fix = buildFix(context, 'dictKey', key, entryNode.span);
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
          const fix = buildFix(context, 'capture', name, captureNode.span);
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
