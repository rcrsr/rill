import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { namingSnakeCase } from './naming.js';
import { loopAccumulator, preferDoWhile, useEach } from './loops.js';
import { unnecessaryAssertion } from './types-assertion.js';
import { streamPreIteration } from './stream-pre-iteration.js';
import { useDynamicIdentifier, useUntypedHostRef } from './use-expressions.js';
import { guardBare, retryTrivial } from './guard-retry.js';
import { atomUnregistered } from './atom-unregistered.js';
import { statusProbeNoField } from './status-probe-no-field.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('NAMING_SNAKE_CASE', () => {
  it('fires on a camelCase captured variable', () => {
    const source = '5 => $userName\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [namingSnakeCase]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'NAMING_SNAKE_CASE',
      severity: 'error',
      message:
        "Captured variable 'userName' should use snake_case (e.g., 'user_name')",
    });
    expect(result[0]?.fix).toMatchObject({
      description: "Rename 'userName' to 'user_name'",
      applicable: true,
    });
  });

  it('fires on a camelCase dict key with the foreign-key hint', () => {
    const source = 'dict[userName: "Alice"]\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [namingSnakeCase]);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      "Dict key 'userName' should use snake_case (e.g., 'user_name'). For foreign API keys you don't own, use the quoted-key form: [\"userName\": ...]"
    );
  });

  it('does not fire on a snake_case captured variable', () => {
    const source = '5 => $user_name\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [namingSnakeCase])).toEqual(
      []
    );
  });

  it('does not fire on a quoted-string dict key', () => {
    const source = 'dict["userName": "Alice"]\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [namingSnakeCase])).toEqual(
      []
    );
  });
});

describe('LOOP_ACCUMULATOR', () => {
  it('fires when a loop-body capture is referenced in the condition', () => {
    const source = 'while ($x < 5) do { $ => $x\n$x + 1 }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [loopAccumulator]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'LOOP_ACCUMULATOR',
      severity: 'info',
      message:
        '$x captured in loop body but referenced in condition; loop body variables reset each iteration',
      fix: null,
    });
  });

  it('does not fire when the accumulator ($) is used instead', () => {
    const source = 'while ($ < 5) do { $ + 1 }\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [loopAccumulator])).toEqual(
      []
    );
  });
});

describe('PREFER_DO_WHILE', () => {
  it('fires when a while-loop body opens with a host/closure call', () => {
    const source = 'while ($x < 5) do { attempt_operation() }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [preferDoWhile]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'PREFER_DO_WHILE',
      severity: 'info',
      message:
        'Consider do-while for retry patterns where body runs at least once: do { body } while (condition)',
      fix: null,
    });
  });

  it('does not fire for a while-loop body starting with a literal', () => {
    const source = 'while ($x < 5) do { $x + 1 }\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [preferDoWhile])).toEqual([]);
  });
});

describe('USE_EACH', () => {
  it('fires when the condition checks .len', () => {
    const source = 'while ($i < $items.len) do { $i + 1 }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [useEach]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_EACH',
      severity: 'info',
      message:
        "Use 'seq' for collection iteration instead of while loops: collection -> seq({ body })",
      fix: null,
    });
  });

  it('does not fire for a plain counter loop', () => {
    const source = 'while ($x < 5) do { $x + 1 }\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [useEach])).toEqual([]);
  });
});

describe('UNNECESSARY_ASSERTION', () => {
  it('fires on a number literal asserted as its own type', () => {
    const source = '5:number\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      unnecessaryAssertion,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'UNNECESSARY_ASSERTION',
      severity: 'info',
      message: 'Type assertion on number literal is unnecessary',
    });
    expect(result[0]?.fix).toMatchObject({
      description: 'Remove unnecessary type assertion',
      applicable: true,
      replacement: '',
    });
  });

  it('does not fire when the asserted type differs from the literal', () => {
    const source = '5:string\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [unnecessaryAssertion])
    ).toEqual([]);
  });
});

describe('STREAM_PRE_ITERATION', () => {
  it('fires when a stream is invoked before it is iterated', () => {
    const source = '|| yield :stream() => $s\n$s()\n$s -> seq({ log($) })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [streamPreIteration]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'STREAM_PRE_ITERATION',
      severity: 'warning',
      fix: null,
    });
    expect(result[0]?.message).toMatch(
      /^Stream invoked before iteration; chunks consumed internally\. '\$s' at line \d+$/
    );
  });

  it('does not fire when the stream is iterated before it is invoked', () => {
    const source = '|| yield :stream() => $s\n$s -> seq({ log($) })\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [streamPreIteration])
    ).toEqual([]);
  });
});

