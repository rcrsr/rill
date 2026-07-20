import { describe, it, expect } from 'vitest';
import { parse, execute, createRuntimeContext } from '../../../src/index.js';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import {
  configFilterResolver,
  POLICY_KEY,
} from '../../../src/runtime/core/policy/resolve.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';
import { callable } from '../../../src/runtime/core/callable-factory.js';

function createTestContext(
  policyConfig: Record<string, unknown>,
  extensions: Record<string, RillValue>
) {
  const extMap = new Map(Object.entries(extensions));
  const resolved = resolvePolicy(policyConfig as any, extMap);

  return createRuntimeContext({
    filterResolver: configFilterResolver,
    hostContext: { [POLICY_KEY]: resolved },
    resolvers: {
      ext: {
        resolve: (resource: string) => {
          const ext = extMap.get(resource);
          if (!ext) throw new Error(`Extension not found: ${resource}`);
          return { kind: 'value' as const, value: ext };
        },
      },
    },
  });
}

describe('filter integration', () => {
  it('allows calls when access is "allow"', async () => {
    const kbExt: RillValue = {
      search: callable({
        fn: () => 'search result',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      { kb: { search: { access: 'allow' } } },
      { kb: kbExt }
    );

    const ast = parse('use<ext:kb> => $kb\n$kb.search');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('search result');
  });

  it('denies calls when access is "deny"', async () => {
    const kbExt: RillValue = {
      delete: callable({
        fn: () => 'deleted',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: kbExt }
    );

    const ast = parse('use<ext:kb> => $kb\n$kb.delete');
    await expect(execute(ast, ctx)).rejects.toThrow(/denied by policy/);
  });

  it('applies out() transform to return value', async () => {
    const kbExt: RillValue = {
      search: callable({
        fn: () => 'raw data',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const filterExt: RillValue = {
      sanitize: callable({
        fn: (args) => `clean(${args['0']})`,
        params: [
          {
            name: '0',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      { kb: { search: { access: 'allow', out: ['filter.sanitize'] } } },
      { kb: kbExt, filter: filterExt }
    );

    const ast = parse('use<ext:kb> => $kb\n$kb.search');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('clean(raw data)');
  });

  it('applies in() transform to pipe value', async () => {
    let receivedArg: RillValue;
    const llmExt: RillValue = {
      summarize: callable({
        fn: (args) => {
          receivedArg = args['0']!;
          return 'summary';
        },
        params: [
          {
            name: '0',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const filterExt: RillValue = {
      sanitize_for_prompt: callable({
        fn: (args) => `safe(${args['0']})`,
        params: [
          {
            name: '0',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      {
        llm: {
          summarize: {
            access: 'allow',
            in: ['filter.sanitize_for_prompt'],
          },
        },
      },
      { llm: llmExt, filter: filterExt }
    );

    const ast = parse(
      'use<ext:llm> => $llm\n"tainted input" -> $llm.summarize'
    );
    await execute(ast, ctx);
    expect(receivedArg!).toBe('safe(tainted input)');
  });

  it('wildcard denies unlisted methods', async () => {
    const kbExt: RillValue = {
      search: callable({
        fn: () => 'ok',
        params: [],
        returnType: { kind: 'string' },
      }),
      raw_query: callable({
        fn: () => 'leaked',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' }, search: { access: 'allow' } } },
      { kb: kbExt }
    );

    // search is allowed
    const ast1 = parse('use<ext:kb> => $kb\n$kb.search');
    const result1 = await execute(ast1, ctx);
    expect(result1.result).toBe('ok');

    // raw_query falls to wildcard deny
    const ast2 = parse('use<ext:kb> => $kb\n$kb.raw_query');
    await expect(execute(ast2, ctx)).rejects.toThrow(/denied by policy/);
  });

  it('no policy config means no filtering', async () => {
    const ctx = createRuntimeContext({});
    const ast = parse('"hello"');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('hello');
  });

  it('chains multiple out transforms sequentially', async () => {
    const kbExt: RillValue = {
      search: callable({
        fn: () => 'raw',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const filterExt: RillValue = {
      sanitize: callable({
        fn: (args) => `sanitized(${args['0']})`,
        params: [
          {
            name: '0',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: { kind: 'string' },
      }),
      redact: callable({
        fn: (args) => `redacted(${args['0']})`,
        params: [
          {
            name: '0',
            type: undefined,
            defaultValue: undefined,
            annotations: {},
          },
        ],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      {
        kb: {
          search: {
            access: 'allow',
            out: ['filter.sanitize', 'filter.redact'],
          },
        },
      },
      { kb: kbExt, filter: filterExt }
    );

    const ast = parse('use<ext:kb> => $kb\n$kb.search');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('redacted(sanitized(raw))');
  });

  it('allows unfiltered extensions when no rules exist for them', async () => {
    const cacheExt: RillValue = {
      get: callable({
        fn: () => 'cached',
        params: [],
        returnType: { kind: 'string' },
      }),
    } as unknown as RillValue;

    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } }, // rules only for kb
      { cache: cacheExt }
    );

    const ast = parse('use<ext:cache> => $cache\n$cache.get');
    const result = await execute(ast, ctx);
    expect(result.result).toBe('cached');
  });
});