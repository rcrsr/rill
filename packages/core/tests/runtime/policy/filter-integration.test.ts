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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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
        code: 'RILL_R088',
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

/**
 * A closure body runs in a context built by spreading the caller's rather
 * than by createChildContext, so it used to carry no policy binding and
 * every call inside one dispatched unfiltered. Since seq/fan/filter/fold
 * bodies and every user closure run through that path, wrapping a call in
 * `{ ... }` was a complete bypass.
 */
describe('filter integration: calls inside closure bodies', () => {
  it('denies a denied method called from a closure body', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\n|| ($kb.delete()) => $wrap\n$wrap()'),
          ctx
        ),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a denied method called from a seq body', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\nlist[1] -> seq({ $kb.delete() })'),
          ctx
        ),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a denied method called from a nested closure body', async () => {
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () =>
        execute(
          parse(
            'use<ext:kb> => $kb\n|| ($kb.delete()) => $inner\n|| ($inner()) => $outer\n$outer()'
          ),
          ctx
        ),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a denied method called from a stream closure body', async () => {
    // Stream closures build their context through the same helper, via
    // eval/invocation/stream-closures.ts.
    const ctx = createTestContext(
      { kb: { delete: { access: 'deny' } } },
      { kb: { delete: method('deleted') } as unknown as RillValue }
    );

    await expectHalt(
      () =>
        execute(
          parse(
            'use<ext:kb> => $kb\n|| { $kb.delete() -> yield\nreturn 1 }:stream(string):number => $sc\n$sc() => $s\n$s()'
          ),
          ctx
        ),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('applies transforms to a call made from a closure body', async () => {
    const ctx = createTestContext(
      {
        kb: { search: { access: 'allow', out: ['filter.redact'] } },
      },
      {
        kb: { search: method('raw') } as unknown as RillValue,
        filter: { redact: transform('redacted') } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n|| ($kb.search()) => $wrap\n$wrap()'),
      ctx
    );
    expect(result.result).toBe('redacted(raw)');
  });
});

/**
 * Branding walked dicts only, so a callable reached through a list index
 * carried no identity, and no identity resolves to pass-through. A
 * per-tenant client list is an ordinary extension shape, and it went
 * unpoliced under a rule that denied everything.
 */
describe('filter integration: list-nested and tuple-nested members', () => {
  it('denies a list-nested sub-client under a wildcard', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' } } },
      {
        kb: {
          clients: [{ purge: method('leaked') }],
        } as unknown as RillValue,
      }
    );

    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.clients[0].purge()'), ctx),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('matches an exact rule keyed on the indexed path', async () => {
    const ctx = createTestContext(
      {
        kb: {
          'clients[0].purge': { access: 'allow', out: ['filter.redact'] },
        },
      },
      {
        kb: {
          clients: [{ purge: method('raw') }],
        } as unknown as RillValue,
        filter: { redact: transform('redacted') } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.clients[0].purge()'),
      ctx
    );
    expect(result.result).toBe('redacted(raw)');
  });

  it('brands each list element separately', async () => {
    const ctx = createTestContext(
      {
        kb: {
          'clients[0].purge': { access: 'allow' },
          'clients[1].purge': { access: 'deny' },
        },
      },
      {
        kb: {
          clients: [{ purge: method('first') }, { purge: method('second') }],
        } as unknown as RillValue,
      }
    );

    const allowed = await execute(
      parse('use<ext:kb> => $kb\n$kb.clients[0].purge()'),
      ctx
    );
    expect(allowed.result).toBe('first');

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\n$kb.clients[1].purge()'),
          createTestContext(
            {
              kb: {
                'clients[0].purge': { access: 'allow' },
                'clients[1].purge': { access: 'deny' },
              },
            },
            {
              kb: {
                clients: [
                  { purge: method('first') },
                  { purge: method('second') },
                ],
              } as unknown as RillValue,
            }
          )
        ),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a tuple-nested sub-client under a wildcard', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' } } },
      {
        kb: {
          pair: {
            __rill_tuple: true,
            entries: [{ purge: method('leaked') }],
          },
        } as unknown as RillValue,
      }
    );

    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.pair[0].purge()'), ctx),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });

  it('denies a member nested below a list under a wildcard', async () => {
    const ctx = createTestContext(
      { kb: { '*': { access: 'deny' } } },
      {
        kb: {
          shards: [{ inner: { purge: method('leaked') } }],
        } as unknown as RillValue,
      }
    );

    await expectHalt(
      () =>
        execute(parse('use<ext:kb> => $kb\n$kb.shards[0].inner.purge()'), ctx),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });
});

/**
 * The walk visits a bounded number of members. A bound that quietly
 * stopped walking left everything past it unbranded, and unbranded means
 * unpoliced, so exhausting the budget halts instead.
 */
describe('filter integration: branding budget', () => {
  it('halts when an extension exceeds the branding budget', async () => {
    const wide: Record<string, RillValue> = {};
    for (let i = 0; i < 10_001; i++) {
      wide[`m${i}`] = method('ok');
    }

    const ctx = createTestContext({ kb: { '*': { access: 'deny' } } }, {
      kb: wide,
    } as unknown as Record<string, RillValue>);

    await expect(
      execute(parse('use<ext:kb> => $kb\n$kb.m0()'), ctx)
    ).rejects.toMatchObject({ errorId: 'RILL-R090' });
  });

  it('brands a deeply nested member the old depth bound would have skipped', async () => {
    // 24 levels down, past the depth-16 bound this budget replaced.
    let node: RillValue = { purge: method('leaked') } as unknown as RillValue;
    const path: string[] = ['purge'];
    for (let i = 0; i < 24; i++) {
      node = { [`n${i}`]: node } as unknown as RillValue;
      path.unshift(`n${i}`);
    }

    const ctx = createTestContext({ kb: { '*': { access: 'deny' } } }, {
      kb: node,
    } as unknown as Record<string, RillValue>);

    await expectHalt(
      () => execute(parse(`use<ext:kb> => $kb\n$kb.${path.join('.')}()`), ctx),
      {
        code: 'RILL_R088',
        messagePattern: /denied by policy/,
      }
    );
  });
});

/**
 * in() rewrites the first argument whether or not it arrived through a
 * pipe. Restricting it to piped calls would make dropping the pipe a
 * one-edit bypass of the sanitizer.
 */
describe('filter integration: in() argument position', () => {
  it('applies in() to an explicit first argument on a non-piped call', async () => {
    const sink: { received?: RillValue } = {};
    const ctx = createTestContext(
      { llm: { summarize: { access: 'allow', in: ['filter.sanitize'] } } },
      {
        llm: { summarize: recorder(sink) } as unknown as RillValue,
        filter: { sanitize: transform('safe') } as unknown as RillValue,
      }
    );

    await execute(
      parse('use<ext:llm> => $llm\n$llm.summarize("tainted input")'),
      ctx
    );
    expect(sink.received).toBe('safe(tainted input)');
  });

  it('leaves a zero-argument call alone', async () => {
    // There is no first argument to rewrite, and synthesizing one would
    // change the call's arity.
    const ctx = createTestContext(
      { kb: { search: { access: 'allow', in: ['filter.sanitize'] } } },
      {
        kb: { search: method('result') } as unknown as RillValue,
        filter: { sanitize: transform('safe') } as unknown as RillValue,
      }
    );

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.search()'),
      ctx
    );
    expect(result.result).toBe('result');
  });
});