describe('USE_DYNAMIC_IDENTIFIER', () => {
  it('fires as error under strict checkerMode for a variable-form use<>', () => {
    const source = '"scheme:res" => $mod\nuse<$mod>\n';
    const parsed = toParseResult(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'strict' }),
      [useDynamicIdentifier]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_DYNAMIC_IDENTIFIER',
      severity: 'error',
      message:
        'Dynamic use<> identifier (use<$mod>) is not recommended in strict mode; prefer static use<scheme:resource>',
      fix: null,
    });
  });

  it('fires as warning under permissive checkerMode for a variable-form use<>', () => {
    const source = '"scheme:res" => $mod\nuse<$mod>\n';
    const parsed = toParseResult(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'permissive' }),
      [useDynamicIdentifier]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_DYNAMIC_IDENTIFIER',
      severity: 'warning',
      message:
        'Dynamic use<> identifier (use<$mod>) is not recommended in permissive mode; prefer static use<scheme:resource>',
    });
  });

  it('does not fire for a static-form use<>', () => {
    const source = 'use<scheme:resource>\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [useDynamicIdentifier])
    ).toEqual([]);
  });
});

describe('USE_UNTYPED_HOST_REF', () => {
  it('fires as error under strict checkerMode for an untyped host reference', () => {
    const source = 'use<host:my_fn>\n';
    const parsed = toParseResult(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'strict' }),
      [useUntypedHostRef]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_UNTYPED_HOST_REF',
      severity: 'error',
      message:
        'use<host:my_fn> has no :type annotation in strict mode; add :TypeName to declare the resolved type',
      fix: null,
    });
  });

  it('fires as warning under permissive checkerMode for an untyped host reference', () => {
    const source = 'use<host:my_fn>\n';
    const parsed = toParseResult(source);

    const result = runRules(
      parsed,
      source,
      makeConfig({ checkerMode: 'permissive' }),
      [useUntypedHostRef]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'USE_UNTYPED_HOST_REF',
      severity: 'warning',
    });
  });

  it('does not fire when the host reference has a :type annotation', () => {
    const source = 'use<host:my_fn>:string\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [useUntypedHostRef])).toEqual(
      []
    );
  });
});

describe('GUARD_BARE', () => {
  it('fires on a guard block with no on-codes', () => {
    const source = 'guard { fetch_data() }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [guardBare]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'GUARD_BARE',
      severity: 'info',
      message:
        'Bare guard catches every error. Prefer guard<on: list[#X, ...]> to make recoverability explicit.',
      fix: null,
    });
  });

  it('does not fire when the guard declares on-codes', () => {
    const source = 'guard<on: list[#TIMEOUT]> { fetch_data() }\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [guardBare])).toEqual([]);
  });
});

describe('RETRY_TRIVIAL', () => {
  it('fires when retry<limit: 1> has no effect', () => {
    const source = 'retry<limit: 1> { fetch_data() }\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [retryTrivial]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'RETRY_TRIVIAL',
      severity: 'warning',
      message:
        'retry<limit: 1> has no effect; remove the wrapper or raise the attempt count.',
      fix: null,
    });
  });

  it('does not fire when the attempt count is greater than 1', () => {
    const source = 'retry<limit: 3> { fetch_data() }\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [retryTrivial])).toEqual([]);
  });
});

describe('ATOM_UNREGISTERED', () => {
  it('fires on an atom not in the builtin set', () => {
    const source = '#CUSTOM_CODE\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [atomUnregistered]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'ATOM_UNREGISTERED',
      severity: 'warning',
      message:
        'Atom #CUSTOM_CODE is not a runtime builtin; ensure the host registers it via registerErrorCode.',
      fix: null,
    });
  });

  it('does not fire for a builtin atom', () => {
    const source = '#TIMEOUT\n';
    const parsed = toParseResult(source);

    expect(runRules(parsed, source, makeConfig(), [atomUnregistered])).toEqual(
      []
    );
  });
});

describe('STATUS_PROBE_NO_FIELD', () => {
  it('fires on a bare .! probe', () => {
    const source = '$x.!\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [statusProbeNoField]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'STATUS_PROBE_NO_FIELD',
      severity: 'info',
      message:
        'Bare .! returns the whole status record. Project a field with .!code, .!message, or .!provider.',
      fix: null,
    });
  });

  it('does not fire when a field is projected', () => {
    const source = '$x.!code\n';
    const parsed = toParseResult(source);

    expect(
      runRules(parsed, source, makeConfig(), [statusProbeNoField])
    ).toEqual([]);
  });
});

describe('with all rules from this task on', () => {
  it('emits zero diagnostics on a clean, idiomatic script', () => {
    const source =
      '5 => $user_name\n' +
      'dict[user_name: "Alice"]\n' +
      'while ($ < 5) do { $ + 1 }\n' +
      'use<scheme:resource>\n' +
      'use<host:my_fn>:string\n' +
      'guard<on: list[#TIMEOUT]> { fetch_data() }\n' +
      'retry<limit: 3> { fetch_data() }\n' +
      '#TIMEOUT\n' +
      '$x.!code\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      namingSnakeCase,
      loopAccumulator,
      preferDoWhile,
      useEach,
      unnecessaryAssertion,
      streamPreIteration,
      useDynamicIdentifier,
      useUntypedHostRef,
      guardBare,
      retryTrivial,
      atomUnregistered,
      statusProbeNoField,
    ]);

    expect(result).toEqual([]);
  });
});
