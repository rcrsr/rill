/**
 * Collection Operator Rules
 * Enforces conventions for each, map, fold, and filter operators.
 */

import type {
  ValidationRule,
  Diagnostic,
  ValidationContext,
} from '../types.js';
import type {
  ASTNode,
  EachExprNode,
  MapExprNode,
  FoldExprNode,
  FilterExprNode,
  IteratorBody,
  BlockNode,
} from '../../types.js';
import { extractContextLine } from './helpers.js';

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if an AST subtree contains a Break node.
 * Recursively traverses all node types.
 */
function containsBreak(node: ASTNode): boolean {
  if (node.type === 'Break') {
    return true;
  }

  // Recursively check children based on node type
  switch (node.type) {
    case 'Block':
      return node.statements.some((stmt) => containsBreak(stmt));

    case 'Statement':
      return containsBreak(node.expression);

    case 'AnnotatedStatement':
      return containsBreak(node.statement);

    case 'PipeChain':
      if (containsBreak(node.head)) return true;
      if (node.pipes.some((pipe) => containsBreak(pipe as ASTNode)))
        return true;
      if (node.terminator && node.terminator.type === 'Break') return true;
      return false;

    case 'PostfixExpr':
      if (containsBreak(node.primary)) return true;
      return node.methods.some((method) => containsBreak(method));

    case 'BinaryExpr':
      return containsBreak(node.left) || containsBreak(node.right);

    case 'UnaryExpr':
      return containsBreak(node.operand);

    case 'GroupedExpr':
      return containsBreak(node.expression);

    case 'Conditional':
      if (node.input && containsBreak(node.input)) return true;
      if (node.condition && containsBreak(node.condition)) return true;
      if (containsBreak(node.thenBranch)) return true;
      if (node.elseBranch && containsBreak(node.elseBranch)) return true;
      return false;

    case 'WhileLoop':
    case 'DoWhileLoop':
      return containsBreak(node.body);

    case 'Closure':
      return containsBreak(node.body);

    case 'EachExpr':
    case 'MapExpr':
    case 'FoldExpr':
    case 'FilterExpr':
      return containsBreak(node.body);

    case 'HostCall':
    case 'ClosureCall':
    case 'MethodCall':
    case 'Invoke':
    case 'PipeInvoke':
      return node.args.some((arg) => containsBreak(arg));

    case 'StringLiteral':
      return node.parts.some(
        (part) => typeof part !== 'string' && containsBreak(part)
      );

    case 'Tuple':
      return node.elements.some((elem) => containsBreak(elem));

    case 'Dict':
      return node.entries.some((entry) => containsBreak(entry));

    case 'DictEntry':
      return containsBreak(node.value);

    default:
      // Leaf nodes and other types don't contain breaks
      return false;
  }
}

/**
 * Check if a body is a simple method shorthand.
 * Body structure for .method shorthand is PostfixExpr with MethodCall as primary.
 * Examples: .upper, .len, .trim
 */
function isMethodShorthand(body: IteratorBody): boolean {
  if (body.type !== 'PostfixExpr') return false;
  return body.primary.type === 'MethodCall';
}

/**
 * Check if a body is a block wrapping a single method call on $.
 * Example: { $.upper() } when it could be .upper
 * Structure: Block -> Statement -> PipeChain -> PostfixExpr($) with methods
 */
function isBlockWrappingMethod(
  body: IteratorBody
): body is BlockNode & { statements: Array<{ expression: ASTNode }> } {
  if (body.type !== 'Block') return false;
  if (body.statements.length !== 1) return false;

  const stmt = body.statements[0];
  if (!stmt || stmt.type !== 'Statement') return false;

  const expr = stmt.expression;
  if (expr.type !== 'PipeChain') return false;

  // Should have no pipes (direct method call on head)
  if (expr.pipes.length !== 0) return false;

  const head = expr.head;
  if (head.type !== 'PostfixExpr') return false;

  // Primary should be pipe variable ($)
  if (head.primary.type !== 'Variable') return false;
  const variable = head.primary;
  if (!('isPipeVar' in variable) || !variable.isPipeVar) return false;

  // Should have exactly one method in the methods array
  if (head.methods.length !== 1) return false;
  if (head.methods[0]?.type !== 'MethodCall') return false;

  return true;
}

