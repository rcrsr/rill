#!/usr/bin/env node
/**
 * Migration script: legacy keyword collection operators → callable form
 *
 * Pass 1: fold arity fix
 *   `-> fold(SEED) { BODY }` → `-> fold(SEED, { BODY })`
 *
 * Pass 2: keyword rename (run to fixed-point for nested blocks)
 *
 * Block/inline-closure/variable forms:
 *   `-> each(SEED) { BODY }` → `-> acc(SEED, { BODY })`
 *   `-> each { BODY }` → `-> seq({ BODY })`
 *   `-> each |x| BODY` → `-> seq(|x| BODY)`
 *   `-> each $var` → `-> seq($var)`
 *   `-> each log` (bare fn) → `-> seq(log)`
 *   `-> each (expr)` (grouped) → `-> seq({ expr })`
 *   `-> each .method` (method shorthand) → `-> seq({ $.method })`
 *   `-> map ...` → `-> fan(...)`  (same body forms)
 *   `-> filter ...` → `-> filter(...)` (same body forms)
 *
 * Rules:
 * - Only transforms legacy forms. Already-new forms (`-> seq(...)`) pass through.
 * - Handles nested braces/parens by brace-counting.
 * - Handles multiline and nested blocks via fixed-point iteration.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const FILES = [
  'packages/core/tests/language/streams.test.ts',
  'packages/core/tests/language/iterators.test.ts',
  'packages/core/tests/language/ref-llms-full-assertions.test.ts',
  'packages/core/tests/language/spread.test.ts',
  'packages/core/tests/language/block-scoping.test.ts',
  'packages/core/tests/language/closure-hoist-validation.test.ts',
  'packages/core/tests/language/assert.test.ts',
  'packages/core/tests/language/error.test.ts',
  'packages/core/tests/language/loops.test.ts',
  'packages/core/tests/language/pipe-targets.test.ts',
  'packages/core/tests/language/vectors.test.ts',
  'packages/core/tests/language/list-membership.test.ts',
  'packages/core/tests/language/statement-boundaries.test.ts',
  'packages/core/tests/language/functions.test.ts',
  'packages/core/tests/language/pass.test.ts',
  'packages/core/tests/language/datetime.test.ts',
  'packages/core/tests/language/duration.test.ts',
  'packages/core/tests/language/capture-types.test.ts',
  'packages/core/tests/language/arithmetic.test.ts',
  'packages/core/tests/language/annotations.test.ts',
  'packages/core/tests/language/late-bound-closures.test.ts',
  'packages/core/tests/language/scope-isolation.test.ts',
  'packages/core/tests/language/type-assertions.test.ts',
  'packages/core/tests/language/conditionals.test.ts',
  'packages/core/tests/language/variables.test.ts',
  'packages/core/tests/language/frontmatter.test.ts',
  'packages/core/tests/language/literals.test.ts',
  'packages/core/tests/language/closure-semantics.test.ts',
  'packages/core/tests/language/closure-auto-invoke.test.ts',
];

const ROOT = resolve(process.cwd());

/** Find matching closing brace. `start` points to `{`. Returns index of `}`. */
function findMatchingBrace(src, start) {
  let depth = 0,
    i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Find matching closing paren. `start` points to `(`. Returns index of `)`. */
function findMatchingParen(src, start) {
  let depth = 0,
    i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Consume a complete "body" token from position `pos` in src.
 * Handles:
 *   { BLOCK }          → returns { type: 'block', end, text }
 *   |...| CLOSURE      → returns { type: 'closure', end, text }
 *   $var               → returns { type: 'varref', end, text }
 *   .method...         → returns { type: 'method', end, text }
 *   (grouped)          → returns { type: 'grouped', end, text }
 *   identifier         → returns { type: 'bareident', end, text }
 *   null if no match
 */
function consumeBody(src, pos) {
  if (pos >= src.length) return null;
  const ch = src[pos];

  // Block: { BODY }
  if (ch === '{') {
    const end = findMatchingBrace(src, pos);
    if (end === -1) return null;
    return { type: 'block', end: end + 1, text: src.slice(pos, end + 1) };
  }

  // Inline closure: |...| BODY or ||...|| BODY
  if (ch === '|') {
    // Find the matching closing |
    // The pattern can be ||, |...| (anonymous), or |params|
    // We need to find the body after the closure params
    // Simplified: find the first unescaped | that ends the param list
    let i = pos + 1;
    // Handle ||...|| or |params|
    if (src[i] === '|') {
      // ||...|| form - double pipe, skip to end of params
      i++;
      while (i < src.length && !(src[i] === '|' && src[i + 1] === '|')) i++;
      if (i >= src.length) return null;
      i += 2; // skip ||
    } else {
      // |params| form - find closing |
      while (i < src.length && src[i] !== '|') {
        if (src[i] === '(') {
          const close = findMatchingParen(src, i);
          if (close === -1) return null;
          i = close + 1;
        } else {
          i++;
        }
      }
      if (i >= src.length) return null;
      i++; // skip closing |
    }
    // Now consume the body after the closure params
    // Skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;
    const bodyResult = consumeBody(src, i);
    if (!bodyResult) return null;
    return {
      type: 'closure',
      end: bodyResult.end,
      text: src.slice(pos, bodyResult.end),
    };
  }

  // Variable reference: $var or just $
  if (ch === '$') {
    let i = pos + 1;
    // Consume variable name chars (letters, digits, underscore)
    while (i < src.length && /[\w]/.test(src[i])) i++;
    return { type: 'varref', end: i, text: src.slice(pos, i) };
  }

  // Method shorthand: .method (or .method.chain or .method(args))
  if (ch === '.') {
    let i = pos + 1;
    // Consume the method chain
    while (i < src.length) {
      // Skip identifier chars
      while (i < src.length && /[\w]/.test(src[i])) i++;
      // Handle method args in parens
      if (src[i] === '(') {
        const close = findMatchingParen(src, i);
        if (close === -1) break;
        i = close + 1;
      }
      // Continue chain if another dot follows
      if (src[i] === '.') {
        i++;
        continue;
      }
      break;
    }
    if (i === pos + 1) return null; // just a dot, no method name
    return { type: 'method', end: i, text: src.slice(pos, i) };
  }

  // Grouped expression: (expr)
  if (ch === '(') {
    const end = findMatchingParen(src, pos);
    if (end === -1) return null;
    return { type: 'grouped', end: end + 1, text: src.slice(pos, end + 1) };
  }

  // Bare identifier (function name like `log`, `double`, `ns::func`)
  if (/[a-zA-Z_]/.test(ch)) {
    let i = pos;
    while (i < src.length && /[\w:_]/.test(src[i])) i++;
    if (i === pos) return null;
    return { type: 'bareident', end: i, text: src.slice(pos, i) };
  }

  return null;
}

/**
 * Convert a body token to the argument form for the new callable syntax.
 *
 * - block: `{ BODY }` → `{ BODY }` (keep as-is; it's already a closure arg)
 * - closure: `|x| BODY` → `|x| BODY` (keep as-is)
 * - varref: `$var` → `$var` (keep as-is; callable reference)
 * - grouped: `(expr)` → `{ expr }` (unwrap parens, wrap in block — makes it callable)
 * - method: `.method` → `{ $.method }` (wrap in block with implicit $. receiver)
 * - bareident: `log` → `log` (function reference, keep as-is)
 */
function bodyToArg(body) {
  switch (body.type) {
    case 'block':
    case 'closure':
    case 'varref':
    case 'bareident':
      return body.text;
    case 'grouped': {
      // Unwrap outer parens, wrap in block
      const inner = body.text.slice(1, -1).trim();
      return `{ ${inner} }`;
    }
    case 'method': {
      // Wrap in block with implicit $ receiver
      return `{ $${body.text} }`;
    }
    default:
      return body.text;
  }
}

/**
 * Pass 1: Transform `-> fold(SEED) { BODY }` to `-> fold(SEED, { BODY })`.
 */
function pass1FoldArityFix(src) {
  let result = '',
    i = 0;

  while (i < src.length) {
    const foldIdx = src.indexOf('-> fold(', i);
    if (foldIdx === -1) {
      result += src.slice(i);
      break;
    }

    result += src.slice(i, foldIdx);

    const openParen = foldIdx + '-> fold'.length; // points to `(`
    const closeParen = findMatchingParen(src, openParen);
    if (closeParen === -1) {
      result += src.slice(foldIdx);
      i = src.length;
      break;
    }

    const afterParen = closeParen + 1;
    const wsMatch = src.slice(afterParen).match(/^(\s*)/);
    const ws = wsMatch ? wsMatch[1] : '';
    const afterWs = afterParen + ws.length;

    if (src[afterWs] === '{') {
      // `-> fold(SEED) { BODY }` → `-> fold(SEED, { BODY })`
      const braceEnd = findMatchingBrace(src, afterWs);
      if (braceEnd === -1) {
        result += src.slice(foldIdx);
        i = src.length;
        break;
      }
      const seed = src.slice(openParen + 1, closeParen);
      const body = src.slice(afterWs, braceEnd + 1);
      result += `-> fold(${seed}, ${body})`;
      i = braceEnd + 1;
    } else {
      // Already new form or other usage — copy as-is
      result += src.slice(foldIdx, afterParen);
      i = afterParen;
    }
  }

  return result;
}

/**
 * Transform a keyword with optional seed and a body.
 *
 * Handles:
 *   `-> each(SEED) { BODY }` → `-> acc(SEED, { BODY })`
 *   `-> each { BODY }` → `-> seq({ BODY })`
 *   `-> each |x| BODY` → `-> seq(|x| BODY)`
 *   `-> each $var` → `-> seq($var)`
 *   `-> each .method` → `-> seq({ $.method })`
 *   `-> each (expr)` → `-> seq({ expr })`
 *   `-> each log` → `-> seq(log)`
 *   `-> map ...` → `-> fan(...)`
 *   `-> filter ...` → `-> filter(...)`
 *
 * For `each(SEED) BODY`: SEED form goes to `acc(SEED, BODY)`.
 *
 * Returns [transformed_string, replacement_count].
 */
function transformKeyword(src, keyword, newFn, accFn) {
  let result = '',
    i = 0,
    count = 0;
  const pattern = `-> ${keyword}`;
  const prefixLen = pattern.length;

  while (i < src.length) {
    const idx = src.indexOf(pattern, i);
    if (idx === -1) {
      result += src.slice(i);
      break;
    }

    const afterKeyword = idx + prefixLen;
    const followChar = src[afterKeyword];

    // Avoid substring matches (e.g., `-> each_thing`, `-> mapping`, etc.)
    if (followChar !== undefined && /[a-zA-Z0-9_$]/.test(followChar)) {
      result += src.slice(i, afterKeyword);
      i = afterKeyword;
      continue;
    }

    // Check for optional whitespace
    const wsMatch = src.slice(afterKeyword).match(/^(\s*)/);
    const ws = wsMatch ? wsMatch[1] : '';
    const afterWs = afterKeyword + ws.length;
    const nextCh = src[afterWs];

    // Case 1: `-> keyword(SEED) { BODY }` — accumulator form (only for `each`)
    if (nextCh === '(' && accFn) {
      const openParen = afterWs;
      const closeParen = findMatchingParen(src, openParen);
      if (closeParen === -1) {
        result += src.slice(i, afterWs);
        i = afterWs;
        continue;
      }

      const afterClose = closeParen + 1;
      const ws2Match = src.slice(afterClose).match(/^(\s*)/);
      const ws2 = ws2Match ? ws2Match[1] : '';
      const afterWs2 = afterClose + ws2.length;

      if (src[afterWs2] === '{') {
        // `-> each(SEED) { BODY }` → `-> acc(SEED, { BODY })`
        const seed = src.slice(openParen + 1, closeParen);
        const braceEnd = findMatchingBrace(src, afterWs2);
        if (braceEnd === -1) {
          result += src.slice(i);
          i = src.length;
          break;
        }
        const body = src.slice(afterWs2, braceEnd + 1);
        result += src.slice(i, idx) + `-> ${accFn}(${seed}, ${body})`;
        i = braceEnd + 1;
        count++;
        continue;
      } else {
        // `-> each (expr)` — grouped expression body (NOT accumulator form)
        // Only treat as grouped if there was whitespace before `(` (i.e., `each (expr)` not `each(seed)`)
        if (ws.length > 0) {
          const inner = src.slice(openParen + 1, closeParen).trim();
          result += src.slice(i, idx) + `-> ${newFn}({ ${inner} })`;
          i = closeParen + 1;
          count++;
          continue;
        }
        // No whitespace: `-> each(...)` without `{` — not a legacy form, skip
        result += src.slice(i, afterClose);
        i = afterClose;
        continue;
      }
    }

    // Case 2: keyword directly followed by `(` (no whitespace) — already new callable form
    // e.g., `-> filter({...})`, `-> fan({...})`, `-> seq({...})`
    if (nextCh === '(' && ws.length === 0) {
      result += src.slice(i, afterKeyword);
      i = afterKeyword;
      continue;
    }

    // Case 3: keyword followed by whitespace then `(` — legacy grouped expression form
    // e.g., `-> filter (!.empty)`, `-> each ($ + 10)`, `-> map (expr)`
    if (src[afterWs] === '(' && ws.length > 0 && !accFn) {
      // Only for keywords without accFn (map, filter) since each's case is handled above
      const groupedEnd = findMatchingParen(src, afterWs);
      if (groupedEnd === -1) {
        result += src.slice(i, afterWs);
        i = afterWs;
        continue;
      }
      const inner = src.slice(afterWs + 1, groupedEnd).trim();
      result += src.slice(i, idx) + `-> ${newFn}({ ${inner} })`;
      i = groupedEnd + 1;
      count++;
      continue;
    }

    // Case 3: keyword followed by body (all non-paren forms)
    const bodyToken = consumeBody(src, afterWs);
    if (!bodyToken) {
      // No body token found — not a legacy form, skip
      result += src.slice(i, afterWs);
      i = afterWs;
      continue;
    }

    // We have a body token — transform it
    const arg = bodyToArg(bodyToken);
    result += src.slice(i, idx) + `-> ${newFn}(${arg})`;
    i = bodyToken.end;
    count++;
  }

  return [result, count];
}

/**
 * Pass 2: Apply all keyword renames to fixed-point (handles nested blocks).
 */
function pass2KeywordRename(src) {
  let current = src;
  let totalReplaced = 1;

  while (totalReplaced > 0) {
    totalReplaced = 0;
    let result, count;

    // each → seq (plain), each(seed) → acc
    [result, count] = transformKeyword(current, 'each', 'seq', 'acc');
    current = result;
    totalReplaced += count;

    // map → fan
    [result, count] = transformKeyword(current, 'map', 'fan', null);
    current = result;
    totalReplaced += count;

    // filter → filter (same name)
    [result, count] = transformKeyword(current, 'filter', 'filter', null);
    current = result;
    totalReplaced += count;
  }

  return current;
}

function migrateFile(relPath) {
  const absPath = resolve(ROOT, relPath);
  let src;
  try {
    src = readFileSync(absPath, 'utf-8');
  } catch (e) {
    console.error(`ERROR: Cannot read ${absPath}: ${e.message}`);
    return { changed: false, error: e.message };
  }

  const after1 = pass1FoldArityFix(src);
  const after2 = pass2KeywordRename(after1);

  if (after2 === src) {
    console.log(`  UNCHANGED: ${relPath}`);
    return { changed: false };
  }

  writeFileSync(absPath, after2, 'utf-8');
  console.log(`  MIGRATED:  ${relPath}`);
  return { changed: true };
}

console.log('Running collection operator syntax migration...\n');
let changedCount = 0,
  errorCount = 0;

for (const file of FILES) {
  const { changed, error } = migrateFile(file);
  if (changed) changedCount++;
  if (error) errorCount++;
}

console.log(`\nDone. Changed: ${changedCount}, Errors: ${errorCount}`);
