/**
 * Formatting Rules
 * Enforces style conventions from docs/16_conventions.md:465-662.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
  FixContext,
  Fix,
} from '../types.js';
import type {
  ASTNode,
  BinaryExprNode,
  PipeChainNode,
  CaptureNode,
  ClosureNode,
  SourceSpan,
  PostfixExprNode,
  VariableNode,
  BracketAccess,
  MethodCallNode,
  HostCallNode,
  ClosureCallNode,
} from '@rcrsr/rill';
import { extractContextLine, isBareReference } from './helpers.js';

// ============================================================
// SPACING_OPERATOR RULE
// ============================================================

/**
 * Enforces space on both sides of operators.
 * Operators like +, -, ->, =>, ==, etc. should have spaces on both sides.
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
      // Check => operator
      const violation = checkCaptureSpacing(captureNode.span, context.source);

      if (violation) {
        diagnostics.push({
          location: captureNode.span.start,
          severity: 'info',
          code: 'SPACING_OPERATOR',
          message: "Capture operator '=>' should have spaces on both sides",
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

  // Check for => without spaces
  return /\S=>/.test(text) || /=>\S/.test(text);
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
    const lines = context.source.split('\n');

    const openLine = lines[span.start.line - 1] ?? '';
    const closeLine = lines[span.end.line - 1] ?? '';

    // Check for opening brace without space after
    // Only examine the opening line (from the { onward)
    // Use ^ anchor to only check the block's opening brace, not string interpolation
    const openFrom = openLine.substring(span.start.column - 1);
    if (/^\{[^\s\n]/.test(openFrom)) {
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
    // span.end.column is 1-indexed and points AFTER the }, so:
    // - } is at 0-index: span.end.column - 2
    // - Character before } is at 0-index: span.end.column - 3
    const charBeforeClose = closeLine[span.end.column - 3];
    const isCloseOnOwnLine = /^\s*$/.test(
      closeLine.substring(0, span.end.column - 2)
    );
    if (charBeforeClose && !/\s/.test(charBeforeClose) && !isCloseOnOwnLine) {
      diagnostics.push({
        location: span.end,
        severity: 'info',
        code: 'SPACING_BRACES',
        message: 'Space required before closing brace }',
        context: extractContextLine(span.end.line, context.source),
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

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const postfixNode = node as PostfixExprNode;

    // Only process if primary is a Variable (contains accessChain)
    if (postfixNode.primary.type !== 'Variable') {
      return diagnostics;
    }

    const variableNode = postfixNode.primary as VariableNode;

    // Check each BracketAccess in the accessChain
    for (const access of variableNode.accessChain) {
      // Skip non-bracket accesses
      if (!('accessKind' in access) || access.accessKind !== 'bracket') {
        continue;
      }

      const bracketAccess = access as BracketAccess;

      // Skip if span is missing or invalid (EC-3, EC-4)
      if (!isValidSpan(bracketAccess.span)) {
        continue;
      }

      // Extract text from bracket span
      const text = extractSpanText(bracketAccess.span, context.source);

      // Check for space after opening bracket: /\[\s/
      // Check for space before closing bracket: /\s\]/
      const hasSpaceAfterOpen = /\[\s/.test(text);
      const hasSpaceBeforeClose = /\s\]/.test(text);

      if (hasSpaceAfterOpen || hasSpaceBeforeClose) {
        // Extract content between brackets for error message
        const content = text.substring(1, text.length - 1).trim();

        diagnostics.push({
          location: bracketAccess.span.start,
          severity: 'info',
          code: 'SPACING_BRACKETS',
          message: `No spaces inside brackets: remove spaces around ${content}`,
          context: extractContextLine(
            bracketAccess.span.start.line,
            context.source
          ),
          fix: null,
        });
      }
    }

    return diagnostics;
  },

  fix(node: ASTNode, context: FixContext): Fix | null {
    const postfixNode = node as PostfixExprNode;

    // Only process if primary is a Variable (contains accessChain)
    if (postfixNode.primary.type !== 'Variable') {
      return null;
    }

    const variableNode = postfixNode.primary as VariableNode;

    // Find the first BracketAccess with spacing violation
    for (const access of variableNode.accessChain) {
      // Skip non-bracket accesses
      if (!('accessKind' in access) || access.accessKind !== 'bracket') {
        continue;
      }

      const bracketAccess = access as BracketAccess;

      // Skip if span is missing or invalid
      if (!isValidSpan(bracketAccess.span)) {
        continue;
      }

      // Extract text from bracket span
      const text = extractSpanText(bracketAccess.span, context.source);

      // Check for spacing violations
      const hasSpaceAfterOpen = /\[\s/.test(text);
      const hasSpaceBeforeClose = /\s\]/.test(text);

      if (hasSpaceAfterOpen || hasSpaceBeforeClose) {
        // Build replacement text by removing inner spaces
        // Replace [ followed by whitespace with [
        // Replace whitespace followed by ] with ]
        const replacement = text.replace(/\[\s+/g, '[').replace(/\s+\]/g, ']');

        return {
          description: 'Remove spaces inside brackets',
          applicable: true,
          range: bracketAccess.span,
          replacement,
        };
      }
    }

    // No fixable violation found
    return null;
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

    // EC-5: Single-line chain - Return []
    if (pipeNode.span.start.line === pipeNode.span.end.line) {
      return [];
    }

    // Extract full text and check continuation indentation
    const text = extractSpanText(pipeNode.span, context.source);
    const lines = text.split('\n');

    // KNOWN LIMITATION: This rule validates multi-line pipe chains where the pipe
    // operator (`->`) and its target appear on the same line. The parser requires
    // pipe targets to be on the same line as the `->` operator, so patterns like
    // `value ->\n  .method()` are invalid. See tests/language/statement-boundaries.test.ts:211-215
    // for authoritative language behavior.
    if (lines.length > 1) {
      // Check each continuation line (skip first line which establishes baseline)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];

        // EC-6: Empty continuation line - Skip line
        if (!line) continue;

        const indent = line.match(/^(\s*)/)?.[1] || '';

        // Continuation = line starting with -> (after whitespace)
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
 * Detect explicit $.method() patterns replaceable with .method.
 *
 * Flags method calls where the receiver is a bare $ (pipe variable).
 * The implicit form .method is preferred when $ represents the current
 * piped value (e.g., in blocks, closures, conditionals).
 *
 * Detection:
 * - MethodCallNode with non-null receiverSpan
 * - Receiver is bare $ (zero-width or single-char span)
 * - Method call is first in chain (receiverSpan.end.offset <= 1)
 *
 * Note: Cannot use isBareReference() helper here because MethodCallNode.receiverSpan
 * is a SourceSpan (position range), not an ExpressionNode. The helper requires
 * an AST node to traverse. Instead, we detect bare $ by checking:
 * 1. receiverSpan is zero-width (start == end) or single-char
 * 2. Character at offset is '$'
 * 3. Next character is '.' (not a variable name continuation)
 *
 * Examples:
 * - $.upper() -> .upper
 * - $.len -> .len
 * - $.trim().upper() -> First method flagged, second is chained (not bare $)
 *
 * Not flagged:
 * - .upper (receiverSpan is null)
 * - $var.method() (receiverSpan is not bare $)
 * - $.trim().upper() second method (receiverSpan covers $.trim())
 *
 * References:
 * - docs/16_conventions.md:587-598
 */
