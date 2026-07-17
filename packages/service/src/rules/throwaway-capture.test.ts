import { describe, expect, it } from 'vitest';
import { parse } from '@rcrsr/rill';
import type { ParseResult } from '@rcrsr/rill';
import { runRules } from './run-rules.js';
import { createDefaultConfig } from './config.js';
import type { CheckConfig } from './types.js';
import { throwawayCapture } from './throwaway-capture.js';

/** Wraps a well-formed AST built with `parse` in a `ParseResult` shape. */
function toParseResult(source: string): ParseResult {
  return { ast: parse(source), errors: [], success: true };
}

/** Minimal CheckConfig with every rule 'on' and no global override. */
function makeConfig(overrides: Partial<CheckConfig> = {}): CheckConfig {
  return { rules: {}, ...overrides };
}

describe('THROWAWAY_CAPTURE', () => {
  describe('fires', () => {
    it('fires on a capture that is never referenced', () => {
      const source = '"hello" => $greeting\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        code: 'THROWAWAY_CAPTURE',
        location: { line: 1 },
      });
    });

    it('fires on both bindings of a reassigned, never-referenced variable', () => {
      const source = '1 => $x\n2 => $x\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        code: 'THROWAWAY_CAPTURE',
        location: { line: 1 },
      });
      expect(result[1]).toMatchObject({
        code: 'THROWAWAY_CAPTURE',
        location: { line: 2 },
      });
    });

    it('fires on a capture whose single reference is not the immediately-following statement', () => {
      const source = '1 => $x\nlog("a")\n$x -> log\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        code: 'THROWAWAY_CAPTURE',
        location: { line: 1 },
      });
    });
  });

  describe('stays silent', () => {
    it('on a capture immediately chained into the next statement', () => {
      const source = '"hello" => $greeting\n$greeting -> .upper\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('on a name read and written inside an isolated collection-op body', () => {
      const source =
        '0 => $count\n[1, 2, 3] -> seq({ $count + $ => $count })\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('on a top-level capture shadowed by a closure param used inside the closure body', () => {
      const source = '1 => $x\n|x|($x * 2) => $double\n$double(1)\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('on a top-level capture shadowed by a grouped-expression capture', () => {
      const source = '1 => $x\n("a" => $x)\n$x -> log\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('on a capture referenced two or more times', () => {
      const source = '1 => $x\n$x -> log\n$x -> log\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('on a capture whose single use is the immediately-following AnnotatedStatement', () => {
      // The reference sits inside the very next statement, same as the
      // plain-Statement adjacency case above - it just happens to carry an
      // annotation prefix. Adjacency must see through the wrapper.
      const source = '10 => $n\n^(limit: $n) "hello"\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });
  });

  describe('through the full rule set', () => {
    it('fires THROWAWAY_CAPTURE via runRules on a dead capture, driven through the default registry', () => {
      const source = '"hello" => $greeting\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, createDefaultConfig());
      const throwawayHits = result.filter(
        (diagnostic) => diagnostic.code === 'THROWAWAY_CAPTURE'
      );

      expect(throwawayHits).toHaveLength(1);
      expect(throwawayHits[0]?.location.line).toBe(1);
    });

    it('stays silent when the single use sits inside the next statement rather than at its head', () => {
      // The use is on the very next line, so it is not "away from its
      // capture" even though it is not the head-primary. Adjacency is
      // statement membership, not head position.
      const source = '#AB0x => $x\nguard { $x.field }\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, makeConfig(), [throwawayCapture]);

      expect(result).toEqual([]);
    });

    it('leaves an adjacent-head capture to CAPTURE_INLINE_CHAIN without double-reporting', () => {
      // THROWAWAY_CAPTURE covers only the complement of CAPTURE_INLINE_CHAIN.
      // Both rules must agree on which capture is adjacent-head, so one
      // capture never draws two diagnostics. A single-rule run cannot
      // observe this; it needs the whole registry.
      const source = '"hello" => $greeting\n$greeting -> .upper\n';
      const parsed = toParseResult(source);

      const result = runRules(parsed, source, createDefaultConfig());

      expect(result.map((diagnostic) => diagnostic.code)).toEqual([
        'CAPTURE_INLINE_CHAIN',
      ]);
      expect(result[0]?.location.line).toBe(1);
    });
  });
});
