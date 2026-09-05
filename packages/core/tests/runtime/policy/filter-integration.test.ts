import { describe, it, expect } from 'vitest';
import { parse, execute, createRuntimeContext } from '../../../src/index.js';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import { createConfigFilterResolver } from '../../../src/runtime/core/policy/resolve.js';
import { extResolver } from '../../../src/runtime/core/resolvers.js';
import { toCallable } from '../../../src/runtime/core/callable.js';
import { anyTypeValue } from '../../../src/runtime/core/values.js';
import type { PolicyConfig } from '../../../src/runtime/core/policy/types.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';
import type { RillParam } from '../../../src/runtime/core/callable.js';
import { expectHalt } from '../../helpers/halt.js';

const ONE_ARG: RillParam[] = [
  { name: '0', type: undefined, defaultValue: undefined, annotations: {} },
];

/** Zero-argument method returning a fixed value. */
function method(result: string): RillValue {
  return toCallable({
    fn: () => result,
    params: [],
    returnType: anyTypeValue,
  }) as unknown as RillValue;
}

/** Single-argument transform tagging its input. */
function transform(tag: string): RillValue {
  return toCallable({
    fn: (args) => `${tag}(${String(args['0'])})`,
    params: ONE_ARG,
    returnType: anyTypeValue,
  }) as unknown as RillValue;
}

/** Single-argument method recording what reached it. */
function recorder(sink: { received?: RillValue }): RillValue {
  return toCallable({
    fn: (args) => {
      sink.received = args['0'] as RillValue;
      return 'summary';
    },
    params: ONE_ARG,
    returnType: anyTypeValue,
  }) as unknown as RillValue;
}

function createTestContext(
  policyConfig: PolicyConfig,
  extensions: Record<string, RillValue>
) {
  const resolved = resolvePolicy(
    policyConfig,
    new Map(Object.entries(extensions))
  );

  return createRuntimeContext({
    filterResolver: createConfigFilterResolver(resolved),
    resolvers: { ext: extResolver },
    configurations: { resolvers: { ext: extensions } },
  });
}