export const IMPLICIT_DOLLAR_METHOD: ValidationRule = {
  code: 'IMPLICIT_DOLLAR_METHOD',
  category: 'formatting',
  severity: 'info',
  nodeTypes: ['MethodCall'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const methodNode = node as MethodCallNode;

    // EC-7: No receiverSpan means implicit receiver (already correct form)
    if (methodNode.receiverSpan === null) {
      return [];
    }

    // Detect bare $ receiver by analyzing the receiverSpan
    // For bare $, the span is either:
    // 1. Zero-width (start.offset == end.offset) at the $ character
    // 2. Single-char span covering just $
    const receiverSpan = methodNode.receiverSpan;
    const spanLength = receiverSpan.end.offset - receiverSpan.start.offset;

    // EC-8: Receiver is not bare $ if span is longer than 1 character
    // This filters out chains like $.trim().upper() where second method
    // has receiverSpan covering "$.trim()."
    if (spanLength > 1) {
      return [];
    }

    // Check that the character at the span is '$' and not part of a variable name
    const offset = receiverSpan.start.offset;
    const charAtOffset = context.source[offset];
    const nextChar = context.source[offset + 1];

    // Must be '$' followed by '.' (method call)
    // This distinguishes $.method() from $var.method()
    if (charAtOffset !== '$' || nextChar !== '.') {
      return [];
    }

    // Generate diagnostic for bare $ receiver
    const suggestedCode =
      methodNode.args.length === 0
        ? `.${methodNode.name}`
        : `.${methodNode.name}()`;

    return [
      {
        code: 'IMPLICIT_DOLLAR_METHOD',
        message: `Prefer implicit '${suggestedCode}' over explicit '$.${methodNode.name}()'`,
        severity: 'info',
        location: {
          line: methodNode.span.start.line,
          column: methodNode.span.start.column,
          offset: methodNode.span.start.offset,
        },
        context: extractContextLine(methodNode.span.start.line, context.source),
        fix: null,
      },
    ];
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

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const hostCallNode = node as HostCallNode;

    // EC-9: Zero args - Return []
    if (hostCallNode.args.length === 0) {
      return [];
    }

    // EC-10: Multiple args - Return []
    if (hostCallNode.args.length > 1) {
      return [];
    }

    // EC-11: Single arg not bare $ - Return []
    const singleArg = hostCallNode.args[0];
    if (!isBareReference(singleArg)) {
      return [];
    }

    // Generate diagnostic for bare $ argument
    return [
      {
        code: 'IMPLICIT_DOLLAR_FUNCTION',
        message: `Prefer pipe syntax '-> ${hostCallNode.name}' over explicit '${hostCallNode.name}($)'`,
        severity: 'info',
        location: {
          line: hostCallNode.span.start.line,
          column: hostCallNode.span.start.column,
          offset: hostCallNode.span.start.offset,
        },
        context: extractContextLine(
          hostCallNode.span.start.line,
          context.source
        ),
        fix: null,
      },
    ];
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

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const closureCallNode = node as ClosureCallNode;

    // EC-12: Zero args - Return []
    if (closureCallNode.args.length === 0) {
      return [];
    }

    // EC-13: Multiple args - Return []
    if (closureCallNode.args.length > 1) {
      return [];
    }

    // EC-14: Single arg not bare $ - Return []
    const singleArg = closureCallNode.args[0];
    if (!isBareReference(singleArg)) {
      return [];
    }

    // Build closure name with access chain for display
    const closureName =
      closureCallNode.accessChain.length > 0
        ? `$${closureCallNode.name}.${closureCallNode.accessChain.join('.')}`
        : `$${closureCallNode.name}`;

    // Generate diagnostic for bare $ argument
    return [
      {
        code: 'IMPLICIT_DOLLAR_CLOSURE',
        message: `Prefer pipe syntax '-> ${closureName}' over explicit '${closureName}($)'`,
        severity: 'info',
        location: {
          line: closureCallNode.span.start.line,
          column: closureCallNode.span.start.column,
          offset: closureCallNode.span.start.offset,
        },
        context: extractContextLine(
          closureCallNode.span.start.line,
          context.source
        ),
        fix: null,
      },
    ];
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
 * Validate that a SourceSpan has valid coordinates.
 * Returns false if span, start, or end are missing,
 * or if line/column values are less than 1.
 *
 * Exported for testing purposes to enable direct unit testing
 * of edge cases (null spans, invalid coordinates).
 */
export function isValidSpan(span: SourceSpan | null | undefined): boolean {
  if (!span) {
    return false;
  }
  if (!span.start || !span.end) {
    return false;
  }
  if (
    span.start.line < 1 ||
    span.start.column < 1 ||
    span.end.line < 1 ||
    span.end.column < 1
  ) {
    return false;
  }
  return true;
}

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
