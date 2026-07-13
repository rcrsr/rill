import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { implicitDollarMethod } from './implicit-dollar-method.js';
import { implicitDollarFunction } from './implicit-dollar-function.js';
import { implicitDollarClosure } from './implicit-dollar-closure.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('IMPLICIT_DOLLAR_METHOD', () => {
  it('fires on an explicit $.method() call', () => {
    const source = '$.upper()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarMethod,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'IMPLICIT_DOLLAR_METHOD',
      severity: 'info',
      message: "Prefer implicit '.upper' over explicit '$.upper()'",
      fix: null,
    });
  });

  it('does not fire on a named-variable receiver', () => {
    const source = '$var.upper()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarMethod,
    ]);

    expect(result).toEqual([]);
  });
});

describe('IMPLICIT_DOLLAR_FUNCTION', () => {
  it('fires on a single bare-$ argument to a host call', () => {
    const source = 'log($)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarFunction,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'IMPLICIT_DOLLAR_FUNCTION',
      severity: 'info',
      message: "Prefer pipe syntax '-> log' over explicit 'log($)'",
      fix: null,
    });
  });

  it('does not fire when the argument is not a bare $', () => {
    const source = 'log("hi")\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarFunction,
    ]);

    expect(result).toEqual([]);
  });
});

describe('IMPLICIT_DOLLAR_CLOSURE', () => {
  it('fires on a single bare-$ argument to a closure call', () => {
    const source = '$myclosure($)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarClosure,
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'IMPLICIT_DOLLAR_CLOSURE',
      severity: 'info',
      message:
        "Prefer pipe syntax '-> $myclosure' over explicit '$myclosure($)'",
      fix: null,
    });
  });

  it('does not fire when the argument is not a bare $', () => {
    const source = '$myclosure($x)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarClosure,
    ]);

    expect(result).toEqual([]);
  });
});

describe('with all implicit-dollar rules on', () => {
  it('returns no findings for a clean script', () => {
    const source = '$var.upper()\nlog("hi")\n$myclosure($x)\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      implicitDollarMethod,
      implicitDollarFunction,
      implicitDollarClosure,
    ]);

    expect(result).toEqual([]);
  });
});
