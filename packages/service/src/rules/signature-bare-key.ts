/**
 * Flags a `.signature` read compared with a string literal that holds a bare
 * non-identifier dict or ordered key. A signature prints every key that is
 * not an identifier quoted, so a literal that spells such a key bare never
 * equals the signature: the comparison is always false (true for `!=` and
 * `.ne`).
 *
 * Silent by design: interpolated strings, operands that are not a literal,
 * and a `.signature` read with a default or existence check.
 */

import type { ASTNode } from '@rcrsr/rill';
import type { Diagnostic, Rule, RuleContext } from './types.js';
import { formatFieldKey } from '@rcrsr/rill';
import {
  comparedOperands,
  extractContextLine,
  trailingMemberName,
} from './helpers.js';
import { unwrapBareLiteral } from './literal-shape.js';
import { registeredRules } from './rules-registry.js';

interface BareKey {
  readonly bare: string;
  readonly printed: string;
}

const KEY_DELIMITERS = '([,';
const KEY_BREAKERS = '()[],"';

/** True for a `.signature` read: `$t.signature` or `dict(...).signature`. */
function isSignatureRead(node: ASTNode): boolean {
  if (node.type === 'Variable') {
    if (node.defaultValue !== null || node.existenceCheck !== null)
      return false;
  } else if (node.type === 'PostfixExpr') {
    if (node.defaultValue !== null || node.existenceCheck) return false;
  }
  return trailingMemberName(node) === 'signature';
}

/** Keys in a signature string that are spelled bare but print quoted. */
function bareKeys(text: string): BareKey[] {
  const out: BareKey[] = [];
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuote) {
      if (c === '\\') i++;
      else if (c === '"') inQuote = false;
      continue;
    }
    if (c === '"') {
      inQuote = true;
      continue;
    }
    if (!KEY_DELIMITERS.includes(c)) continue;
    let start = i + 1;
    while (start < text.length && /\s/.test(text.charAt(start))) start++;
    let end = start;
    while (end < text.length && !KEY_BREAKERS.includes(text.charAt(end))) {
      if (text.charAt(end) === ':') break;
      end++;
    }
    if (text.charAt(end) !== ':') continue;
    const key = text.slice(start, end);
    const printed = formatFieldKey(key);
    if (printed !== key) out.push({ bare: key, printed });
  }
  return out;
}

function literalBareKeys(node: ASTNode): BareKey[] {
  const literal = unwrapBareLiteral(node);
  if (literal.type !== 'StringLiteral') return [];
  let text = '';
  for (const part of literal.parts) {
    if (typeof part !== 'string') return [];
    text += part;
  }
  return bareKeys(text);
}

function isNegated(node: ASTNode): boolean {
  if (node.type === 'BinaryExpr') return node.op === '!=';
  if (node.type === 'PostfixExpr')
    return (
      node.methods[0]?.type === 'MethodCall' && node.methods[0].name === 'ne'
    );
  if (node.type === 'PipeChain')
    return node.pipes[0]?.type === 'MethodCall' && node.pipes[0].name === 'ne';
  return false;
}

export const signatureBareKey: Rule = {
  code: 'SIGNATURE_BARE_KEY',
  nodeTypes: ['BinaryExpr', 'PostfixExpr', 'PipeChain'],
  defaultSeverity: 'warning',
  category: 'types',

  validate(node: ASTNode, context: RuleContext): Diagnostic[] {
    const operands = comparedOperands(node);
    if (operands === undefined) return [];
    const [left, right] = operands;
    const l = unwrapBareLiteral(left);
    const r = unwrapBareLiteral(right);
    let literal: ASTNode;
    if (isSignatureRead(l)) literal = r;
    else if (isSignatureRead(r)) literal = l;
    else return [];
    const [first] = literalBareKeys(literal);
    if (first === undefined) return [];
    const at = literal.span.start;
    return [
      {
        location: at,
        severity: 'warning',
        code: 'SIGNATURE_BARE_KEY',
        message: `.signature prints the key ${first.bare} as ${first.printed}, so this comparison is always ${isNegated(node) ? 'true' : 'false'}; quote the key in the string.`,
        context: extractContextLine(at.line, context.source),
        fix: null,
      },
    ];
  },
};

registeredRules.push(signatureBareKey);
