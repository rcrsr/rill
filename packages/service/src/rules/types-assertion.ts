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
): 'string' | 'number' | 'bool' | 'list' | 'tuple' | 'dict' | null {
  switch (node.type) {
    case 'NumberLiteral':
      return 'number';
    case 'StringLiteral':
      return 'string';
    case 'BoolLiteral':
      return 'bool';
    case 'ListLiteral':
      return 'list';
    case 'TupleLiteral':
      return 'tuple';
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

  const assertionSource = source.slice(
    assertionNode.span.start.offset,
    assertionNode.span.end.offset
  );

  // Search for the ':type' colon from the end of the literal, so a colon
  // inside the literal itself (e.g. "a:b") is never mistaken for the type
  // separator. The rule only fires on a bare literal operand, so the
  // literal's end is the operand's end.
  const searchStart =
    operand.primary.span.end.offset - assertionNode.span.start.offset;
  const colonIndex = assertionSource.indexOf(':', searchStart);
  if (colonIndex === -1) {
    return null;
  }

  const typeStart = assertionNode.span.start.offset + colonIndex;
  // The assertion span ends at the last token of the type reference, so
  // the type text runs to the span end. Counting parentheses in the source
  // instead would stop early at a ")" inside a string default.
  const typeEnd = assertionNode.span.end.offset;

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
    if (node.type !== 'TypeAssertion') return [];
    const assertionNode = node;
    const operand = assertionNode.operand;

    // Bare assertions (:type) are valid - they check the pipe value.
    if (!operand) {
      return [];
    }

    // Only a bare literal has a type known from its syntax. A method call,
    // index, default, or existence check after it changes the asserted value.
    if (
      operand.methods.length > 0 ||
      operand.defaultValue !== null ||
      operand.existenceCheck
    ) {
      return [];
    }

    const literalType = getLiteralType(operand.primary);
    if (literalType === null) {
      return [];
    }

    const typeRef = assertionNode.typeRef;
    if (typeRef.kind !== 'static') {
      return [];
    }
    // A parameterized type such as list(string) checks element or field
    // types, which the literal's kind alone does not guarantee.
    if (typeRef.args !== undefined && typeRef.args.length > 0) {
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
