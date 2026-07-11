/**
 * Rill Parser Tests: parseWithRecovery no-throw contract and unclosed-bracket
 * resync-to-EOF behavior
 *
 * parseWithRecovery() promises to never throw: any failure surfaces as a
 * ParseResult with `success: false`. Two shapes exercise that contract:
 *
 * - Deeply nested input can overflow the call stack inside the recursive
 *   expression descent. That escapes the per-statement ParseError/LexerError
 *   catch inside parseScript() as an uncaught RangeError, so the success
 *   path of parseWithRecovery() itself must guard against it.
 * - A stray unclosed bracket resyncs all the way to EOF: recoverToNextStatement
 *   only stops early on a NEWLINE when its expected-closer stack is empty, so
 *   once a construct opens without a matching close, every subsequent line
 *   (blank lines included) is swallowed into a single RecoveryErrorNode
 *   spanning to end of input. A blank-line-bounded early exit was tried and
 *   reverted: it broke the common case of a still-open construct that
 *   legitimately spans a blank line used for formatting (e.g.
 *   `error(\n1 +\n\nfoo\n)\n"after"\n`, which closes later and must still
 *   produce a single correct PartialExpression/RecoveryError, not three
 *   broken statements). Distinguishing "abandoned forever" from "closes
 *   later, just has a blank line" needs real look-ahead, which is a design
 *   decision out of scope here; this test documents the current,
 *   EOF-bounded behavior instead.
 */

import { describe, expect, it } from 'vitest';
import { parseWithRecovery } from '@rcrsr/rill';

describe('parseWithRecovery no-throw contract', () => {
  it('returns success:false instead of throwing on deeply nested input that overflows the call stack', () => {
    const source = '('.repeat(500) + '1' + ')'.repeat(500);

    let result: ReturnType<typeof parseWithRecovery>;
    expect(() => {
      result = parseWithRecovery(source);
    }).not.toThrow();

    expect(result!.success).toBe(false);
    expect(result!.errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe('parseWithRecovery unclosed bracket resync-to-EOF', () => {
  it('resyncs a never-closed bracket all the way to EOF, swallowing subsequent lines including a blank line', () => {
    // `bar(2` never closes: the blank line and the `"after"` statement that
    // follow are swallowed into the same RecoveryErrorNode along with the
    // opening `foo(1`, rather than surviving as separate statements.
    const source = 'foo(1\nbar(2\n\n"after"\n';

    const result = parseWithRecovery(source);

    expect(result.success).toBe(false);
    expect(result.ast.statements.length).toBe(1);
    expect(result.ast.statements[0]?.type).toBe('RecoveryError');
    const recoveryNode = result.ast.statements[0] as unknown as {
      text: string;
      span: { end: { offset: number } };
    };
    expect(recoveryNode.text).toBe(source);
    expect(recoveryNode.span.end.offset).toBe(source.length);
  });

  it('still resolves a construct that closes later, even when it spans a blank line', () => {
    // The `error(...)` call remains open across a blank line used for
    // formatting, but does close at the trailing `)`. This must produce a
    // single correct recovery/salvage result, not be split by the blank
    // line into multiple broken statements.
    const source = 'error(\n1 +\n\nfoo\n)\n"after"\n';

    const result = parseWithRecovery(source);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.ast.statements.length).toBe(2);
    expect(result.ast.statements[1]?.type).toBe('Statement');
  });
});
