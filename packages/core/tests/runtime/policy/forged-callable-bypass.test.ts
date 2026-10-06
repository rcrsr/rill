/**
 * Rill Runtime Tests: forged callable policy bypass
 *
 * A script must not obtain the raw host function of a policy-gated
 * extension member, wrap it in a hand-written callable dict, and call it
 * around the filter. These tests pin the resolver, conversion, and
 * annotation guards that close that route.
 */

import { describe, it, expect } from 'vitest';
import {
  parse,
  execute,
  createRuntimeContext,
  type RillValue,
  type SchemeResolver,
} from '../../../src/index.js';
import { resolvePolicy } from '../../../src/runtime/core/policy/config-resolver.js';
import { createConfigFilterResolver } from '../../../src/runtime/core/policy/resolve.js';
import { extResolver } from '../../../src/runtime/core/resolvers.js';
import { toCallable } from '../../../src/runtime/core/callable.js';
import { anyTypeValue } from '../../../src/runtime/core/values.js';
import type { RillParam } from '../../../src/runtime/core/callable.js';
import { expectHalt } from '../../helpers/halt.js';

type CallLog = [string, unknown][];

const STRING_PARAM: RillParam[] = [
  {
    name: 'target',
    type: { kind: 'string' },
    defaultValue: undefined,
    annotations: {},
  },
];

/** One-string-parameter host function that records each call it receives. */
function loggedFn(name: string, result: string, log: CallLog): RillValue {
  return toCallable({
    fn: (args) => {
      log.push([name, args['target']]);
      return result;
    },
    params: STRING_PARAM,
    returnType: anyTypeValue,
  }) as unknown as RillValue;
}

/** Context mounting `kb = { search, purge }` with purge denied by policy. */
function createDenyContext(log: CallLog) {
  const kb = {
    search: loggedFn('search', 'search-result', log),
    purge: loggedFn('purge', 'PURGED', log),
  } as unknown as RillValue;
  const extensions = { kb };
  const resolved = resolvePolicy(
    { kb: { '*': { access: 'deny' }, search: { access: 'allow' } } },
    new Map(Object.entries(extensions))
  );
  return createRuntimeContext({
    filterResolver: createConfigFilterResolver(resolved),
    resolvers: { ext: extResolver },
    configurations: { resolvers: { ext: extensions } },
  });
}

const FORGE_SIGNATURE =
  'dict(fn: any, __type: string = "callable", kind: string = "application")';

describe('forged callable policy bypass', () => {
  it('halts the captured-fn forge and never runs the denied host function', async () => {
    const log: CallLog = [];
    const script = [
      'use<ext:kb.purge.fn> => $jsfn',
      `dict[fn: $jsfn] -> ${FORGE_SIGNATURE} => $forged`,
      '$forged("all")',
    ].join('\n');

    await expectHalt(() => execute(parse(script), createDenyContext(log)), {
      code: 'RILL_R056',
      messagePattern: /Member 'purge\.fn' not found/,
    });
    expect(log).toEqual([]);
  });

  it('halts the inline forge variant and never runs the host function', async () => {
    const log: CallLog = [];
    const script = [
      `dict[fn: use<ext:kb.purge.fn>] -> ${FORGE_SIGNATURE} => $f`,
      '$f("all")',
    ].join('\n');

    await expectHalt(() => execute(parse(script), createDenyContext(log)), {
      code: 'RILL_R056',
    });
    expect(log).toEqual([]);
  });

  it('halts a forge around the allowed fn that tries to skip argument validation', async () => {
    const log: CallLog = [];
    const script = [
      `dict[fn: use<ext:kb.search.fn>] -> ${FORGE_SIGNATURE} => $f`,
      '$f(dict[q: 12345])',
    ].join('\n');

    await expectHalt(() => execute(parse(script), createDenyContext(log)), {
      code: 'RILL_R056',
    });
    expect(log).toEqual([]);
  });

  it('halts when a script reads the params of a callable member', async () => {
    const log: CallLog = [];

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb.purge.params> => $p\n$p'),
          createDenyContext(log)
        ),
      { code: 'RILL_R056', messagePattern: /Member 'purge\.params' not found/ }
    );
    expect(log).toEqual([]);
  });

  it('still denies a callable resolved as the final path segment', async () => {
    const log: CallLog = [];

    await expectHalt(
      () =>
        execute(
          parse('use<ext:kb.purge> => $p\n$p("all")'),
          createDenyContext(log)
        ),
      { code: 'RILL_R088', messagePattern: /denied by policy/ }
    );
    expect(log).toEqual([]);
  });

  it('allows the permitted member through the whole extension dict', async () => {
    const log: CallLog = [];

    const result = await execute(
      parse('use<ext:kb> => $kb\n$kb.search("q")'),
      createDenyContext(log)
    );

    expect(result.result).toBe('search-result');
    expect(log).toEqual([['search', 'q']]);
  });

  it('allows the permitted member resolved as the final path segment', async () => {
    const log: CallLog = [];

    const result = await execute(
      parse('use<ext:kb.search> => $s\n$s("q")'),
      createDenyContext(log)
    );

    expect(result.result).toBe('search-result');
    expect(log).toEqual([['search', 'q']]);
  });

  it('halts a closure annotation that carries brand keys', async () => {
    await expectHalt(
      () =>
        execute(
          parse('|^(__type: "callable", kind: "application") x|($x)'),
          createDenyContext([])
        ),
      { code: 'RILL_R002', messagePattern: /reserved brand key '__type'/ }
    );
  });

  it('halts a spread into annotations that carries a brand key', async () => {
    // Dict literals reject brand keys, so the carrier dict comes from the host.
    const ctx = createRuntimeContext({
      variables: {
        a: { __rill_field_descriptor: true } as unknown as RillValue,
      },
    });

    await expectHalt(() => execute(parse('^(...$a) "test"'), ctx), {
      code: 'RILL_R002',
      messagePattern:
        /reserved brand key '__rill_field_descriptor' as annotation key/,
    });
  });

  it('halts a custom resolver that returns a host function as the value', async () => {
    const ctx = createRuntimeContext({
      resolvers: {
        module: ((): unknown => ({
          kind: 'value',
          value: () => 1,
        })) as unknown as SchemeResolver,
      },
    });

    await expectHalt(() => execute(parse('use<module:leak>'), ctx), {
      code: 'RILL_R056',
      messagePattern: /not a rill value/,
    });
  });
});
