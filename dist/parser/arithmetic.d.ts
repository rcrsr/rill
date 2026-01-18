/**
 * Arithmetic Expression Parsing
 * Handles | expr | arithmetic expressions
 */
import type { ArithmeticNode } from '../types.js';
import { type ParserState } from './state.js';
/**
 * Parse arithmetic expression: | expr |
 * Grammar:
 *   arith-expr = "|" additive "|"
 *   additive   = multiplicative { ("+" | "-") multiplicative }
 *   multiplicative = factor { ("*" | "/" | "%") factor }
 *   factor     = number | variable | "(" additive ")" | "-" factor
 */
export declare function parseArithmetic(state: ParserState): ArithmeticNode;
//# sourceMappingURL=arithmetic.d.ts.map