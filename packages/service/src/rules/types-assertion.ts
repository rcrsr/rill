/**
 * Detects redundant type assertions on literal values. Type assertions exist
 * for validation, not conversion; asserting a literal's own type is
 * unnecessary because the type is already known at parse time.
 *
 * Redundant patterns: 5:number, "hello":string, true:bool.
 * Valid patterns: parseJson($input):dict, $userInput:string.
 */

import type { ASTNode, TypeAssertionNode } from '@rcrsr/rill';
import type { Diagnostic, DiagnosticFix, Rule, RuleContext } from './types.js';
import { extractContextLine } from './helpers.js';
import { registeredRules } from './rules-registry.js';

// ============================================================
// LITERAL TYPE RESOLUTION
// ============================================================

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
    case 'TupleLiteral':
      return 'list';
    case 'Dict':
      return 'dict';
    default:
      return null;
  }
}

// ============================================================
// FIX CONSTRUCTION
// ============================================================

function buildFix(
  assertionNode: TypeAssertionNode,
  source: string
): DiagnosticFix | null {
  const operand = assertionNode.operand;
  if (!operand) {
    return null;
  }

  const typeRef = assertionNode.typeRef;
  if (typeRef.kind !== 'static') {
    return null;
  }

  const assertionSource = source.substring(
    assertionNode.span.start.offset,
    assertionNode.span.end.offset
  );

  const colonIndex = assertionSource.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const typeStart = assertionNode.span.start.offset + colonIndex;
  let typeEnd = typeStart + 1 + typeRef.typeName.length;
  if (source[typeEnd] === '(') {
    let depth = 0;
    let i = typeEnd;
    while (i < source.length) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') {
        depth--;
        if (depth === 0) {
          typeEnd = i + 1;
          break;
        }
      }
      i++;
    }
  }

  return {
    description: 'Remove unnecessary type assertion',
    applicable: true,
    range: {
      start: { ...assertionNode.span.start, offset: typeStart },
      end: { ...assertionNode.span.start, offset: typeEnd },
    },
    replacement: '',
  };
}

// ============================================================
// RULE
// ============================================================

export const unnecessaryAssertion: Rule = {
  code: 'UNNECESSARY_ASSERTION',
  nodeTypes: ['TypeAssertion'],
  defaultSeverity: 'info',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const assertionNode = node as TypeAssertionNode;
    const operand = assertionNode.operand;

    // Bare assertions (:type) are valid - they check the pipe value.
    if (!operand) {
      return [];
    }

    const primary = operand.primary;

    const isLiteral =
      primary.type === 'NumberLiteral' ||
      primary.type === 'StringLiteral' ||
      primary.type === 'BoolLiteral' ||
      primary.type === 'TupleLiteral';

    if (!isLiteral) {
      return [];
    }

    const literalType = getLiteralType(primary);
    const typeRef = assertionNode.typeRef;
    if (typeRef.kind !== 'static') {
      return [];
    }
    const assertedType = typeRef.typeName;

    if (literalType === assertedType) {
      const fix = buildFix(assertionNode, context.source);

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
};

registeredRules.push(unnecessaryAssertion);
