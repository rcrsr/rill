/**
 * Formatting Rules
 * Enforces style conventions from docs/16_conventions.md:465-662.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  BinaryExprNode,
  PipeChainNode,
  CaptureNode,
  ClosureNode,
  SourceSpan,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// SPACING_OPERATOR RULE
// ============================================================

/**
 * Enforces space on both sides of operators.
 * Operators like +, -, ->, :>, ==, etc. should have spaces on both sides.
 *
 * Detection:
 * - Extract operator text from source using source spans
 * - Check if space exists before/after operator
 *
 * References:
 * - docs/16_conventions.md:467-482
 */
export const SPACING_OPERATOR: ValidationRule = {
  code: 'SPACING_OPERATOR',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['BinaryExpr', 'PipeChain', 'Capture'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (node.type === 'BinaryExpr') {
      const binaryNode = node as BinaryExprNode;
      const operator = binaryNode.op;

      // Check spacing around operator in source
      const violation = checkOperatorSpacing(
        operator,
        binaryNode.span,
        context.source
      );

      if (violation) {
        diagnostics.push({
          location: binaryNode.span.start,
          severity: 'info',
          code: 'SPACING_OPERATOR',
          message: `Operator '${operator}' should have spaces on both sides`,
          context: extractContextLine(
            binaryNode.span.start.line,
            context.source
          ),
          fix: null, // Complex to fix without AST reconstruction
        });
      }
    }

    if (node.type === 'PipeChain') {
      const pipeNode = node as PipeChainNode;
      // Check -> operators between pipes
      const violation = checkPipeSpacing(pipeNode.span, context.source);

      if (violation) {
        diagnostics.push({
          location: pipeNode.span.start,
          severity: 'info',
          code: 'SPACING_OPERATOR',
          message: "Pipe operator '->' should have spaces on both sides",
          context: extractContextLine(pipeNode.span.start.line, context.source),
          fix: null,
        });
      }
    }

    if (node.type === 'Capture') {
      const captureNode = node as CaptureNode;
      // Check :> operator
      const violation = checkCaptureSpacing(captureNode.span, context.source);

      if (violation) {
        diagnostics.push({
          location: captureNode.span.start,
          severity: 'info',
          code: 'SPACING_OPERATOR',
          message: "Capture operator ':>' should have spaces on both sides",
          context: extractContextLine(
            captureNode.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },
};

/**
 * Check if operator has proper spacing in source.
 */
function checkOperatorSpacing(
  operator: string,
  span: SourceSpan,
  source: string
): boolean {
  const text = extractSpanText(span, source);

  // Look for operator without spaces
  const patterns = [
    new RegExp(`\\S${escapeRegex(operator)}`), // No space before
    new RegExp(`${escapeRegex(operator)}\\S`), // No space after
  ];

  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Check pipe operator spacing.
 */
function checkPipeSpacing(span: SourceSpan, source: string): boolean {
  const text = extractSpanText(span, source);

  // Check for -> without spaces
  return /\S->/.test(text) || /->[\S&&[^\s]]/.test(text);
}

/**
 * Check capture operator spacing.
 */
function checkCaptureSpacing(span: SourceSpan, source: string): boolean {
  const text = extractSpanText(span, source);

  // Check for :> without spaces
  return /\S:>/.test(text) || /:>\S/.test(text);
}

// ============================================================
// SPACING_BRACES RULE
// ============================================================

/**
 * Enforces space after { and before } in blocks.
 * Braces for blocks, closures, etc. should have internal spacing.
 *
 * Detection:
 * - Extract brace content from source
 * - Check if opening { has space after, closing } has space before
 *
 * References:
 * - docs/16_conventions.md:497-508
 */
export const SPACING_BRACES: ValidationRule = {
  code: 'SPACING_BRACES',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['Block', 'Closure'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const span = node.span;

    // Extract source text for the node
    const text = extractSpanText(span, context.source);

    // Check for opening brace without space after
    if (/\{[^\s]/.test(text) && !text.includes('{\n')) {
      diagnostics.push({
        location: span.start,
        severity: 'info',
        code: 'SPACING_BRACES',
        message: 'Space required after opening brace {',
        context: extractContextLine(span.start.line, context.source),
        fix: null,
      });
    }

    // Check for closing brace without space before
    if (/[^\s]\}/.test(text) && !text.includes('\n}')) {
      diagnostics.push({
        location: span.start,
        severity: 'info',
        code: 'SPACING_BRACES',
        message: 'Space required before closing brace }',
        context: extractContextLine(span.start.line, context.source),
        fix: null,
      });
    }

    return diagnostics;
  },
};

// ============================================================
// SPACING_BRACKETS RULE
// ============================================================

/**
 * Enforces no inner spaces for indexing brackets.
 * Array/dict indexing should use $list[0] not $list[ 0 ].
 *
 * Detection:
 * - PostfixExpr nodes with index access
 * - Check for spaces inside brackets
 *
 * References:
 * - docs/16_conventions.md:526-535
 */
export const SPACING_BRACKETS: ValidationRule = {
  code: 'SPACING_BRACKETS',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['PostfixExpr'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // [DEBT] Stubbed - IndexAccess not exposed in PostfixExpr.methods array
    // AST only exposes MethodCall/Invoke, not bracket indexing operations
    return [];
  },
};

// ============================================================
// SPACING_CLOSURE RULE
// ============================================================

/**
 * Enforces no space before pipe, space after in closures.
 * Closure parameters: |x| not | x |.
 *
 * Detection:
 * - Extract closure parameter section from source
 * - Check spacing around pipes
 *
 * References:
 * - docs/16_conventions.md:549-560
 */
export const SPACING_CLOSURE: ValidationRule = {
  code: 'SPACING_CLOSURE',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['Closure'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const closureNode = node as ClosureNode;
    const text = extractSpanText(closureNode.span, context.source);

    // Check for space before opening pipe
    if (/\s\|/.test(text.substring(0, text.indexOf('|') + 1))) {
      diagnostics.push({
        location: closureNode.span.start,
        severity: 'info',
        code: 'SPACING_CLOSURE',
        message: 'No space before opening pipe in closure parameters',
        context: extractContextLine(
          closureNode.span.start.line,
          context.source
        ),
        fix: null,
      });
    }

    // Check for missing space after params (only if params exist)
    if (closureNode.params.length > 0) {
      // Look for pattern |params|( or |params|{ without space
      const afterPipeIdx = text.lastIndexOf(
        '|',
        text.indexOf('{') || text.indexOf('(')
      );
      if (afterPipeIdx !== -1) {
        const afterPipe = text.substring(afterPipeIdx + 1, afterPipeIdx + 2);
        if (
          afterPipe &&
          /[^\s]/.test(afterPipe) &&
          afterPipe !== '{' &&
          afterPipe !== '('
        ) {
          // This is complex - skip for now as it requires better parsing
        }
      }
    }

    return diagnostics;
  },
};

// ============================================================
// INDENT_CONTINUATION RULE
// ============================================================

/**
 * Enforces 2-space indent for continued lines.
 * Pipe chains should indent continuation lines by 2 spaces.
 *
 * Detection:
 * - Multi-line pipe chains
 * - Check indentation of continuation lines
 *
 * References:
 * - docs/16_conventions.md:636-662
 */
export const INDENT_CONTINUATION: ValidationRule = {
  code: 'INDENT_CONTINUATION',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['PipeChain'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const pipeNode = node as PipeChainNode;

    // Only check multi-line chains
    if (pipeNode.span.start.line === pipeNode.span.end.line) {
      return [];
    }

    // Extract full text and check continuation indentation
    const text = extractSpanText(pipeNode.span, context.source);
    const lines = text.split('\n');

    if (lines.length > 1) {
      // Check each continuation line (skip first)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        const indent = line.match(/^(\s*)/)?.[1] || '';

        // Should have at least 2 spaces for continuation
        if (line.trim().startsWith('->') && indent.length < 2) {
          diagnostics.push({
            location: {
              line: pipeNode.span.start.line + i,
              column: 1,
              offset: 0,
            },
            severity: 'info',
            code: 'INDENT_CONTINUATION',
            message: 'Continuation lines should be indented by 2 spaces',
            context: line.trim(),
            fix: null,
          });
        }
      }
    }

    return diagnostics;
  },
};

// ============================================================
// IMPLICIT_DOLLAR_METHOD RULE
// ============================================================

/**
 * Prefer .foo over $.foo() for method calls.
 * When piping, prefer implicit $ shorthand for methods.
 *
 * Detection:
 * - MethodCall where receiver is bare $ (isPipeVar)
 * - In pipe context
 *
 * References:
 * - docs/16_conventions.md:587-598
 */
export const IMPLICIT_DOLLAR_METHOD: ValidationRule = {
  code: 'IMPLICIT_DOLLAR_METHOD',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['MethodCall'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // [DEBT] Stubbed - MethodCall node lacks receiver information
    // Need parent context or AST restructure to detect $.method() pattern
    return [];
  },
};

// ============================================================
// IMPLICIT_DOLLAR_FUNCTION RULE
// ============================================================

/**
 * Prefer foo over foo($) for global function calls.
 * When single argument is bare $, prefer implicit form.
 *
 * Detection:
 * - HostCall with single argument that is bare $
 *
 * References:
 * - docs/16_conventions.md:599-607
 */
export const IMPLICIT_DOLLAR_FUNCTION: ValidationRule = {
  code: 'IMPLICIT_DOLLAR_FUNCTION',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['HostCall'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // [DEBT] Stubbed - HostCall args are ExpressionNode union requiring deep traversal
    // Need to unwrap PipeChain -> PostfixExpr -> Variable to detect bare $ argument
    return [];
  },
};

// ============================================================
// IMPLICIT_DOLLAR_CLOSURE RULE
// ============================================================

/**
 * Prefer $fn over $fn($) for closure invocation.
 * When single argument is bare $, prefer implicit form.
 *
 * Detection:
 * - ClosureCall with single argument that is bare $
 *
 * References:
 * - docs/16_conventions.md:608-615
 */
export const IMPLICIT_DOLLAR_CLOSURE: ValidationRule = {
  code: 'IMPLICIT_DOLLAR_CLOSURE',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['ClosureCall'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // [DEBT] Stubbed - ClosureCall args require same deep ExpressionNode unwrapping
    // Complex traversal to detect single bare $ argument pattern
    return [];
  },
};

// ============================================================
// THROWAWAY_CAPTURE RULE
// ============================================================

/**
 * Warns on capture-only-to-continue patterns.
 * Capturing a value just to use it immediately in the next line is unnecessary.
 *
 * Detection:
 * - Capture node followed by immediate use of that variable only
 * - Variable not referenced later in the script
 *
 * References:
 * - docs/16_conventions.md:617-634
 */
export const THROWAWAY_CAPTURE: ValidationRule = {
  code: 'THROWAWAY_CAPTURE',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['Capture'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // [DEBT] Stubbed - Requires full script analysis across statement boundaries
    // Must track: 1) All captures 2) All variable references 3) Single-use detection
    return [];
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Extract text from source using span coordinates.
 */
function extractSpanText(span: SourceSpan, source: string): string {
  const lines = source.split('\n');

  if (span.start.line === span.end.line) {
    // Single line
    const line = lines[span.start.line - 1];
    if (!line) return '';
    return line.substring(span.start.column - 1, span.end.column - 1);
  }

  // Multi-line
  const result: string[] = [];

  for (let i = span.start.line - 1; i < span.end.line; i++) {
    const line = lines[i];
    if (!line) continue;

    if (i === span.start.line - 1) {
      // First line: from start column to end
      result.push(line.substring(span.start.column - 1));
    } else if (i === span.end.line - 1) {
      // Last line: from start to end column
      result.push(line.substring(0, span.end.column - 1));
    } else {
      // Middle lines: full line
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Escape special regex characters.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
