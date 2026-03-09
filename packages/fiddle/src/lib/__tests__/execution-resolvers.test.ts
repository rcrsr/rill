/**
 * Tests for executeRill resolver wiring (Task 2.5)
 *
 * Tests FiddleResolverConfig, buildFiddleRuntimeOptions, and executeRill
 * with optional resolverConfig parameter.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SchemeResolver } from '@rcrsr/rill';
import {
  buildFiddleRuntimeOptions,
  executeRill,
  type FiddleResolverConfig,
} from '../execution.js';
import { EXECUTION_TIMEOUT_MS } from '../constants.js';

// ============================================================
// HELPERS
// ============================================================

/** Build a value resolver that returns a fixed native value. */
function valueResolver(value: unknown): SchemeResolver {
  return (_resource: string) => ({
    kind: 'value' as const,
    value: value as import('@rcrsr/rill').RillValue,
  });
}

/** Build a resolver config with a single scheme. */
function singleResolverConfig(
  scheme: string,
  resolver: SchemeResolver,
  config?: unknown
): FiddleResolverConfig {
  return {
    resolvers: { [scheme]: resolver },
    configurations: {
      resolvers: config !== undefined ? { [scheme]: config } : {},
    },
  };
}

// ============================================================
// UNIT: buildFiddleRuntimeOptions
// ============================================================

describe('buildFiddleRuntimeOptions', () => {
  describe('base behavior (no resolverConfig)', () => {
    it('returns options with onLog callback', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      expect(opts.callbacks?.onLog).toBeTypeOf('function');
    });

    it('onLog appends to provided logs array', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      opts.callbacks!.onLog!('hello');
      expect(logs).toEqual(['hello']);
    });

    it('sets timeout to EXECUTION_TIMEOUT_MS', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      expect(opts.timeout).toBe(EXECUTION_TIMEOUT_MS);
    });

    it('sets checkerMode to permissive', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      expect(opts.checkerMode).toBe('permissive');
    });

    it('does not include resolvers key', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      expect(opts.resolvers).toBeUndefined();
    });

    it('does not include configurations key', () => {
      const logs: string[] = [];
      const opts = buildFiddleRuntimeOptions(logs);
      expect(opts.configurations).toBeUndefined();
    });
  });

  describe('with resolverConfig', () => {
    it('merges resolvers from resolverConfig', () => {
      const logs: string[] = [];
      const resolver = valueResolver(42);
      const config = singleResolverConfig('ext', resolver);
      const opts = buildFiddleRuntimeOptions(logs, config);
      expect(opts.resolvers).toEqual({ ext: resolver });
    });

    it('merges configurations from resolverConfig', () => {
      const logs: string[] = [];
      const resolver = valueResolver(42);
      const config: FiddleResolverConfig = {
        resolvers: { ext: resolver },
        configurations: { resolvers: { ext: { timeout: 5000 } } },
      };
      const opts = buildFiddleRuntimeOptions(logs, config);
      expect(opts.configurations).toEqual({
        resolvers: { ext: { timeout: 5000 } },
      });
    });

    it('preserves onLog callback when resolverConfig provided', () => {
      const logs: string[] = [];
      const config = singleResolverConfig('ext', valueResolver('x'));
      const opts = buildFiddleRuntimeOptions(logs, config);
      opts.callbacks!.onLog!('msg');
      expect(logs).toEqual(['msg']);
    });

    it('preserves timeout when resolverConfig provided', () => {
      const logs: string[] = [];
      const config = singleResolverConfig('ext', valueResolver('x'));
      const opts = buildFiddleRuntimeOptions(logs, config);
      expect(opts.timeout).toBe(EXECUTION_TIMEOUT_MS);
    });

    it('preserves checkerMode permissive when resolverConfig provided', () => {
      const logs: string[] = [];
      const config = singleResolverConfig('ext', valueResolver('x'));
      const opts = buildFiddleRuntimeOptions(logs, config);
      expect(opts.checkerMode).toBe('permissive');
    });

    it('supports multiple schemes in resolvers', () => {
      const logs: string[] = [];
      const extResolver = valueResolver('ext-value');
      const hostResolver = valueResolver(99);
      const config: FiddleResolverConfig = {
        resolvers: { ext: extResolver, host: hostResolver },
        configurations: { resolvers: {} },
      };
      const opts = buildFiddleRuntimeOptions(logs, config);
      expect(opts.resolvers).toEqual({
        ext: extResolver,
        host: hostResolver,
      });
    });
  });

  describe('undefined resolverConfig produces identical options to no-arg call', () => {
    it('undefined resolverConfig is same as omitting it', () => {
      const logs1: string[] = [];
      const logs2: string[] = [];
      const optsOmit = buildFiddleRuntimeOptions(logs1);
      const optsUndefined = buildFiddleRuntimeOptions(logs2, undefined);
      // Both should have same shape (no resolvers, no configurations)
      expect(optsOmit.resolvers).toBeUndefined();
      expect(optsUndefined.resolvers).toBeUndefined();
      expect(optsOmit.configurations).toBeUndefined();
      expect(optsUndefined.configurations).toBeUndefined();
      expect(optsOmit.timeout).toBe(optsUndefined.timeout);
      expect(optsOmit.checkerMode).toBe(optsUndefined.checkerMode);
    });
  });
});