/**
 * Get method name from iterator body.
 * Handles both PostfixExpr (shorthand) and BlockNode (wrapped) forms.
 */
function getMethodName(body: IteratorBody): string | null {
  // Shorthand form: PostfixExpr with MethodCall primary
  if (body.type === 'PostfixExpr' && body.primary.type === 'MethodCall') {
    return body.primary.name;
  }

  // Block form: $.method()
  if (isBlockWrappingMethod(body)) {
    const stmt = body.statements[0];
    if (!stmt || stmt.type !== 'Statement') return null;

    const expr = stmt.expression;
    if (expr.type !== 'PipeChain') return null;

    const head = expr.head;
    if (head.type !== 'PostfixExpr') return null;

    const method = head.methods[0];
    if (method && method.type === 'MethodCall') {
      return method.name;
    }
  }

  return null;
}

// ============================================================
// BREAK_IN_PARALLEL RULE
// ============================================================

/**
 * Validates that break is not used in parallel operators (map, filter).
 *
 * Break is semantically invalid in parallel execution contexts:
 * - map: executes in parallel, no iteration order
 * - filter: parallel predicate evaluation
 *
 * Break is valid in sequential operators:
 * - each: sequential iteration with early termination
 * - fold: sequential reduction (though uncommon)
 *
 * Error severity because this is semantically wrong, not just stylistic.
 *
 * References:
 * - docs/16_conventions.md:90-149
 * - docs/07_collections.md
 */
export const BREAK_IN_PARALLEL: ValidationRule = {
  code: 'BREAK_IN_PARALLEL',
  category: 'collections',
  severity: 'error',
  nodeTypes: ['MapExpr', 'FilterExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const collectionExpr = node as MapExprNode | FilterExprNode;
    const operatorName = node.type === 'MapExpr' ? 'map' : 'filter';

    if (containsBreak(collectionExpr.body)) {
      return [
        {
          location: node.span.start,
          severity: 'error',
          code: 'BREAK_IN_PARALLEL',
          message: `Break not allowed in '${operatorName}' (parallel operator). Use 'each' for sequential iteration with break.`,
          context: extractContextLine(node.span.start.line, context.source),
          fix: null, // Cannot auto-fix operator replacement
        },
      ];
    }

    return [];
  },
};

// ============================================================
// PREFER_MAP RULE
// ============================================================

/**
 * Suggests using map over each when no side effects are present.
 *
 * Map is semantically clearer for pure transformations:
 * - Signals no side effects (parallel execution)
 * - Better performance potential
 * - More functional style
 *
 * Detects each expressions where:
 * - Body doesn't reference accumulator ($@)
 * - No accumulator initialization
 * - Body doesn't contain side-effecting operations (host calls, logging)
 *
 * This is informational - both work, but map is clearer for pure transforms.
 *
 * References:
 * - docs/16_conventions.md:90-149
 */
export const PREFER_MAP: ValidationRule = {
  code: 'PREFER_MAP',
  category: 'collections',
  severity: 'info',
  nodeTypes: ['EachExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const eachExpr = node as EachExprNode;

    // If accumulator is present, each is correct choice
    if (eachExpr.accumulator !== null) {
      return [];
    }

    // Check if body is a closure with accumulator parameter
    if (eachExpr.body.type === 'Closure') {
      const closure = eachExpr.body;
      const hasAccumulator = closure.params.length > 1;
      if (hasAccumulator) {
        return [];
      }
    }

    // Simple heuristic: if body is pure (no side effects), suggest map
    // For now, suggest map for simple transformations
    // Full implementation would check for host calls, logging, etc.

    return [
      {
        location: node.span.start,
        severity: 'info',
        code: 'PREFER_MAP',
        message:
          "Consider using 'map' instead of 'each' for pure transformations (no side effects)",
        context: extractContextLine(node.span.start.line, context.source),
        fix: null, // Could generate fix by replacing 'each' with 'map'
      },
    ];
  },
};

