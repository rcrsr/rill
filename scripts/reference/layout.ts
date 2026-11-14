/**
 * Block layout check for rill fences.
 *
 * A block that spans lines opens with `{` at the end of a line, indents each
 * statement two spaces per open block, and closes with `}` on its own line.
 * A block that opens and closes on one line is not checked.
 *
 * Braces inside strings and comments are ignored. String interpolation
 * (`"a{$x}b"`) is scanned as code, so a brace inside it balances. Lines inside
 * an open `(` or `[`, and continuation lines that begin with `->`, `=>`, `?`,
 * `!`, or `.`, may indent deeper than their block.
 */

export interface LayoutIssue {
  /** 0-based index into the code lines passed in. */
  index: number;
  code: 'block-open' | 'block-close' | 'block-indent';
  message: string;
}

type Frame = 'block' | 'group' | 'interp';

interface OpenBrace {
  frame: Frame;
  line: number;
}

const CONTINUATION = /^(->|=>|\?|!|\.)/;

export function checkBlockLayout(code: string[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const stack: OpenBrace[] = [];
  /** Inside a string: 'single' for "...", 'triple' for """...""". */
  let inString: 'single' | 'triple' | null = null;
  /** String kinds suspended by an interpolation, innermost last. */
  const suspended: Array<'single' | 'triple'> = [];

  const blockDepth = (): number =>
    stack.filter((b) => b.frame === 'block').length;
  const inGroup = (): boolean => stack.some((b) => b.frame === 'group');

  code.forEach((line, index) => {
    const trimmed = line.trim();
    const startsInString = inString !== null;
    const depthAtStart = blockDepth();
    const groupAtStart = inGroup();
    const indent = line.length - line.trimStart().length;

    // Indentation, checked against the depth before this line's own braces.
    if (
      !startsInString &&
      trimmed !== '' &&
      !trimmed.startsWith('#') &&
      depthAtStart > 0
    ) {
      const closesFirst = trimmed.startsWith('}');
      const want = 2 * (closesFirst ? depthAtStart - 1 : depthAtStart);
      const relaxed =
        !closesFirst && (groupAtStart || CONTINUATION.test(trimmed));
      if (relaxed ? indent < want : indent !== want) {
        issues.push({
          index,
          code: 'block-indent',
          message: `Indent ${indent}; a statement in ${depthAtStart} open block(s) indents ${want}`,
        });
      }
    }

    const opened: Array<{ col: number; brace: OpenBrace }> = [];
    let i = 0;
    while (i < line.length) {
      const ch = line[i];
      if (inString !== null) {
        if (ch === '\\') {
          i += 2;
          continue;
        }
        if (inString === 'triple' && line.startsWith('"""', i)) {
          inString = null;
          i += 3;
          continue;
        }
        if (inString === 'single' && ch === '"') {
          inString = null;
          i += 1;
          continue;
        }
        if (ch === '{') {
          suspended.push(inString);
          inString = null;
          stack.push({ frame: 'interp', line: index });
        }
        i += 1;
        continue;
      }
      if (
        ch === '#' &&
        (i + 1 >= line.length || /\s/.test(line.charAt(i + 1)))
      ) {
        break; // comment to end of line
      }
      if (line.startsWith('"""', i)) {
        inString = 'triple';
        i += 3;
        continue;
      }
      if (ch === '"') {
        inString = 'single';
        i += 1;
        continue;
      }
      if (ch === '{') {
        const brace: OpenBrace = { frame: 'block', line: index };
        stack.push(brace);
        opened.push({ col: i, brace });
      } else if (ch === '(' || ch === '[') {
        stack.push({ frame: 'group', line: index });
      } else if (ch === ')' || ch === ']') {
        if (stack.at(-1)?.frame === 'group') stack.pop();
      } else if (ch === '}') {
        const top = stack.pop();
        if (top?.frame === 'interp') {
          inString = suspended.pop() ?? null;
        } else if (top?.frame === 'block' && top.line !== index) {
          const before = line.slice(0, i).trim();
          if (before !== '') {
            issues.push({
              index,
              code: 'block-close',
              message: 'A block that spans lines closes with } on its own line',
            });
          }
        }
      }
      i += 1;
    }

    // A block opened on this line and still open must end the line.
    for (const { col, brace } of opened) {
      if (!stack.includes(brace)) continue;
      const after = stripComment(line.slice(col + 1)).trim();
      if (after !== '') {
        issues.push({
          index,
          code: 'block-open',
          message:
            'A block that spans lines opens with { at the end of its line',
        });
      }
    }
  });
  return issues;
}

function stripComment(text: string): string {
  const m = /(^|\s)#(\s|$)/.exec(text);
  return m ? text.slice(0, m.index) : text;
}
