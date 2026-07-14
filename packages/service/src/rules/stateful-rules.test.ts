import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import type { CheckConfig } from './types.js';
import { avoidReassignment } from './avoid-reassignment.js';
import { loopOuterCapture } from './loop-outer-capture.js';
import { validateExternal } from './validate-external.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('AVOID_REASSIGNMENT', () => {
  it('fires when a variable is captured twice in the same scope', () => {
    const source = '1 => $a\n2 => $a\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [avoidReassignment]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'AVOID_REASSIGNMENT',
      severity: 'warning',
      message:
        "Variable reassignment detected: '$a' first defined at line 1. Prefer new variable or functional style.",
      fix: null,
    });
    expect(result[0]?.location).toEqual({ line: 2, column: 6, offset: 13 });
  });

  it('does not fire on a clean script with no reassignment', () => {
    const source = '1 => $a\n2 => $b\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [avoidReassignment]);

    expect(result).toEqual([]);
  });
});

describe('LOOP_OUTER_CAPTURE', () => {
  it('fires when a loop body captures an outer-scope variable', () => {
    const source = '0 => $count\n[1, 2, 3] -> seq({ $count + 1 => $count })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [loopOuterCapture]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'LOOP_OUTER_CAPTURE',
      severity: 'warning',
      message:
        "Cannot modify outer variable '$count' from inside loop. " +
        'Captures inside loops create LOCAL variables. ' +
        'Use fold(init) with $@ accumulator, or pack state into $ as a dict. ' +
        "(Outer '$count' defined at line 1)",
      fix: null,
    });
  });

  it('does not fire on a clean script with no loop capture', () => {
    const source = '[1, 2, 3] -> fold(0, { $@ + 1 })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [loopOuterCapture]);

    expect(result).toEqual([]);
  });

  it('does not fire when the captured variable is local to the loop', () => {
    const source = '[1, 2, 3] -> seq({ $ + 1 => $local })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [loopOuterCapture]);

    expect(result).toEqual([]);
  });
});

describe('with all stateful rules on', () => {
  it('fires AVOID_REASSIGNMENT and LOOP_OUTER_CAPTURE on a violating script', () => {
    const source =
      '1 => $a\n2 => $a\n0 => $count\n[1, 2, 3] -> seq({ $count + 1 => $count })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      avoidReassignment,
      loopOuterCapture,
    ]);

    const codes = result.map((d) => d.code).sort();
    expect(codes).toEqual([
      'AVOID_REASSIGNMENT',
      'AVOID_REASSIGNMENT',
      'LOOP_OUTER_CAPTURE',
    ]);
    expect(codes).toContain('AVOID_REASSIGNMENT');
    expect(codes).toContain('LOOP_OUTER_CAPTURE');
  });

  it('returns no findings for a clean script', () => {
    const source = '1 => $a\n2 => $b\n[1, 2, 3] -> fold(0, { $@ + 1 })\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [
      avoidReassignment,
      loopOuterCapture,
    ]);

    expect(result).toEqual([]);
  });
});

describe('VALIDATE_EXTERNAL', () => {
  it('fires on a non-asserted fetch/read/load HostCall', () => {
    const source = 'fetch_data()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      code: 'VALIDATE_EXTERNAL',
      severity: 'info',
      message:
        'Consider validating external input with type assertion: fetch_data():type',
      fix: null,
    });
  });

  it('does not fire when the call is wrapped in a type assertion', () => {
    const source = 'fetch_data():dict\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toEqual([]);
  });

  it('does not fire for namespaced host calls', () => {
    const source = 'ns::fetch_data()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toEqual([]);
  });

  it('does not fire for HostCall names without fetch/read/load', () => {
    const source = 'compute_total()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toEqual([]);
  });

  it('does not fire for names with no I/O verb in the leading or trailing segment', () => {
    const source = 'thread_pool()\ndownload()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toEqual([]);
  });

  it('fires on noun_verb host-call names (verb in the trailing segment)', () => {
    const source = 'api_fetch()\nhttp_get()\ndb_query()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result.map((d) => d.message)).toEqual([
      'Consider validating external input with type assertion: api_fetch():type',
      'Consider validating external input with type assertion: http_get():type',
      'Consider validating external input with type assertion: db_query():type',
    ]);
  });

  it('fires on query/open/post verb_noun names not previously recognized', () => {
    const source = 'query_db()\nopen_socket()\npost_data()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result.map((d) => d.message)).toEqual([
      'Consider validating external input with type assertion: query_db():type',
      'Consider validating external input with type assertion: open_socket():type',
      'Consider validating external input with type assertion: post_data():type',
    ]);
  });

  it('KNOWN LIMITATION: fires on already_read despite reading as a completed-state check', () => {
    // already_read's trailing segment is the verb "read" - the same shape
    // as genuine noun_verb I/O calls like db_query/http_get, which must
    // fire. A purely lexical, position-based rule cannot tell these two
    // shapes apart; see the KNOWN LIMITATION comment on
    // EXTERNAL_IO_VERBS in validate-external.ts.
    const source = 'already_read()\n';
    const parsed = toParseResult(source);

    const result = runRules(parsed, source, makeConfig(), [validateExternal]);

    expect(result).toHaveLength(1);
    expect(result[0]?.message).toBe(
      'Consider validating external input with type assertion: already_read():type'
    );
  });
});