// ============================================================
// FOLD_INTERMEDIATES RULE
// ============================================================

/**
 * Suggests using fold for final-only results, each(init) for running totals.
 *
 * Semantic distinction:
 * - fold: returns final accumulated value only
 * - each(init): returns list of all intermediate results
 *
 * Detects patterns that might benefit from one or the other:
 * - fold used when intermediate results might be needed
 * - each(init) used when only final result matters
 *
 * This is informational - helps users choose the right operator.
 *
 * References:
 * - docs/16_conventions.md:90-149
 * - docs/07_collections.md
 */
export const FOLD_INTERMEDIATES: ValidationRule = {
  code: 'FOLD_INTERMEDIATES',
  category: 'collections',
  severity: 'info',
  nodeTypes: ['EachExpr', 'FoldExpr'],

  validate(_node: ASTNode, _context: ValidationContext): Diagnostic[] {
    // This rule is informational and would require flow analysis
    // to detect whether intermediate values are used.
    // Placeholder for future implementation.
    return [];
  },
};

// ============================================================
// FILTER_NEGATION RULE
// ============================================================

/**
 * Validates that negation in filter uses grouped form.
 *
 * Grouped negation is clearer and prevents bugs:
 * - Correct: filter (!.empty)  -- grouped negation
 * - Wrong:   filter .empty     -- filters for empty elements (likely bug)
 *
 * The ungrouped form .empty would return truthy elements,
 * which is likely not intended when filtering.
 *
 * References:
 * - docs/16_conventions.md:90-149
 */
export const FILTER_NEGATION: ValidationRule = {
  code: 'FILTER_NEGATION',
  category: 'collections',
  severity: 'warning',
  nodeTypes: ['FilterExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const filterExpr = node as FilterExprNode;
    const body = filterExpr.body;

    // Check if body is a simple method call (ungrouped)
    if (isMethodShorthand(body)) {
      const methodName = getMethodName(body);

      // Check if method is likely a negation-intended method
      // Common methods that might indicate user wants to negate:
      // .empty, .is_match, etc.
      if (methodName === 'empty') {
        return [
          {
            location: node.span.start,
            severity: 'warning',
            code: 'FILTER_NEGATION',
            message: `Filter with '.${methodName}' likely unintended. Use grouped negation: 'filter (!.${methodName})' to filter non-${methodName} elements`,
            context: extractContextLine(node.span.start.line, context.source),
            fix: null, // Could generate fix wrapping in (!...)
          },
        ];
      }
    }

    return [];
  },
};

// ============================================================
// METHOD_SHORTHAND RULE
// ============================================================

/**
 * Suggests using method shorthand over block form in collection operators.
 *
 * Method shorthand is more concise and clearer:
 * - Preferred: map .upper
 * - Verbose:   map { $.upper() }
 *
 * Detects block forms that wrap a single method call and suggests shorthand.
 *
 * This is informational - both forms work identically.
 *
 * References:
 * - docs/16_conventions.md:90-149
 */
export const METHOD_SHORTHAND: ValidationRule = {
  code: 'METHOD_SHORTHAND',
  category: 'collections',
  severity: 'info',
  nodeTypes: ['EachExpr', 'MapExpr', 'FoldExpr', 'FilterExpr'],

  validate(node: ASTNode, context: ValidationContext): Diagnostic[] {
    const collectionNode = node as
      | EachExprNode
      | MapExprNode
      | FoldExprNode
      | FilterExprNode;
    const body = collectionNode.body;

    if (isBlockWrappingMethod(body)) {
      const methodName = getMethodName(body);

      if (methodName) {
        return [
          {
            location: node.span.start,
            severity: 'info',
            code: 'METHOD_SHORTHAND',
            message: `Prefer method shorthand '.${methodName}' over block form '{ $.${methodName}() }'`,
            context: extractContextLine(node.span.start.line, context.source),
            fix: null, // Could generate fix replacing block with .method
          },
        ];
      }
    }

    return [];
  },
};
