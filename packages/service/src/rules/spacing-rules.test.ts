import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { spacingOperator } from './spacing-operator.js';
import { spacingBraces } from './spacing-braces.js';
import { spacingBrackets } from './spacing-brackets.js';
import { spacingClosure } from './spacing-closure.js';
import { indentContinuation } from './indent-continuation.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('SPACING_OPERATOR', () => {
  it('fires when a binary operator has no surrounding spaces', () => {
    const source = '1+2\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [spacingOperator]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_OPERATOR',
      severity: 'info',
      message: "Operator '+' should have spaces on both sides",
      location: { line: 1, column: 1, offset: 0 },
      context: '1+2',
      fix: null,
    });
  });

  it('does not fire when a binary operator has surrounding spaces', () => {
    const source = '1 + 2\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingOperator])).toEqual(
      []
    );
  });

  it('fires when the pipe operator has no surrounding spaces', () => {
    const source = '"a"->log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [spacingOperator]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_OPERATOR',
      severity: 'info',
      message: "Pipe operator '->' should have spaces on both sides",
      fix: null,
    });
  });

  it('does not fire when the pipe operator has surrounding spaces', () => {
    const source = '"a" -> log\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingOperator])).toEqual(
      []
    );
  });

  it('does not fire on the Capture branch: CaptureNode.span no longer spans the => token in the current core AST, so the missing-space check on it can never match', () => {
    const source = '5=>$x\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingOperator])).toEqual(
      []
    );
  });

  it('fires when a $var is followed directly by -> with no space', () => {
    const source = '$x ->log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [spacingOperator]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_OPERATOR',
      severity: 'info',
      message: "Pipe operator '->' should have spaces on both sides",
      fix: null,
    });
  });

  it('does not fire when a correctly-spaced + appears inside a string literal', () => {
    const source = '"1+2" + 3\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingOperator])).toEqual(
      []
    );
  });

  it('does not fire when a correctly-spaced pipe follows an expression containing "->" inside a string literal', () => {
    const source = '"a->b" -> log\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingOperator])).toEqual(
      []
    );
  });
});

describe('SPACING_BRACES', () => {
  it('fires on a block missing space after { and before }', () => {
    const source = 'seq({$}) -> log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [spacingBraces]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      code: 'SPACING_BRACES',
      severity: 'info',
      message: 'Space required after opening brace {',
      fix: null,
    });
    expect(result[1]).toMatchObject({
      code: 'SPACING_BRACES',
      severity: 'info',
      message: 'Space required before closing brace }',
      fix: null,
    });
  });

  it('does not fire on a properly spaced block', () => {
    const source = 'seq({ $ }) -> log\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingBraces])).toEqual([]);
  });

  it('does not fire the closing-brace check on a grouped-expression closure body', () => {
    const source = '|x| ($x * 2)\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingBraces])).toEqual([]);
  });
});

describe('SPACING_BRACKETS', () => {
  it('fires on bracket access with inner spaces, always with fix: null', () => {
    const source = '$x[ 0 ]\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [spacingBrackets]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'SPACING_BRACKETS',
      severity: 'info',
      message: 'No spaces inside brackets: remove spaces around 0',
      fix: null,
    });
  });

  it('does not fire on tight bracket access', () => {
    const source = '$x[0]\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingBrackets])).toEqual(
      []
    );
  });

  it('does not fire on a quoted computed key containing bracket-adjacent characters', () => {
    const source = '$dict["a[ b"]\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [spacingBrackets])).toEqual(
      []
    );
  });
});

describe('SPACING_CLOSURE', () => {
  it('never fires: both branches are dead in the ported source rule (the space-before-pipe check only inspects text starting at the pipe itself, and the missing-space-after-params branch is an explicit no-op)', () => {
    const sources = ['|x| ($x)\n', '|a, b| { $a + $b }\n', '|| { $.count }\n'];

    for (const source of sources) {
      const parsed = toParseResult(source);
      expect(runRules(parsed, source, makeConfig(), [spacingClosure])).toEqual(
        []
      );
    }
  });
});

describe('INDENT_CONTINUATION', () => {
  it('fires with a synthetic location and trimmed-line context on an under-indented continuation', () => {
    const source = '$x\n-> log\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [indentContinuation]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'INDENT_CONTINUATION',
      severity: 'info',
      message: 'Continuation lines should be indented by 2 spaces',
      location: { line: 2, column: 1, offset: 0 },
      context: '-> log',
      fix: null,
    });
  });

  it('does not fire when the continuation is indented by 2 spaces', () => {
    const source = '$x\n  -> log\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [indentContinuation])
    ).toEqual([]);
  });

  it('does not fire on a single-line chain', () => {
    const source = '"hello" -> .upper -> .len\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [indentContinuation])
    ).toEqual([]);
  });

  it('does not fire when the continuation is indented by a tab', () => {
    const source = '$x\n\t-> log\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [indentContinuation])
    ).toEqual([]);
  });
});

describe('with all spacing rules on', () => {
  it('emits zero diagnostics on a clean, idiomatically spaced script', () => {
    const source =
      '1 + 2\n"a" -> log\n5 => $x\nseq({ $x }) -> log\n$x[0]\n|x| { $x }\n"hello" -> .upper -> .len\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      spacingOperator,
      spacingBraces,
      spacingBrackets,
      spacingClosure,
      indentContinuation,
    ]);

    expect(result).toEqual([]);
  });
});