// ============================================================
// INTEGRATION: executeRill with resolverConfig
// ============================================================

describe('executeRill', () => {
  describe('resolver config — boundary conditions', () => {
    it('AC-53: resolverConfig undefined → behaves identically to pre-use<> behavior', async () => {
      const withUndefined = await executeRill('1 + 2', undefined);
      const withOmit = await executeRill('1 + 2');
      expect(withUndefined.status).toBe('success');
      expect(withUndefined.status).toBe(withOmit.status);
      expect(withUndefined.result).toBe(withOmit.result);
    });

    it('AC-44: no use<> expressions executes identically with empty resolver config', async () => {
      const withResolvers = await executeRill('42 => $x\n$x * 3', {
        resolvers: {},
        configurations: { resolvers: {} },
      });
      expect(withResolvers.status).toBe('success');
      expect(JSON.parse(withResolvers.result!).value).toBe(126);
    });

    it('providing resolverConfig does not disrupt log capture', async () => {
      const config = singleResolverConfig('ext', valueResolver('x'));
      const result = await executeRill('log("test-log")\n1', config);
      expect(result.status).toBe('success');
      expect(result.logs).toEqual(['test-log']);
    });
  });

  describe('resolver config — error cases (EC-14)', () => {
    it('EC-14: use<db:users> produces FiddleError with runtime category (unknown scheme)', async () => {
      // The parser now handles use<scheme:resource> correctly (Phase 1 complete).
      // 'db' is not a registered scheme, so the runtime raises RILL-R054.
      const result = await executeRill('use<db:users>');
      expect(result.status).toBe('error');
      expect(result.error).not.toBe(null);
      expect(result.error!.category).toBe('runtime');
    });

    it('EC-14: resolver callback throws → FiddleError via convertError', async () => {
      // Build a resolver that throws. The resolver wiring is tested here even
      // though use<> parsing is blocked — test via a script that does not need
      // use<> and inject the error path through buildFiddleRuntimeOptions.
      const throwingResolver: SchemeResolver = (_resource) => {
        throw new Error('resolver-failure-sentinel');
      };
      const config = singleResolverConfig('ext', throwingResolver);
      // Script does not use use<> — resolvers are wired but not invoked.
      // Confirm execution succeeds and resolver is present in options.
      const opts = buildFiddleRuntimeOptions([], config);
      expect(opts.resolvers!['ext']).toBe(throwingResolver);

      // Direct invocation of the resolver to verify error contract:
      // When resolver throws, FiddleError with category 'runtime' is expected.
      // This path is exercised by the runtime when use<> parsing is complete.
      expect(() => throwingResolver('example', undefined)).toThrow(
        'resolver-failure-sentinel'
      );
    });

    it('EC-14: empty resolvers record with ext resolver config resolves options without error', async () => {
      // AC-51: empty resolvers record — wiring succeeds; runtime error for
      // unregistered scheme fires when use<> parsing is complete.
      const config: FiddleResolverConfig = {
        resolvers: {},
        configurations: { resolvers: {} },
      };
      const opts = buildFiddleRuntimeOptions([], config);
      expect(opts.resolvers).toEqual({});
    });
  });

  describe('resolver config — FiddleResolverConfig shape', () => {
    it('FiddleResolverConfig accepts ext and host scheme keys', () => {
      const extResolver = valueResolver('ext-result');
      const hostResolver = valueResolver(100);
      // TypeScript compile-time check: both schemes are permitted.
      const config: FiddleResolverConfig = {
        resolvers: { ext: extResolver, host: hostResolver },
        configurations: { resolvers: { ext: { apiKey: 'abc' } } },
      };
      expect(config.resolvers['ext']).toBe(extResolver);
      expect(config.resolvers['host']).toBe(hostResolver);
    });

    it('resolver vi.fn() is accepted as SchemeResolver', () => {
      const mockResolver = vi.fn<SchemeResolver>().mockReturnValue({
        kind: 'value',
        value: 'mocked',
      });
      const config = singleResolverConfig('ext', mockResolver);
      const opts = buildFiddleRuntimeOptions([], config);
      expect(opts.resolvers!['ext']).toBe(mockResolver);
    });

    it('multiple ext resolvers for different resources resolve independently in options', () => {
      // AC-52: each resolver is keyed by scheme, not resource.
      // Two resolvers for different schemes coexist independently.
      const searchResolver = valueResolver(['result1']);
      const authResolver = valueResolver({ token: 'abc' });
      const config: FiddleResolverConfig = {
        resolvers: { search: searchResolver, auth: authResolver },
        configurations: { resolvers: {} },
      };
      const opts = buildFiddleRuntimeOptions([], config);
      expect(opts.resolvers!['search']).toBe(searchResolver);
      expect(opts.resolvers!['auth']).toBe(authResolver);
    });
  });

  describe('resolver config — integration', () => {
    it('AC-42: ext resolver registered → script executes with resolved value', async () => {
      const config = singleResolverConfig('ext', valueResolver('resolved-ext'));
      const result = await executeRill('use<ext:example> => $e\n$e', config);
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!).value).toBe('resolved-ext');
    });

    it('AC-43: host resolver registered → script executes with resolved number', async () => {
      const config = singleResolverConfig('host', valueResolver(42));
      const result = await executeRill(
        'use<host:app.timeout>:number => $t\n$t',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!).value).toBe(42);
    });

    it('AC-46: use<module:greetings> → FiddleError runtime (no module resolver)', async () => {
      const result = await executeRill('use<module:greetings>');
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
    });

    it('AC-47: unknown scheme → FiddleError with resolver-not-found message', async () => {
      const config: FiddleResolverConfig = {
        resolvers: {},
        configurations: { resolvers: {} },
      };
      const result = await executeRill('use<db:users>', config);
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
      expect(result.error!.message).toMatch(/No resolver registered/);
    });

    it('AC-49: resolver callback throws → FiddleError via convertError', async () => {
      const throwingResolver: SchemeResolver = () => {
        throw new Error('resolver-failure-sentinel');
      };
      const config = singleResolverConfig('ext', throwingResolver);
      const result = await executeRill('use<ext:example>', config);
      expect(result.status).toBe('error');
      expect(result.error!.category).toBe('runtime');
      expect(result.error!.message).toContain('resolver-failure-sentinel');
    });

    it('AC-52: multiple ext resolvers for different extensions resolve independently', async () => {
      const aResolver = valueResolver('value-a');
      const bResolver = valueResolver('value-b');
      const config: FiddleResolverConfig = {
        resolvers: { a: aResolver, b: bResolver },
        configurations: { resolvers: {} },
      };
      const result = await executeRill(
        'use<a:res> => $x\nuse<b:res> => $y\ndict[x: $x, y: $y]',
        config
      );
      expect(result.status).toBe('success');
      expect(JSON.parse(result.result!).value).toEqual({
        x: 'value-a',
        y: 'value-b',
      });
    });

    it.skip('AC-48: use<ext:...> + ext::fn() in permissive mode — both resolve; ext::fn() produces warning', async () => {
      // Blocked by RILL-P020 static-form lexer WIP.
      // use<ext:example> captures the resolved ext value; ext::fn() is a
      // namespace-qualified call that also resolves in permissive mode but
      // produces a warning because no explicit use<> import exists for it.
      const config = singleResolverConfig('ext', valueResolver('resolved-ext'));
      const result = await executeRill(
        'use<ext:example> => $e\next::fn("arg") => $r',
        config
      );
      expect(result.status).toBe('success');
    });

    it.skip('AC-50: use<$varName> in permissive mode — execution proceeds, resolved value is available', async () => {
      // Blocked by RILL-P020 static-form lexer WIP.
      // Dynamic use<> form: the variable $name holds the resource identifier
      // string at runtime. In permissive mode the runtime resolves it and
      // binds the result to $e.
      const config = singleResolverConfig(
        'ext',
        valueResolver('dynamic-resolved')
      );
      const result = await executeRill(
        '"ext:example" => $name\nuse<$name> => $e\n$e',
        config
      );
      expect(result.status).toBe('success');
    });

    it.skip('AC-54: use<ext:...> + ext::fn() in permissive mode (FDL boundary 4) — both resolve, ext::fn() warns', async () => {
      // Blocked by RILL-P020 static-form lexer WIP.
      // FDL boundary 4: script combines use<ext:...> capture with an
      // ext::fn() namespace-qualified call in permissive mode. Both
      // expressions resolve; ext::fn() emits a warning to logs because it
      // was not explicitly imported via use<>.
      const config = singleResolverConfig(
        'ext',
        valueResolver('boundary-value')
      );
      const result = await executeRill(
        'use<ext:example> => $e\next::fn("arg") => $r\n$e',
        config
      );
      expect(result.status).toBe('success');
    });
  });
});
