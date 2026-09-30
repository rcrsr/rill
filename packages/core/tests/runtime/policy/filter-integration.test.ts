import { describe, it, expect } from 'vitest';
import {
  parse,
  execute,
  createRuntimeContext,
  RuntimeError,
  RuntimeHaltSignal,
} from '../../../src/index.js';
import { getStatus } from '../../../src/runtime/core/types/status.js';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import { createConfigFilterResolver } from '../../../src/runtime/core/policy/resolve.js';
import { extResolver } from '../../../src/runtime/core/resolvers.js';
import { toCallable } from '../../../src/runtime/core/callable.js';
import { setTypedKey } from '../../../src/runtime/core/types/dict-keys.js';
import { anyTypeValue } from '../../../src/runtime/core/values.js';
import type { FilterResolver } from '../../../src/index.js';
import type { PolicyConfig } from '../../../src/runtime/core/policy/types.js';
import type { RillValue } from '../../../src/runtime/core/types/structures.js';
import type { RillParam } from '../../../src/runtime/core/callable.js';
import { expectHalt } from '../../helpers/halt.js';
import {
  createConfigFilterResolver as publicCreateResolver,
  createRillStream,
  createVector,
  getExtensionIdentity,
  resolvePolicy as publicResolvePolicy,
  toCallable as publicToCallable,
} from '../../../src/index.js';

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

    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.m0()'), ctx),
      {
        code: 'RILL_R090',
        messagePattern: /exceeds 10000 members/,
      }
    );
  });

  it('locates the use<> that blew the budget', async () => {
    const wide: Record<string, RillValue> = {};
    for (let i = 0; i < 10_001; i++) {
      wide[`m${i}`] = method('ok');
    }

    const ctx = createTestContext({ kb: { '*': { access: 'deny' } } }, {
      kb: wide,
    } as unknown as Record<string, RillValue>);

    // Every sibling failure in evaluateUseExpr carries the import's
    // location. A host cannot act on "some extension is too large".
    let caught: unknown;
    try {
      await execute(parse('log("first")\nuse<ext:kb> => $kb'), ctx);
    } catch (e) {
      caught = e;
    }
    const invalid =
      caught instanceof RuntimeHaltSignal
        ? caught.value
        : (caught as RuntimeError).haltValue!;
    const frame = getStatus(invalid).trace[0];
    // The use<> is on line 2, not line 1.
    expect(frame?.site).toMatch(/:2:\d+$/);
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

describe('filter integration: callables returned at call time', () => {
  const noArgs = { params: [], returnType: anyTypeValue } as const;

  /** Zero-argument method computing its result on each call. */
  function producer(make: () => RillValue): RillValue {
    return publicToCallable({
      fn: make,
      ...noArgs,
    }) as unknown as RillValue;
  }

  /** One-argument method returning its argument unchanged. */
  function echo(): RillValue {
    return publicToCallable({
      fn: (args) => args['0'] as RillValue,
      params: ONE_ARG,
      returnType: anyTypeValue,
    }) as unknown as RillValue;
  }

  function buildContext(
    config: PolicyConfig,
    extensions: Record<string, RillValue>,
    extra: Record<string, unknown> = {}
  ) {
    const resolved = publicResolvePolicy(
      config,
      new Map(Object.entries(extensions))
    );
    return createRuntimeContext({
      filterResolver: publicCreateResolver(resolved),
      resolvers: { ext: extResolver },
      configurations: { resolvers: { ext: extensions } },
      ...extra,
    });
  }

  function subClient(): RillValue {
    return {
      search: method('found'),
      purge: method('purged'),
    } as unknown as RillValue;
  }

  it('denies a member of a returned sub-client and honors an exact allow', async () => {
    const extensions = { kb: { client: producer(subClient) } };
    const denied = buildContext(
      { kb: { '*': { access: 'deny' }, client: { access: 'allow' } } },
      extensions as unknown as Record<string, RillValue>
    );
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.client().purge()'), denied),
      { code: 'RILL_R088', messagePattern: /denied by policy/ }
    );

    const recovered = await execute(
      parse(
        'use<ext:kb> => $kb\nguard { $kb.client().purge() } => $r\n$r.! ? "blocked" ! "ran"'
      ),
      denied
    );
    expect(recovered.result).toBe('blocked');

    const allowed = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          client: { access: 'allow' },
          'client().search': { access: 'allow' },
        },
      },
      extensions as unknown as Record<string, RillValue>
    );
    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.client().search()'),
      allowed
    );
    expect(result.result).toBe('found');
  });

  it('polices a bare returned callable by its method() path', async () => {
    const extensions = {
      kb: { make: producer(() => method('made')) },
    } as unknown as Record<string, RillValue>;
    const script = 'use<ext:kb> => $kb\n$kb.make() => $f\n$f()';

    const denied = buildContext(
      { kb: { '*': { access: 'deny' }, make: { access: 'allow' } } },
      extensions
    );
    await expectHalt(() => execute(parse(script), denied), {
      code: 'RILL_R088',
    });

    const allowed = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          make: { access: 'allow' },
          'make()': { access: 'allow' },
        },
      },
      extensions
    );
    const result = await execute(parse(script), allowed);
    expect(result.result).toBe('made');
  });

  it('propagates identity even when the calling method has a null filter', async () => {
    const ctx = buildContext({ kb: { 'client().purge': { access: 'deny' } } }, {
      kb: { client: producer(subClient) },
    } as unknown as Record<string, RillValue>);
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.client().purge()'), ctx),
      { code: 'RILL_R088' }
    );
  });

  it('leaves an unpoliced extension pass-through', async () => {
    const ctx = buildContext({ other: { '*': { access: 'deny' } } }, {
      kb: { client: producer(subClient) },
      other: { run: method('x') },
    } as unknown as Record<string, RillValue>);
    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.client().purge()'),
      ctx
    );
    expect(result.result).toBe('purged');
  });

  it('brands callables inside out() output', async () => {
    const wrap = publicToCallable({
      fn: (args) =>
        ({
          value: args['0'] as RillValue,
          purge: method('purged'),
        }) as unknown as RillValue,
      params: ONE_ARG,
      returnType: anyTypeValue,
    }) as unknown as RillValue;
    const ctx = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          client: { access: 'allow', out: ['filter.wrap'] },
        },
      },
      {
        kb: { client: producer(() => 'raw') },
        filter: { wrap },
      } as unknown as Record<string, RillValue>
    );
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.client().purge()'), ctx),
      { code: 'RILL_R088' }
    );
  });

  it('keeps the first brand when a method returns an already branded callable', async () => {
    const search = method('found');
    const shared = { search } as unknown as RillValue;
    const ctx = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          search: { access: 'allow' },
          get_search: { access: 'allow' },
        },
      },
      {
        kb: { search: search, get_search: producer(() => shared) },
      } as unknown as Record<string, RillValue>
    );
    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.get_search().search()'),
      ctx
    );
    expect(result.result).toBe('found');
  });

  it('lets a use<> brand win over an earlier call-time brand', async () => {
    const purge = method('purged');
    const shared = { purge } as unknown as RillValue;
    const ctx = buildContext(
      {
        kb: { get: { access: 'allow' } },
        x: { '*': { access: 'deny' } },
      },
      {
        kb: { get: producer(() => shared) },
        x: shared,
      } as unknown as Record<string, RillValue>
    );

    // The same callable instance first receives a call-time brand.
    await execute(parse('use<ext:kb> => $kb\n$kb.get() => $e\n$e'), ctx);
    expect(getExtensionIdentity(purge as never)).toEqual({
      extension: 'kb',
      method: 'get().purge',
    });

    // The later use<> brand takes precedence over it.
    await expectHalt(
      () => execute(parse('use<ext:x> => $x\n$x.purge()'), ctx),
      { code: 'RILL_R088' }
    );
    expect(getExtensionIdentity(purge as never)).toEqual({
      extension: 'x',
      method: 'purge',
    });
  });

  it('keeps the brand when a returned callable is stored in a dict literal', async () => {
    const ctx = buildContext(
      { kb: { '*': { access: 'deny' }, client: { access: 'allow' } } },
      {
        kb: { client: producer(subClient), purge: method('purged') },
      } as unknown as Record<string, RillValue>
    );
    await expectHalt(
      () =>
        execute(
          parse(
            'use<ext:kb> => $kb\n$kb.client() => $c\ndict[f: $c.purge] => $d\n$d.f()'
          ),
          ctx
        ),
      { code: 'RILL_R088' }
    );
    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\ndict[p: $kb.purge] => $d\n$d.p()'),
          ctx
        ),
      { code: 'RILL_R088' }
    );
    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb> => $kb\ndict[...$kb] => $d\n$d.purge()'),
          ctx
        ),
      { code: 'RILL_R088' }
    );
  });

  it('brands sibling callables of a returned iterator-shaped dict', async () => {
    const iter = {
      done: false,
      value: 1,
      next: method('n'),
      purge: method('purged'),
    } as unknown as RillValue;
    const ctx = buildContext(
      { kb: { '*': { access: 'deny' }, c: { access: 'allow' } } },
      { kb: { c: producer(() => iter) } } as unknown as Record<
        string,
        RillValue
      >
    );
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.c().purge()'), ctx),
      { code: 'RILL_R088' }
    );
  });

  it('brands callables under number and boolean dict keys', async () => {
    const typed = {} as Record<string, RillValue>;
    setTypedKey(typed, 1, method('purged'));
    setTypedKey(typed, true, method('purged'));
    const ctx = buildContext(
      { kb: { '*': { access: 'deny' }, t: { access: 'allow' } } },
      { kb: { t: producer(() => typed as RillValue) } } as unknown as Record<
        string,
        RillValue
      >
    );
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.t() => $t\n$t[1]()'), ctx),
      { code: 'RILL_R088' }
    );
    await expectHalt(
      () =>
        execute(parse('use<ext:kb> => $kb\n$kb.t() => $t\n$t[true]()'), ctx),
      { code: 'RILL_R088' }
    );
  });

  it('leaves script closures and host functions unpoliced when echoed', async () => {
    const hostFn = {
      params: [],
      returnType: anyTypeValue,
      fn: () => 'host ok',
    };
    const ctx = buildContext(
      { kb: { '*': { access: 'deny' }, echo: { access: 'allow' } } },
      { kb: { echo: echo() } } as unknown as Record<string, RillValue>,
      { functions: { 'host::fn': hostFn } }
    );

    const closure = await execute(
      parse(
        'use<ext:kb> => $kb\n|| { "closure ok" } => $c\n$kb.echo($c) => $e\n$e()'
      ),
      ctx
    );
    expect(closure.result).toBe('closure ok');

    const host = await execute(
      parse('use<ext:kb> => $kb\n$kb.echo(host::fn) => $h\n$h()'),
      ctx
    );
    expect(host.result).toBe('host ok');
  });

  it('iterates a returned stream and iterator under a wildcard deny', async () => {
    async function* chunks(): AsyncGenerator<RillValue> {
      yield 1;
      yield 2;
    }
    const stream = producer(
      () =>
        createRillStream({
          chunks: chunks(),
          resolve: async () => 'done',
        }) as unknown as RillValue
    );
    const iter = producer(
      () =>
        ({
          done: false,
          value: 1,
          next: publicToCallable({
            fn: () => ({ done: true }) as unknown as RillValue,
            ...noArgs,
          }),
        }) as unknown as RillValue
    );
    const ctx = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          stream: { access: 'allow' },
          iter: { access: 'allow' },
          'iter().next': { access: 'allow' },
        },
      },
      { kb: { stream, iter } } as unknown as Record<string, RillValue>
    );

    const streamed = await execute(
      parse('use<ext:kb> => $kb\n$kb.stream() -> seq({ $ })'),
      ctx
    );
    expect(streamed.result).toEqual([1, 2]);

    const iterated = await execute(
      parse('use<ext:kb> => $kb\n$kb.iter() -> seq({ $ })'),
      ctx
    );
    expect(iterated.result).toEqual([1]);
  });

  it('does not exhaust the member budget on large call results', async () => {
    const vectors = Array.from({ length: 20 }, () =>
      createVector(new Float32Array(1536), 'test-model')
    );
    const strings = Array.from({ length: 20_000 }, (_, i) => `s${i}`);
    const ctx = buildContext(
      {
        kb: {
          '*': { access: 'deny' },
          vectors: { access: 'allow' },
          strings: { access: 'allow' },
        },
      },
      {
        kb: {
          vectors: producer(() => vectors as unknown as RillValue),
          strings: producer(() => strings),
        },
      } as unknown as Record<string, RillValue>
    );
    const v = await execute(
      parse('use<ext:kb> => $kb\n$kb.vectors() -> .len'),
      ctx
    );
    expect(v.result).toBe(20);
    const t = await execute(
      parse('use<ext:kb> => $kb\n$kb.strings() -> .len'),
      ctx
    );
    expect(t.result).toBe(20_000);
  });

  it('records provenance only when a resolver is configured', async () => {
    let fresh: RillValue = '';
    const kb = {
      make: producer(() => {
        fresh = method('made');
        return fresh;
      }),
    } as unknown as Record<string, RillValue>;
    const script = 'use<ext:kb> => $kb\n$kb.make() => $f\n1';

    const withResolver = buildContext({ kb: { make: { access: 'allow' } } }, {
      kb,
    } as unknown as Record<string, RillValue>);
    await execute(parse(script), withResolver);
    expect(getExtensionIdentity(fresh as never)).toEqual({
      extension: 'kb',
      method: 'make()',
    });

    const without = createRuntimeContext({
      resolvers: { ext: extResolver },
      configurations: { resolvers: { ext: { kb } } },
    });
    await execute(parse(script), without);
    expect(getExtensionIdentity(fresh as never)).toBeUndefined();
  });

  it('names a callable returned by a root-callable extension "()"', async () => {
    let fresh: RillValue = '';
    const root = producer(() => {
      fresh = method('made');
      return fresh;
    });
    const ctx = createRuntimeContext({
      filterResolver: () => null,
      resolvers: { ext: extResolver },
      configurations: { resolvers: { ext: { kb: root } } },
    });
    await execute(parse('use<ext:kb> => $kb\n$kb() => $f\n1'), ctx);
    expect(getExtensionIdentity(fresh as never)).toEqual({
      extension: 'kb',
      method: '()',
    });
  });

  describe('policesExtension hint', () => {
    const script = 'use<ext:kb> => $kb\n$kb.make() => $f\n1';

    function hintedContext(
      resolver: FilterResolver,
      kb: Record<string, RillValue>
    ) {
      return createRuntimeContext({
        filterResolver: resolver,
        resolvers: { ext: extResolver },
        configurations: { resolvers: { ext: { kb } } },
      });
    }

    function freshKb() {
      const state: { fresh: RillValue } = { fresh: '' };
      const kb = {
        make: producer(() => {
          state.fresh = method('made');
          return state.fresh;
        }),
      } as unknown as Record<string, RillValue>;
      return { state, kb };
    }

    it('leaves a call-time callable unbranded when the hint returns false', async () => {
      const { state, kb } = freshKb();
      const calls: string[] = [];
      const resolver: FilterResolver = Object.assign(() => null, {
        policesExtension: (extension: string): boolean => {
          calls.push(extension);
          return false;
        },
      });
      await execute(parse(script), hintedContext(resolver, kb));
      expect(getExtensionIdentity(state.fresh as never)).toBeUndefined();
      expect(calls).toContain('kb');
    });

    it('brands a call-time callable when the resolver has no hint', async () => {
      const { state, kb } = freshKb();
      await execute(
        parse(script),
        hintedContext(() => null, kb)
      );
      expect(getExtensionIdentity(state.fresh as never)).toEqual({
        extension: 'kb',
        method: 'make()',
      });
    });

    it('brands a call-time callable when the hint returns true', async () => {
      const { state, kb } = freshKb();
      const resolver: FilterResolver = Object.assign(() => null, {
        policesExtension: (): boolean => true,
      });
      await execute(parse(script), hintedContext(resolver, kb));
      expect(getExtensionIdentity(state.fresh as never)).toEqual({
        extension: 'kb',
        method: 'make()',
      });
    });

    it('still enforces a deny filter when the hint returns false', async () => {
      const { kb } = freshKb();
      const resolver: FilterResolver = Object.assign(
        () => ({
          access: 'deny' as const,
          inTransforms: [],
          outTransforms: [],
        }),
        { policesExtension: (): boolean => false }
      );
      await expectHalt(
        () =>
          execute(
            parse('use<ext:kb> => $kb\n$kb.make()'),
            hintedContext(resolver, kb)
          ),
        { code: 'RILL_R088' }
      );
    });

    it('brands when the hint returns a non-false value', async () => {
      const { state, kb } = freshKb();
      const resolver = Object.assign(() => null, {
        policesExtension: () => undefined,
      }) as unknown as FilterResolver;
      await execute(parse(script), hintedContext(resolver, kb));
      expect(getExtensionIdentity(state.fresh as never)).toEqual({
        extension: 'kb',
        method: 'make()',
      });
    });

    it('keeps the use<> identity when the hint returns false', async () => {
      const { kb } = freshKb();
      const resolver: FilterResolver = Object.assign(() => null, {
        policesExtension: (): boolean => false,
      });
      await execute(parse(script), hintedContext(resolver, kb));
      expect(getExtensionIdentity(kb['make'] as never)).toEqual({
        extension: 'kb',
        method: 'make',
      });
    });

    it('leaves a callable from an unpoliced extension unbranded under a config resolver', async () => {
      const { state, kb } = freshKb();
      const ctx = buildContext({ other: { '*': { access: 'deny' } } }, {
        kb,
        other: { run: method('x') },
      } as unknown as Record<string, RillValue>);
      await execute(parse(script), ctx);
      expect(getExtensionIdentity(state.fresh as never)).toBeUndefined();
    });
  });

  it('brands members reached through repeated shared references', async () => {
    // Host results are validated as acyclic, so the shape reachable here is
    // a shared sub-object rather than a true cycle; the walk visits it once.
    const make = producer(() => {
      const shared: Record<string, RillValue> = { purge: method('purged') };
      return { a: shared, b: shared } as unknown as RillValue;
    });
    const ctx = buildContext(
      { kb: { '*': { access: 'deny' }, make: { access: 'allow' } } },
      { kb: { make } } as unknown as Record<string, RillValue>
    );
    await expectHalt(
      () => execute(parse('use<ext:kb> => $kb\n$kb.make().b.purge()'), ctx),
      { code: 'RILL_R088' }
    );
  });
});
