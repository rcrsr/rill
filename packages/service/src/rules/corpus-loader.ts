/**
 * Corpus loader for the protected core language test suite.
 * Extracts rill source snippets embedded as string/template literals in
 * `packages/core/tests/language/*.test.ts` so rule-engine tests can run
 * against the full golden corpus without ever writing to, or importing
 * from, that protected directory. Files are discovered via a directory
 * glob; nothing here hardcodes a file list or a file count.
 *
 * Shared by the corpus firing-set test in this file's sibling test module
 * and by the diagnostic-parity test that consumes the same snippet set.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// CORPUS SNIPPET SHAPE
// ============================================================

/** A single rill source snippet extracted from a corpus test file. */
export interface CorpusSnippet {
  /** Corpus test file the snippet was extracted from (basename only). */
  readonly file: string;
  /** Extracted rill source text, with JS string escapes resolved. */
  readonly source: string;
}

// ============================================================
// CORPUS DIRECTORY RESOLUTION
// ============================================================

/**
 * Names of test-helper functions whose first argument is rill source text.
 * Every one of these helpers (defined in `packages/core/tests/helpers/`
 * or re-exported directly from `@rcrsr/rill`) takes the script text as its
 * first positional argument.
 */
const SOURCE_TAKING_CALLS = [
  'parseWithRecovery',
  'runWithContext',
  'runFull',
  'parse',
  'run',
  'execute',
] as const;

/**
 * Resolve the absolute path to the protected core language test corpus,
 * relative to this file's own location. Never reads or writes any file
 * under that directory besides plain-text `readFileSync` consumption.
 */
function resolveCorpusDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '../../../core/tests/language');
}

/**
 * List every `.test.ts` file in the corpus directory via a directory glob.
 * Never hardcodes a file list or a file count; the corpus is protected and
 * may only be read, never modified.
 */
function listCorpusFiles(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.test.ts'))
    .sort();
}

// ============================================================
// STRING-LITERAL SCANNER
// ============================================================

/**
 * Resolve the small set of JS escape sequences that appear in corpus test
 * source strings. Unrecognized escapes fall back to the escaped character
 * itself, matching standard JS string-literal semantics for `\c` where `c`
 * has no special meaning.
 */
function unescapeJsString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\' || i === raw.length - 1) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    i++;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 't':
        out += '\t';
        break;
      case 'r':
        out += '\r';
        break;
      case '0':
        out += '\0';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'v':
        out += '\v';
        break;
      case '\n':
        // Line continuation: backslash-newline resolves to nothing.
        break;
      default:
        out += next;
        break;
    }
  }
  return out;
}

/** Result of scanning a single string/template literal from a source index. */
interface ScannedLiteral {
  /** Resolved literal text (escapes applied), or `null` if the literal
   * contained a template interpolation (`${...}`) and cannot be resolved
   * statically. */
  readonly value: string | null;
  /** Index immediately after the literal's closing quote. */
  readonly endIndex: number;
}

/**
 * Scan a string or template literal starting at `startIndex` (which may
 * point at leading whitespace before the opening quote). Returns `null` if
 * no literal starts there. Template literals containing `${...}`
 * interpolation resolve to `value: null` (dynamic, not statically
 * extractable) but the scanner still reports `endIndex` so the caller can
 * resume scanning past the literal.
 */
function scanStringLiteral(
  text: string,
  startIndex: number
): ScannedLiteral | null {
  let i = startIndex;
  while (i < text.length && /\s/.test(text[i] as string)) {
    i++;
  }
  const quote = text[i];
  if (quote !== '`' && quote !== "'" && quote !== '"') {
    return null;
  }
  const isTemplate = quote === '`';

  let j = i + 1;
  let raw = '';
  let dynamic = false;

  while (j < text.length) {
    const ch = text[j];
    if (ch === '\\') {
      raw += ch + (text[j + 1] ?? '');
      j += 2;
      continue;
    }
    if (isTemplate && ch === '$' && text[j + 1] === '{') {
      dynamic = true;
      let depth = 1;
      j += 2;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      continue;
    }
    if (ch === quote) {
      j++;
      break;
    }
    raw += ch;
    j++;
  }

  return { value: dynamic ? null : unescapeJsString(raw), endIndex: j };
}

/** Matches `const name = ` / `let name = ` variable declarations, the
 * `const src = \`...\`` pattern most corpus files use to hold source text
 * before passing the variable to a source-taking call several lines away. */
const DECLARATION_PATTERN = /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*/g;

/**
 * Extract every statically-resolvable rill source snippet in `text`,
 * whether passed directly as a literal first argument to a source-taking
 * test helper call (`parse(\`...\`)`) or assigned to a variable first
 * (`const script = \`...\`;`) and referenced by name later. Calls or
 * declarations whose value is not a string/template literal (e.g. a
 * variable reference, a function call) or whose template literal contains
 * `${...}` interpolation are skipped: they carry no statically-extractable
 * source.
 */
function extractSnippetsFromText(text: string): string[] {
  const snippets: string[] = [];
  const callPattern = new RegExp(
    `\\b(?:${SOURCE_TAKING_CALLS.join('|')})\\(`,
    'g'
  );

  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(text)) !== null) {
    const afterParen = match.index + match[0].length;
    const literal = scanStringLiteral(text, afterParen);
    if (literal === null) {
      continue;
    }
    if (literal.value !== null) {
      snippets.push(literal.value);
    }
    // Resume scanning after the literal to avoid re-matching inside it.
    callPattern.lastIndex = literal.endIndex;
  }

  DECLARATION_PATTERN.lastIndex = 0;
  while ((match = DECLARATION_PATTERN.exec(text)) !== null) {
    const afterEquals = match.index + match[0].length;
    const literal = scanStringLiteral(text, afterEquals);
    if (literal === null) {
      continue;
    }
    if (literal.value !== null) {
      snippets.push(literal.value);
    }
    DECLARATION_PATTERN.lastIndex = literal.endIndex;
  }

  return snippets;
}

// ============================================================
// PUBLIC LOADER
// ============================================================

/**
 * Load every statically-extractable rill source snippet from the
 * protected `packages/core/tests/language/*.test.ts` corpus. Reads each
 * file as plain text (never imports it); the corpus directory is
 * discovered via `readdirSync`, so adding or removing corpus files never
 * requires updating this loader.
 */
export function loadCorpusSnippets(): CorpusSnippet[] {
  const directory = resolveCorpusDirectory();
  const files = listCorpusFiles(directory);

  const snippets: CorpusSnippet[] = [];
  for (const file of files) {
    const text = readFileSync(join(directory, file), 'utf8');
    for (const source of extractSnippetsFromText(text)) {
      snippets.push({ file, source });
    }
  }
  return snippets;
}

/**
 * List the corpus `.test.ts` file names via the same directory glob
 * `loadCorpusSnippets` uses, without reading file contents. Useful for
 * assertions that need the file count without paying extraction cost.
 */
export function listCorpusFileNames(): string[] {
  return listCorpusFiles(resolveCorpusDirectory());
}
