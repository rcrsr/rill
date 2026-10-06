/**
 * Markdown corpus reading and rill fence classification for the example
 * harness: file discovery, block extraction, frontmatter, and skip/halt analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { RillValue } from '@rcrsr/rill';

export interface CodeBlock {
  code: string;
  lineNumber: number;
  file: string;
  expectedResult?: string;
}

export function extractRillBlocks(
  content: string,
  filePath: string
): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith('```rill')) {
      inBlock = true;
      blockStart = i + 1; // 1-indexed line number
      blockLines = [];
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      // Capture the LAST `# Result:` annotation in the block
      let expectedResult: string | undefined;
      for (const bl of blockLines) {
        const resultMatch = bl.trim().match(/^# Result:\s*(.*)$/);
        if (resultMatch) {
          expectedResult = resultMatch[1]!;
        }
      }
      blocks.push({
        code: blockLines.join('\n'),
        lineNumber: blockStart + 1, // Line after the opening fence
        file: filePath,
        ...(expectedResult !== undefined ? { expectedResult } : {}),
      });
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

export function findMarkdownFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    return targetPath.endsWith('.md') ? [targetPath] : [];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(targetPath);

    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry);
      const entryStat = fs.statSync(fullPath);

      if (entryStat.isFile() && entry.endsWith('.md')) {
        files.push(fullPath);
      } else if (entryStat.isDirectory() && !entry.startsWith('.')) {
        files.push(...findMarkdownFiles(fullPath));
      }
    }

    return files;
  }

  return [];
}

// Strip YAML frontmatter and extract variables
export function processFrontmatter(code: string): {
  code: string;
  variables: Record<string, RillValue>;
} {
  const frontmatterMatch = code.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { code, variables: {} };
  }

  const frontmatter = frontmatterMatch[1]!;
  const restCode = frontmatterMatch[2]!;
  const variables: Record<string, RillValue> = {};

  // Parse simple YAML-like args: "args: name: type, name2: type2"
  const argsMatch = frontmatter.match(/args:\s*(.+)/);
  if (argsMatch) {
    const argPairs = argsMatch[1]!.split(',');
    for (const pair of argPairs) {
      const nameMatch = pair.trim().match(/^(\w+):/);
      if (nameMatch) {
        // Provide mock values based on type hints
        const name = nameMatch[1]!;
        if (pair.includes('string')) {
          variables[name] = 'mock_' + name;
        } else if (pair.includes('number')) {
          variables[name] = 42;
        } else if (pair.includes('bool')) {
          variables[name] = true;
        } else {
          variables[name] = 'mock_value';
        }
      }
    }
  }

  return { code: restCode, variables };
}

// A line that is entirely an ellipsis-continuation comment, e.g. "# ... later use $x".
const ELLIPSIS_LINE_RE = /^[ \t]*#[ \t]+\.\.\./;
// The comment-marker form of an expected-error annotation: a `#` that starts
// a comment (preceded by line-start or whitespace), not a literal "# Error:"
// occurring inside a quoted string on an otherwise-executable line.
const ERROR_MARKER_LINE_RE = /(^|\s)# (Error|ERROR|error):/;
// A rill error code, e.g. `RILL-R010` or `RILL_P007`. When a `# Error:`
// marker's text carries one, testBlock additionally asserts the caught
// error message contains it — a cheap strengthening on top of the baseline
// halt-only assertion, since marker prose otherwise varies across docs.
const ERROR_CODE_TOKEN_RE = /RILL[-_][RPLC]\d+/;

// True if the line's `# Error:`-style marker sits inside an unclosed string
// literal rather than starting a real comment, e.g. `"see # Error: docs"`.
function markerInsideStringLiteral(line: string): boolean {
  const match = ERROR_MARKER_LINE_RE.exec(line);
  if (!match) return false;
  const before = line.slice(0, match.index);
  const quoteCount = (before.match(/(?<!\\)"/g) ?? []).length;
  return quoteCount % 2 === 1;
}

// Strip a contiguous run of ellipsis continuation lines (`# ...`) from the
// trailing edge of the block, walking backward past blank lines. These are
// pure narrative markers with no rill semantics, so they cannot be left in
// the code the way `# Error:` markers can. Only trailing ellipsis lines are
// exempt from execution — one followed by further executable code is left
// untouched, and only that trailing line is skipped.
//
// `# Error:`-style markers are NOT stripped here. The rill lexer already
// treats `#` as a comment-to-end-of-line, so a block containing one parses
// and runs natively whether the marker sits inline after real code or on
// its own line — stripping it would throw away the halt the marker exists
// to document. See `blockExpectsHalt` for how those markers are handled.
function stripTrailingMarkerLines(code: string): {
  executable: string;
  trimmed: boolean;
} {
  const lines = code.split('\n');
  let end = lines.length;
  let trimmed = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (ELLIPSIS_LINE_RE.test(line)) {
      end = i;
      trimmed = true;
      continue;
    }
    break;
  }

  return { executable: lines.slice(0, end).join('\n'), trimmed };
}

// True if any line of the (ellipsis-stripped) code carries a genuine
// `# Error:`-style marker — i.e. execution of this block is documented to
// halt. Used to flip the pass/fail polarity in testBlock: a thrown error is
// the expected outcome, and completing without one is the failure.
function blockExpectsHalt(code: string): boolean {
  return code
    .split('\n')
    .some(
      (line) =>
        ERROR_MARKER_LINE_RE.test(line) && !markerInsideStringLiteral(line)
    );
}

// Pull a strict `RILL-[RPLC]NNN` / `RILL_[RPLC]NNN` error code out of a
// block's `# Error:` marker text, if the marker names one. Baseline halt
// assertion doesn't need this — it's an optional, cheap strengthening for
// the common case where the marker already documents the exact code.
export function expectedErrorCodeToken(code: string): string | null {
  for (const line of code.split('\n')) {
    if (!ERROR_MARKER_LINE_RE.test(line) || markerInsideStringLiteral(line)) {
      continue;
    }
    const match = ERROR_CODE_TOKEN_RE.exec(line);
    if (match) return match[0];
  }
  return null;
}

// Check if block should be skipped (pseudo-code, syntax demos)
function shouldSkipBlock(code: string): string | null {
  // Skip blocks with placeholder syntax like "collection -> each body"
  if (/^\s*\w+\s+->\s+(each|map|filter|fold)\s+\w+\s*$/m.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks with "condition ? then-body" pseudo-syntax
  if (/^\s*condition\s+\?/.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks that are pure comments
  if (
    code
      .split('\n')
      .every((line) => line.trim().startsWith('#') || !line.trim())
  ) {
    return 'comments only';
  }

  return null;
}

// Determine what to run for a block: strip a trailing run of ellipsis
// continuation lines and only skip the whole block when nothing executable
// remains once those trailing lines are removed. `# Error:` markers are
// never stripped and never cause a skip — they flip `expectHalt` instead, so
// testBlock runs the code and asserts it halts rather than exempting it.
export function analyzeBlock(code: string): {
  skipReason: string | null;
  executableCode: string;
  expectHalt: boolean;
} {
  const wholeBlockReason = shouldSkipBlock(code);
  if (wholeBlockReason) {
    return {
      skipReason: wholeBlockReason,
      executableCode: code,
      expectHalt: false,
    };
  }

  const { executable, trimmed } = stripTrailingMarkerLines(code);
  if (!trimmed) {
    return {
      skipReason: null,
      executableCode: code,
      expectHalt: blockExpectsHalt(code),
    };
  }

  if (executable.trim() === '') {
    return {
      skipReason: 'contains ellipsis placeholder',
      executableCode: code,
      expectHalt: false,
    };
  }

  return {
    skipReason: null,
    executableCode: executable,
    expectHalt: blockExpectsHalt(executable),
  };
}
