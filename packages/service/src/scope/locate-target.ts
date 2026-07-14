/**
 * Shared node-classification logic for `findDefinition` and `getHover`.
 * Locates the node at a source offset via core `nodeAtPosition` and
 * classifies it into the handful of shapes both providers need to
 * distinguish: a variable's own name token, a field/bracket access-chain
 * segment on a variable, a closure invocation, a built-in function/method,
 * or a reserved keyword.
 */

import { nodeAtPosition, walkAst } from '@rcrsr/rill';
import type {
  ASTNode,
  BracketAccess,
  ParseResult,
  PropertyAccess,
  SourceSpan,
  VariableNode,
} from '@rcrsr/rill';

/** Node types that correspond 1:1 with a reserved keyword token. */
const KEYWORD_NODE_WORDS: Readonly<Record<string, string>> = {
  Break: 'break',
  Return: 'return',
  Yield: 'yield',
  Pass: 'pass',
  PassBlock: 'pass',
  Assert: 'assert',
  Error: 'error',
  WhileLoop: 'while',
  DoWhileLoop: 'do',
  GuardBlock: 'guard',
  RetryBlock: 'retry',
};

export type LocatedTarget =
  | {
      readonly kind: 'variableName';
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'accessSegment';
      readonly span: SourceSpan;
      readonly description: string;
    }
  | {
      readonly kind: 'closureCall';
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'hostCall';
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'methodCall';
      readonly name: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'keyword';
      readonly word: string;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: 'boolLiteral';
      readonly word: string;
      readonly span: SourceSpan;
    }
  | { readonly kind: 'none' };

/**
 * Locates and classifies the node at `offset`. Never throws: an offset that
 * resolves to nothing, or to a node shape this module does not recognize,
 * yields `{ kind: 'none' }`.
 */
export function locateTarget(
  parsed: ParseResult,
  offset: number
): LocatedTarget {
  // `BracketAccess.expression` (the `0` in `[0]`) is a full nested
  // `ExpressionNode` with its own real span, reachable as an ordinary
  // ASTNode child. `nodeAtPosition` therefore descends past the owning
  // `Variable`/`BracketAccess` and returns that inner expression node
  // directly (e.g. a `NumberLiteral`) whenever the offset lands inside it --
  // unlike `.field` dot-access, which has no ASTNode children of its own and
  // so naturally falls back to the owning `VariableNode`. Checked first,
  // ahead of `nodeAtPosition`, so a `[0]` segment resolves to its own
  // bracket span the same way a `.field` segment already does.
  const bracketSegment = findBracketAccessSegmentAt(parsed.ast, offset);
  if (bracketSegment !== null) {
    return {
      kind: 'accessSegment',
      span: bracketSegment.span,
      description: bracketSegment.description,
    };
  }

  const node = nodeAtPosition(parsed.ast, offset);
  if (node === null) return { kind: 'none' };

  // `VariableNode.span` is a zero-width point at the leading `$` (see
  // `parser-variables.ts`'s `makeVariableWithAccess`), so `ownsOffset` never
  // matches a bare variable reference on its own -- `nodeAtPosition` returns
  // the enclosing `PostfixExprNode` instead whenever the offset lands on the
  // base `$name` token rather than on one of the variable's access-chain
  // segments (which do carry real spans). Both shapes are handled here so a
  // bare reference (`$outer`) and a chained one (`$person.name`, hovering
  // the base) resolve the same way.
  if (node.type === 'Variable') {
    return classifyVariable(node, offset, node.span);
  }
  if (node.type === 'PostfixExpr' && node.primary.type === 'Variable') {
    return classifyVariable(node.primary, offset, node.span);
  }

  if (node.type === 'ClosureCall') {
    return { kind: 'closureCall', name: node.name, span: node.span };
  }

  if (node.type === 'HostCall' || node.type === 'HostRef') {
    return { kind: 'hostCall', name: node.name, span: node.span };
  }

  if (node.type === 'MethodCall') {
    return { kind: 'methodCall', name: node.name, span: node.span };
  }

  if (node.type === 'BoolLiteral') {
    return { kind: 'boolLiteral', word: String(node.value), span: node.span };
  }

  const keywordWord = KEYWORD_NODE_WORDS[node.type];
  if (keywordWord !== undefined) {
    return { kind: 'keyword', word: keywordWord, span: node.span };
  }

  return { kind: 'none' };
}

