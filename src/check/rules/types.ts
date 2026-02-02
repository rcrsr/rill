/**
 * Type Safety Convention Rules
 * Enforces type annotation best practices from docs/16_conventions.md:288-316.
 */

import type {
  ValidationRule,
  Diagnostic,
  Fix,
  ValidationContext,
  FixContext,
} from '../types.js';
import type { ASTNode, HostCallNode, TypeAssertionNode } from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// UNNECESSARY_ASSERTION RULE
// ============================================================

/**
 * Detects redundant type assertions on literal values.
 * Type assertions are for validation, not conversion. Asserting a literal's
 * type is unnecessary because the type is already known at parse time.
 *
 * Redundant patterns:
 * - 5:number (number literal with number assertion)
 * - "hello":string (string literal with string assertion)
 * - true:bool (bool literal with bool assertion)
 *
 * Valid patterns:
 * - parseJson($input):dict (external input validation)
 * - $userInput:string (runtime validation)
 *
 * References:
 * - docs/16_conventions.md:305-315
 */
export const UNNECESSARY_ASSERTION: ValidationRule = {
  code: 'UNNECESSARY_ASSERTION',
  category: 'types',
  severity: 'info',
  nodeTypes: ['TypeAssertion'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const assertionNode = node as TypeAssertionNode;
    const operand = assertionNode.operand;

    // Bare assertions (:type) are valid - they check pipe value
    if (!operand) {
      return [];
    }

    // operand is PostfixExprNode - check the primary
    const primary = operand.primary;

    // Check if primary is a literal
    const isLiteral =
      primary.type === 'NumberLiteral' ||
      primary.type === 'StringLiteral' ||
      primary.type === 'BoolLiteral';

    if (!isLiteral) {
      return [];
    }

    // Check if the assertion matches the literal type
    const literalType = getLiteralType(primary);
    const assertedType = assertionNode.typeName;

    if (literalType === assertedType) {
      const fix = this.fix?.(node, context) ?? null;

      return [
        {
          location: assertionNode.span.start,
          severity: 'info',
          code: 'UNNECESSARY_ASSERTION',
          message: `Type assertion on ${literalType} literal is unnecessary`,
          context: extractContextLine(
            assertionNode.span.start.line,
            context.source
          ),
          fix,
        },
      ];
    }

    return [];
  },

  fix(node: ASTNode, context: FixContext): Fix | null {
    const assertionNode = node as TypeAssertionNode;
    const operand = assertionNode.operand;

    if (!operand) {
      return null;
    }

    // Find the end of the type assertion (:type part)
    const assertionSource = context.source.substring(
      assertionNode.span.start.offset,
      assertionNode.span.end.offset
    );

    // The type assertion is "literal:type" - we want to keep only "literal"
    // Find the : character position
    const colonIndex = assertionSource.indexOf(':');
    if (colonIndex === -1) {
      return null;
    }

    // Calculate the actual end of ":type" part
    const typeStart = assertionNode.span.start.offset + colonIndex;
    const typeEnd = typeStart + 1 + assertionNode.typeName.length;

    return {
      description: 'Remove unnecessary type assertion',
      applicable: true,
      range: {
        start: { ...assertionNode.span.start, offset: typeStart },
        end: { ...assertionNode.span.start, offset: typeEnd },
      },
      replacement: '',
    };
  },
};

/**
 * Get the type name of a literal node.
 */
function getLiteralType(
  node: ASTNode
): 'string' | 'number' | 'bool' | 'list' | 'dict' | null {
  switch (node.type) {
    case 'NumberLiteral':
      return 'number';
    case 'StringLiteral':
      return 'string';
    case 'BoolLiteral':
      return 'bool';
    case 'Tuple':
      return 'list';
    case 'Dict':
      return 'dict';
    default:
      return null;
  }
}

// ============================================================
// VALIDATE_EXTERNAL RULE
// ============================================================

/**
 * Recommends type assertions for external input validation.
 * External inputs (from host functions, user input, parsed data) should be
 * validated with type assertions to ensure type safety.
 *
 * Detection heuristics:
 * - Host function calls (HostCall nodes)
 * - Parsing functions (parse_json, parse_xml, etc.)
 * - Variables from external sources ($ARGS, $ENV)
 *
 * This is an informational rule - not all external data needs assertions,
 * but it's a good practice for critical paths.
 *
 * References:
 * - docs/16_conventions.md:307-311
 */
export const VALIDATE_EXTERNAL: ValidationRule = {
  code: 'VALIDATE_EXTERNAL',
  category: 'types',
  severity: 'info',
  nodeTypes: ['HostCall'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const hostCallNode = node as HostCallNode;
    const functionName = hostCallNode.name;

    // Skip namespaced functions (ns::func) - these are trusted host APIs
    if (functionName.includes('::')) {
      return [];
    }

    // Check if this is a parsing or external data function
    const isExternalDataFunction =
      functionName.startsWith('parse_') ||
      functionName.includes('fetch') ||
      functionName.includes('read') ||
      functionName.includes('load');

    if (!isExternalDataFunction) {
      return [];
    }

    // Skip if this HostCall is already wrapped in a TypeAssertion
    if (context.assertedHostCalls.has(node)) {
      return [];
    }

    return [
      {
        location: hostCallNode.span.start,
        severity: 'info',
        code: 'VALIDATE_EXTERNAL',
        message: `Consider validating external input with type assertion: ${functionName}():type`,
        context: extractContextLine(
          hostCallNode.span.start.line,
          context.source
        ),
        fix: null, // Cannot auto-fix - requires developer judgment
      },
    ];
  },
};
