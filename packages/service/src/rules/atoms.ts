/**
 * Atom rules. Atoms are identified by name, so these hints catch the
 * mistakes a name-only identity makes easy: a wrong-case builtin, a
 * comparison of `.!code` with a name that is never an error code, and an
 * atom-shaped statement that was meant to be a comment.
 */

import { BUILTIN_ATOMS, ERROR_CODES } from '@rcrsr/rill';
import type { ASTNode, AtomLiteralNode, StatementNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { getInnerStatement } from './capture-chain.js';
import { comparedOperands, extractContextLine } from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

/** Builtin atoms keyed by lower-cased name, for case-insensitive lookup. */
const BUILTIN_BY_LOWER: ReadonlyMap<string, string> = new Map(
  BUILTIN_ATOMS.map((name) => [name.toLowerCase(), name])
);
const BUILTIN_ATOM_SET: ReadonlySet<string> = new Set(BUILTIN_ATOMS);
const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

/** The builtin an atom name differs from only by case, if any. */
function caseMismatchBuiltin(name: string): string | undefined {
  if (BUILTIN_ATOM_SET.has(name)) return undefined;
  return BUILTIN_BY_LOWER.get(name.toLowerCase());
}

/** The atom of a bare `#NAME` operand (no methods), if the node is one. */
function bareAtom(node: ASTNode): AtomLiteralNode | undefined {
  const inner = unwrapBareLiteral(node);
  return inner.type === 'AtomLiteral' ? inner : undefined;
}

/** True when the node is a bare `.!code` probe operand (no trailing methods). */
function isCodeProbe(node: ASTNode): boolean {
  const inner = unwrapBareLiteral(node);
  return inner.type === 'StatusProbe' && inner.field === 'code';
}

export const atomCaseMismatch: Rule = {
  code: 'ATOM_CASE_MISMATCH',
  nodeTypes: ['AtomLiteral'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'AtomLiteral') return [];
    const builtin = caseMismatchBuiltin(node.name);
    if (builtin === undefined) return [];

    return [
      {
        location: node.span.start,
        severity: 'warning',
        code: 'ATOM_CASE_MISMATCH',
        message: `Atom #${node.name} differs from builtin #${builtin} only by case; atom names are case-sensitive.`,
        context: extractContextLine(node.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

export const atomNotErrorCode: Rule = {
  code: 'ATOM_NOT_ERROR_CODE',
  nodeTypes: ['BinaryExpr', 'PostfixExpr', 'PipeChain'],
  defaultSeverity: 'warning',
  category: 'errors',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const operands = comparedOperands(node);
    if (operands === undefined) return [];
    const [left, right] = operands;

    const atom = isCodeProbe(right)
      ? bareAtom(left)
      : isCodeProbe(left)
        ? bareAtom(right)
        : undefined;
    if (atom === undefined) return [];
    if (atom.name === 'ok' || ERROR_CODE_SET.has(atom.name)) return [];
    if (caseMismatchBuiltin(atom.name) !== undefined) return [];

    return [
      {
        location: atom.span.start,
        severity: 'warning',
        code: 'ATOM_NOT_ERROR_CODE',
        message: `Atom #${atom.name} is not an error code; comparing it with .!code halts #TYPE_MISMATCH. .!code has type union(error_code, #ok).`,
        context: extractContextLine(atom.span.start.line, context.source),
        fix: null,
      },
    ];
  },
};

/** The atom a statement consists of alone, if it is a bare `#NAME` line. */
function discardedAtom(statement: StatementNode): AtomLiteralNode | undefined {
  const chain = statement.expression;
  if (chain.pipes.length > 0 || chain.terminator !== null) return undefined;
  const head = chain.head;
  if (head.type !== 'PostfixExpr') return undefined;
  if (head.methods.length > 0 || head.defaultValue !== null) return undefined;
  return head.primary.type === 'AtomLiteral' ? head.primary : undefined;
}

export const atomDiscarded: Rule = {
  code: 'ATOM_DISCARDED',
  nodeTypes: ['Script', 'Block'],
  defaultSeverity: 'warning',
  category: 'anti-patterns',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    if (node.type !== 'Script' && node.type !== 'Block') return [];
    const statements: readonly ASTNode[] = node.statements;
    const diagnostics: Diagnostic[] = [];

    statements.forEach((entry, index) => {
      // The last statement is the value; only a script made of one atom is a lone comment.
      const soleScriptStatement =
        node.type === 'Script' && statements.length === 1;
      if (index === statements.length - 1 && !soleScriptStatement) return;
      const statement = getInnerStatement(entry);
      if (statement === null) return;
      const atom = discardedAtom(statement);
      if (atom === undefined) return;

      diagnostics.push({
        location: atom.span.start,
        severity: 'warning',
        code: 'ATOM_DISCARDED',
        message: `Atom #${atom.name} is a discarded statement; a comment needs a space after '#'.`,
        context: extractContextLine(atom.span.start.line, context.source),
        fix: null,
      });
    });

    return diagnostics;
  },
};

registeredRules.push(atomCaseMismatch, atomNotErrorCode, atomDiscarded);