/**
 * Classifies a `VariableNode` reached either directly (offset on an
 * access-chain segment) or via its enclosing `PostfixExprNode` (offset on
 * the base `$name` token). `fallbackSpan` is the enclosing node's span, used
 * for the base-name case since `VariableNode.span` itself is degenerate.
 */
function classifyVariable(
  variable: VariableNode,
  offset: number,
  fallbackSpan: SourceSpan
): LocatedTarget {
  const segment =
    findAccessSegmentAt(variable.accessChain, offset) ??
    (variable.existenceCheck !== null
      ? findAccessSegmentAt([variable.existenceCheck.finalAccess], offset)
      : null);
  if (segment !== null) {
    return {
      kind: 'accessSegment',
      span: segment.span,
      description: segment.description,
    };
  }
  if (variable.name === null) return { kind: 'none' };
  return {
    kind: 'variableName',
    name: variable.name,
    span: nameOnlySpan(fallbackSpan, variable.name),
  };
}

/**
 * Derives a name-only span covering just `$` + the variable name, anchored
 * at `fallbackSpan.start` (the `$` offset shared by both `VariableNode.span`
 * and the enclosing `PostfixExprNode.span`). `fallbackSpan` itself may cover
 * a whole access chain (e.g. `$x.upper`), so this trims it down to the bare
 * `$name` token for hover/go-to-def targeting.
 */
function nameOnlySpan(fallbackSpan: SourceSpan, name: string): SourceSpan {
  const width = 1 + name.length;
  const { start } = fallbackSpan;
  return {
    start,
    end: {
      line: start.line,
      column: start.column + width,
      offset: start.offset + width,
    },
  };
}

interface AccessSegmentMatch {
  readonly span: SourceSpan;
  readonly description: string;
}

/**
 * Finds a `BracketAccess` segment (on any variable's access chain, anywhere
 * in the AST) whose own span contains `offset`. Unlike `.field` dot-access
 * (which `nodeAtPosition` already resolves back to the owning `VariableNode`
 * since it has no ASTNode children of its own), a bracket segment's inner
 * expression is a real, independently-reachable child -- so this is checked
 * directly against the AST rather than relying on `nodeAtPosition`'s return.
 */
function findBracketAccessSegmentAt(
  root: ASTNode,
  offset: number
): AccessSegmentMatch | null {
  let found: AccessSegmentMatch | null = null;
  walkAst(root, (node) => {
    if (found !== null || node.type !== 'Variable') return;
    for (const access of node.accessChain) {
      if (isBracketAccess(access) && spanContainsOffset(access.span, offset)) {
        found = { span: access.span, description: accessDescription(access) };
        return;
      }
    }
  });
  return found;
}

function findAccessSegmentAt(
  accesses: readonly PropertyAccess[],
  offset: number
): AccessSegmentMatch | null {
  for (const access of accesses) {
    const span = accessSpan(access);
    if (span !== undefined && spanContainsOffset(span, offset)) {
      return { span, description: accessDescription(access) };
    }
  }
  return null;
}

/**
 * Returns the access segment's own span, or `undefined` for segment kinds
 * that carry no span of their own (`block`, `alternatives`, `annotation`) --
 * these are resolved via their ASTNode children instead, per core's
 * `ownsOffset` documentation.
 */
function accessSpan(access: PropertyAccess): SourceSpan | undefined {
  if (isBracketAccess(access)) return access.span;
  if (
    access.kind === 'literal' ||
    access.kind === 'variable' ||
    access.kind === 'computed'
  ) {
    return access.span;
  }
  return undefined;
}

function accessDescription(access: PropertyAccess): string {
  if (isBracketAccess(access)) return 'index access';
  switch (access.kind) {
    case 'literal':
      return `field \`${access.field}\``;
    case 'variable':
      return `field (dynamic key \`$${access.variableName ?? ''}\`)`;
    case 'computed':
      return 'field (computed key)';
    case 'block':
      return 'field (block key)';
    case 'alternatives':
      return 'field (alternatives)';
    case 'annotation':
      return `annotation \`^${access.key}\``;
  }
}

function isBracketAccess(access: PropertyAccess): access is BracketAccess {
  return 'accessKind' in access;
}

function spanContainsOffset(span: SourceSpan, offset: number): boolean {
  return span.start.offset <= offset && offset < span.end.offset;
}
