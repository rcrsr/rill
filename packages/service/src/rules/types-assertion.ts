/**
 * Detects redundant type assertions on literal values. Type assertions exist
 * for validation, not conversion; asserting a literal's own type is
 * unnecessary because the type is already known at parse time.
 *
 * Redundant patterns: 5:number, "hello":string, true:bool.
 * Valid patterns: parseJson($input):dict, $userInput:string.
 */

import type { ASTNode, SourceLocation, TypeAssertionNode } from '@rcrsr/rill';
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

/**
 * Walks `source` from `anchor` up to `targetOffset`, tracking line/column
 * as it crosses newlines, so an arbitrary offset within the source can be
 * translated back into a `SourceLocation` relative to a known anchor.
 */
function advancePosition(
  anchor: SourceLocation,
  source: string,
  targetOffset: number
): SourceLocation {
  let line = anchor.line;
  let column = anchor.column;
  for (let i = anchor.offset; i < targetOffset; i++) {
    if (source[i] === '\n') {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column, offset: targetOffset };
}

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

  // Search for the ':type' colon starting at the operand's own end, not at
  // the start of the assertion source, so a colon inside the operand itself
  // (e.g. a string literal like "a:b") is never mistaken for the type
  // separator. `operand.span.end` tracks the following sibling's start
  // rather than the operand's own text end, so the last method call (if
  // any) or the primary literal's own span is used instead.
  const lastMethod = operand.methods[operand.methods.length - 1];
  const operandEndOffset = lastMethod
    ? lastMethod.span.end.offset
    : operand.primary.span.end.offset;
  const searchStart = operandEndOffset - assertionNode.span.start.offset;
  const colonIndex = assertionSource.indexOf(':', searchStart);
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

  const startPosition = advancePosition(
    assertionNode.span.start,
    source,
    typeStart
  );
  const endPosition = advancePosition(startPosition, source, typeEnd);

  return {
    description: 'Remove unnecessary type assertion',
    applicable: true,
    range: {
      start: startPosition,
      end: endPosition,
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