describe('filter integration', () => {
  it('allows calls when access is "allow"', async () => {
    const ctx = createTestContext(
      { kb: { search: { access: 'allow' } } },
      { kb: { search: method('search result') } as unknown as RillValue }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.search()'),
      ctx
    );
    expect(result.result).toBe('search result');
  });

  it('denies calls when access is "deny"', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.delete()'), ctx),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies regardless of the capture variable the script picks', async () => {
    // Policy keyed on the resolved path would read "$anything.delete",
    // miss every rule, and pass the call through. A one-line rename must
    // not defeat a deny rule.
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () => execute(parse('use<ext:kb> => $anything\n$anything.delete()'), ctx),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a rebound method reached through a second variable', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\n$kb.delete => $escaped\n$escaped()'),
          ctx
        ),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('applies out() transform to return value', async () => {
    const ctx = createTestContext(
      { kb: { search: { access: 'allow', out: ['filter.sanitize'] } } },
      {
        kb: { search: method('raw data') } as unknown as RillValue,
        filter: { sanitize: transform('clean') } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.search()'),
      ctx
    );
    expect(result.result).toBe('clean(raw data)');
  });

  it('applies in() transform to pipe value', async () => {
    const sink: { received?: RillValue } = {};
    const ctx = createTestContext(
      {
        llm: {
          summarize: { access: 'allow', in: ['filter.sanitize_for_prompt'] },
        },
      },
      {
        llm: { summarize: recorder(sink) } as unknown as RillValue,
        filter: {
          sanitize_for_prompt: transform('safe'),
        } as unknown as RillValue,
      }
    );

    await execute(
      parse('use<ext:llm> => $llm\n"tainted input" -> $llm.summarize'),
      ctx
    );
    expect(sink.received).toBe('safe(tainted input)');
  });

  it('chains multiple out transforms sequentially', async () => {
    const ctx = createTestContext(
      {
        kb: {
          search: {
            access: 'allow',
            out: ['filter.sanitize', 'filter.redact'],
          },
        },
      },
      {
        kb: { search: method('raw') } as unknown as RillValue,
        filter: {
          sanitize: transform('sanitized'),
          redact: transform('redacted'),
        } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.search()'),
      ctx
    );
    expect(result.result).toBe('redacted(sanitized(raw))');
  });

  it('wildcard denies unlisted methods', async () => {
    const extensions = {
      kb: {
        search: method('ok'),
        raw_query: method('leaked'),
      } as unknown as RillValue,
    };
    const config: PolicyConfig = {
      kb: { '*': { access: 'deny' }, search: { access: 'allow' } },
    };

    const allowed = await execute(
      parse('use<ext:kb> => $kb\n$kb.search()'),
      createTestContext(config, extensions)
    );
    expect(allowed.result).toBe('ok');

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\n$kb.raw_query()'),
          createTestContext(config, extensions)
        ),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('matches rules on nested sub-clients', async () => {
    // "$kb.client.search" must key on "client.search", not on "client".
    const ctx = createTestContext(
      {
        kb: {
          '*': { access: 'deny' },
          'client.search': { access: 'allow' },
        },
      },
      {
        kb: {
          client: {
            search: method('nested ok'),
            purge: method('nested leaked'),
          },
        } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.client.search()'),
      ctx
    );
    expect(result.result).toBe('nested ok');
  });

  it('denies an unlisted nested method under a wildcard', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' }, 'client.search': { access: 'allow' } } },
      {
        kb: {
          client: { search: method('ok'), purge: method('leaked') },
        } as unknown as RillValue,
      }
    );

    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.client.purge()'), ctx),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('applies rules to a member mounted directly by resource path', async () => {
    // use<ext:kb.client> resolves below the extension root; the brand must
    // still place its members under "client.*".
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' }, 'client.search': { access: 'allow' } } },
      {
        kb: {
          client: { search: method('ok'), purge: method('leaked') },
        } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb.client> => $c\n$c.search()'),
      ctx
    );
    expect(result.result).toBe('ok');

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb.client> => $c\n$c.purge()'),
          createTestContext(
            {
              kb: {
                '*': { access: 'deny' },
                'client.search': { access: 'allow' },
              },
            },
            {
              kb: {
                client: { search: method('ok'), purge: method('leaked') },
              } as unknown as RillValue,
            }
          )
        ),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a policed extension whose root is itself a callable', async () => {
    // No per-method rule can name it, so the shape fails closed.
    const ctx = createTestContext(
      { greet: { '*': { access: 'allow' } } },
      { greet: method('hi') }
    );

    await expectHalt(
      () => execute(parse('use<ext:greet> => $greet\n$greet()'), ctx),
      {
        code: 'RILL_R086',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('no policy config means no filtering', async () => {
    const ctx = createRuntimeContext({});
    const result = await execute(parse('"hello"'), ctx);
    expect(result.result).toBe('hello');
  });

  it('allows unfiltered extensions when no rules exist for them', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { cache: { get: method('cached') } as unknown as RillValue }
    );

    const result = await execute(
      parse('use<ext:cache> => $cache\n$cache.get()'),
      ctx
    );
    expect(result.result).toBe('cached');
  });

  it('leaves built-ins and script closures unpoliced', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' } } },
      { kb: { search: method('ok') } as unknown as RillValue }
    );

    const result = await execute(
      parse('|x| ($x -> .upper) => $shout\n"hi" -> $shout'),
      ctx
    );
    expect(result.result).toBe('HI');
  });

  it('does not filter when the host configures no resolver', async () => {
    const ctx = createRuntimeContext({
      resolvers: { ext: extResolver },
      configurations: {
        resolvers: {
          ext: { kb: { delete: method('deleted') } as unknown as RillValue },
        },
      },
    });

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.delete()'),
      ctx
    );
    expect(result.result).toBe('deleted');
  });

  it('keeps the resolver off the runtime context', async () => {
    // Host functions are handed the context. A resolver reachable there
    // is a resolver an extension can read or replace mid-run.
    const ctx = createTestContext(
      { kb: { search: { access: 'allow' } } },
      { kb: { search: method('ok') } as unknown as RillValue }
    );

    expect(Object.keys(ctx)).not.toContain('filterResolver');
    expect((ctx as unknown as Record<string, unknown>)['filterResolver']).toBe(
      undefined
    );
    expect(ctx.hostContext).toEqual({});
  });

  it('recovers a denied call with guard', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    const result = await execute(
      parse(
        'use<ext:kb> => $kb\nguard { $kb.delete() } => $r\n$r.! ? "blocked" ! "ran"'
      ),
      ctx
    );
    expect(result.result).toBe('blocked');
  });
});
