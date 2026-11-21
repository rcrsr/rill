/* oxlint-disable vitest/no-standalone-expect -- tests are registered through rule(...).it, which the plugin does not recognise */
/**
 * Rill Language Tests: use<> Expressions
 * Tests for use<scheme:resource> resolution syntax
 */

import { describe, expect, it } from 'vitest';
import {
  extResolver,
  anyTypeValue,
  isCallable,
  moduleResolver,
  parse,
  ParseError,
  structureToTypeValue,
  toCallable,
} from '@rcrsr/rill';
import type { SchemeResolver, ResolverResult, RillValue } from '@rcrsr/rill';

import { expectHalt } from '../helpers/halt.js';
import { rule } from '../helpers/rule.js';
import { run } from '../helpers/runtime.js';

// ============================================================
// SHARED TEST HELPERS
// ============================================================

/** Build RuntimeOptions with a single value resolver that returns a known value. */
function valueResolver(value: unknown): SchemeResolver {
  return (_resource: string): ResolverResult => ({
    kind: 'value',
    value: value as import('@rcrsr/rill').RillValue,
  });
}

/** Build RuntimeOptions with a source resolver returning in-memory rill source text. */
function sourceResolver(text: string): SchemeResolver {
  return (_resource: string): ResolverResult => ({ kind: 'source', text });
}

/** Shared parseSource option: uses the real rill parser for source resolvers. */
const parseSource = (text: string) => parse(text);

describe('Rill Language: use<> Expressions', () => {
  // ============================================================
  // SUCCESS CASES
  // ============================================================

  describe('Success Cases', () => {
    describe('Static form — single segment', () => {
      it('AC-1: resolves use<host:fn> via registered resolver', async () => {
        const result = await run('use<host:fn>', {
          resolvers: { host: valueResolver('hello') },
        });
        expect(result).toBe('hello');
      });

      it('AC-7: 3-scheme config produces correct values for each scheme', async () => {
        const result = await run(
          'use<a:res> => $x\nuse<b:res> => $y\nuse<c:res> => $z\ndict[x: $x, y: $y, z: $z]',
          {
            resolvers: {
              a: valueResolver('alpha'),
              b: valueResolver('beta'),
              c: valueResolver('gamma'),
            },
          }
        );
        expect(result).toEqual({ x: 'alpha', y: 'beta', z: 'gamma' });
      });
    });

    describe('Static form — multi-segment', () => {
      it('AC-1: resolves use<host:app.fetch> with dot-joined segments', async () => {
        let capturedResource = '';
        const resolver: SchemeResolver = (resource) => {
          capturedResource = resource;
          return { kind: 'value', value: 'fetched' };
        };
        const result = await run('use<host:app.fetch>', {
          resolvers: { host: resolver },
        });
        expect(result).toBe('fetched');
        expect(capturedResource).toBe('app.fetch');
      });
    });

    describe('Static form — type assertion', () => {
      it('parses a fn type after use<> without error', () => {
        expect(() => parse('use<host:fn>:fn(x: string)')).not.toThrow();
        expect(() =>
          parse('use<ext:llm.openai.message>:fn(text: string, options: dict)')
        ).not.toThrow();
        expect(() => parse('use<host:fn>:string')).not.toThrow();
        expect(() =>
          parse(
            'use<ext:fn>:fn(text: string, options: dict(max_tokens: number = 0, system: string = "")):dict(content: string)'
          )
        ).not.toThrow();
      });

      it('throws ParseError for a missing comma between fn type params', () => {
        expect(() => parse('use<host:fn>:fn(x: string y: number)')).toThrow(
          "Expected ',' or ')' in fn parameter list"
        );
      });

      rule('use.type').it(
        'returns a host value that matches the type',
        async () => {
          const result = await run('use<host:v>:number', {
            resolvers: { host: valueResolver(42) },
          });
          expect(result).toBe(42);
        }
      );

      rule('use.type').it(
        'halts with #TYPE_MISMATCH when a host value does not match the type',
        async () => {
          await expectHalt(
            () =>
              run('use<host:v>:number', {
                resolvers: { host: valueResolver('x') },
              }),
            {
              code: 'TYPE_MISMATCH',
              messagePattern: /expected number, got string/,
            }
          );
        }
      );

      rule('use.type').it(
        'lets guard catch the mismatch as #TYPE_MISMATCH',
        async () => {
          const result = await run(
            'guard { use<host:v>:number } => $r\n$r.!code == #TYPE_MISMATCH',
            { resolvers: { host: valueResolver('x') } }
          );
          expect(result).toBe(true);
        }
      );

      rule('use.type').it(
        'returns a source module result that matches the type',
        async () => {
          const result = await run('use<m:x>:number', {
            resolvers: { m: sourceResolver('42') },
            parseSource,
          });
          expect(result).toBe(42);
        }
      );

      rule('use.type').it(
        'halts with #TYPE_MISMATCH when a source module result does not match the type',
        async () => {
          await expectHalt(
            () =>
              run('use<m:x>:string', {
                resolvers: { m: sourceResolver('42') },
                parseSource,
              }),
            { code: 'TYPE_MISMATCH' }
          );
        }
      );

      rule('use.type').it(
        'locks a capture to the written type so a later value of that type passes',
        async () => {
          const result = await run(
            'use<h:v>:union(number, string) => $v\n"a" => $v\n$v',
            { resolvers: { h: valueResolver(1) } }
          );
          expect(result).toBe('a');
        }
      );

      rule('use.type').it(
        'halts a later capture that falls outside the written type',
        async () => {
          await expectHalt(
            () =>
              run('use<h:v>:union(number, string) => $v\ntrue => $v', {
                resolvers: { h: valueResolver(1) },
              }),
            { code: 'RILL_R001', hostErrorId: 'RILL-R001' }
          );
        }
      );

      rule('use.type').it(
        'reports the written type through .^type',
        async () => {
          const result = await run(
            'use<h:v>:union(number, string) => $v\n$v.^type == union(number, string)',
            { resolvers: { h: valueResolver(1) } }
          );
          expect(result).toBe(true);
        }
      );

      describe('fn types', () => {
        const stringParam = {
          name: 'text',
          type: { kind: 'string' } as const,
          defaultValue: undefined as string | undefined,
          annotations: {},
        };
        const echo = (params: (typeof stringParam)[]) =>
          toCallable({
            params,
            returnType: structureToTypeValue({ kind: 'string' }),
            fn: (args) => `got:${String(args['text'] ?? 'none')}`,
          });

        rule('use.type').it(
          'asserts the fn type before calling a host callable as a pipe target',
          async () => {
            const result = await run(
              '"x" -> use<h:f>:fn(text: string):string',
              {
                resolvers: { h: valueResolver(echo([stringParam])) },
              }
            );
            expect(result).toBe('got:x');
          }
        );

        rule('use.type').it(
          'halts without calling when a param name differs from the fn type',
          async () => {
            let called = false;
            const fn = toCallable({
              params: [stringParam],
              returnType: structureToTypeValue({ kind: 'string' }),
              fn: () => {
                called = true;
                return 'x';
              },
            });
            await expectHalt(
              () =>
                run('"x" -> use<h:f>:fn(other: string):string', {
                  resolvers: { h: valueResolver(fn) },
                }),
              { code: 'TYPE_MISMATCH' }
            );
            expect(called).toBe(false);
          }
        );

        rule('use.type').it(
          'halts when the callable has a defaulted param the fn type omits',
          async () => {
            const defaulted = { ...stringParam, defaultValue: 'd' };
            await expectHalt(
              () =>
                run('use<h:f>:fn(text: string):string', {
                  resolvers: { h: valueResolver(echo([defaulted])) },
                }),
              { code: 'TYPE_MISMATCH' }
            );
          }
        );

        rule('use.type').it(
          'accepts any callable under a bare fn type',
          async () => {
            const fn = echo([stringParam]);
            const result = await run('use<h:f>:fn', {
              resolvers: { h: valueResolver(fn) },
            });
            expect(result).toBe(fn);
          }
        );

        rule('use.type').it(
          'halts when a dict value is asserted against a fn type',
          async () => {
            await expectHalt(
              () =>
                run('use<host:fn>:fn(text: string):dict(content: string)', {
                  resolvers: { host: valueResolver({ content: 'hello' }) },
                }),
              { code: 'TYPE_MISMATCH' }
            );
          }
        );
      });
    });

    describe('Variable form', () => {
      it('AC-21: $name resolving to "scheme:resource" works same as static', async () => {
        const result = await run('"host:greet" => $id\nuse<$id>', {
          resolvers: { host: valueResolver('greetings') },
        });
        expect(result).toBe('greetings');
      });
    });

    describe('Computed form', () => {
      it('AC-21: ("scheme:name") resolves same as use<scheme:name>', async () => {
        const result = await run('use<("host:greet")>', {
          resolvers: { host: valueResolver('computed-result') },
        });
        expect(result).toBe('computed-result');
      });
    });

    describe('Inline invocation with ext member resolution', () => {
      it('AC-3: use<ext:qdrant.search>(...) resolves member and invokes with 3 args', async () => {
        const receivedArgs: (RillValue | undefined)[] = [];
        const searchFn = toCallable({
          params: [
            {
              name: 'collection',
              type: undefined,
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'vector',
              type: undefined,
              defaultValue: undefined,
              annotations: {},
            },
            {
              name: 'limit',
              type: undefined,
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: anyTypeValue,
          fn: (args) => {
            receivedArgs.push(
              args['collection'],
              args['vector'],
              args['limit']
            );
            return `search:${args['collection']}:${args['vector']}:${args['limit']}`;
          },
        });

        const result = await run(
          '"embedding-value" => $embedding\nuse<ext:qdrant.search>("my-collection", $embedding, 10)',
          {
            resolvers: { ext: extResolver },
            configurations: {
              resolvers: {
                ext: { qdrant: { search: searchFn } },
              },
            },
          }
        );

        expect(result).toBe('search:my-collection:embedding-value:10');
        expect(receivedArgs).toEqual(['my-collection', 'embedding-value', 10]);
      });
    });

    describe('Inline invocation', () => {
      it('AC-5: use<host:fn>("arg") resolves and invokes inline', async () => {
        const result = await run('use<host:fn>("hello")', {
          resolvers: {
            host: (_resource): ResolverResult => ({
              kind: 'value',
              value: toCallable({
                params: [
                  {
                    name: 'arg',
                    type: undefined,
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                returnType: anyTypeValue,
                fn: (args) => `invoked:${args['arg']}`,
              }),
            }),
          },
        });
        expect(result).toBe('invoked:hello');
      });
    });

    describe('Pipe target invocation', () => {
      it('invokes a resolved application callable with the pipe value as its argument', async () => {
        const result = await run('"hello" -> use<host:fn>', {
          resolvers: {
            host: (_resource): ResolverResult => ({
              kind: 'value',
              value: {
                __type: 'callable' as const,
                kind: 'application' as const,
                isProperty: false,
                params: [
                  {
                    name: 'text',
                    type: { kind: 'string' },
                    defaultValue: undefined,
                    annotations: {},
                  },
                ],
                fn: (args: Record<string, RillValue>) =>
                  `invoked:${args['text']}`,
              } as unknown as RillValue,
            }),
          },
        });
        expect(result).toBe('invoked:hello');
      });

      it('returns a source module closure uninvoked when it is a pipe target', async () => {
        const result = await run('"hello" -> use<module:greeter>', {
          resolvers: {
            module: sourceResolver('fn { "got:{$}" }'),
          },
          parseSource,
        });
        expect(isCallable(result)).toBe(true);
      });

      it('returns the result of a source module expression unchanged', async () => {
        const result = await run('"hello" -> use<module:upper>', {
          resolvers: {
            module: sourceResolver('$ -> .upper'),
          },
          parseSource,
        });
        expect(result).toBe('HELLO');
      });

      it('halts when a host-resolved string receives a piped value', async () => {
        await expectHalt(
          () =>
            run('"hello" -> use<host:value>', {
              resolvers: { host: valueResolver('resolved') },
            }),
          {
            code: 'RILL_R002',
            hostErrorId: 'RILL-R002',
            messagePattern:
              /cannot pipe into use<host:value>: it holds a string/,
          }
        );
      });

      it('selects a host-resolved dict value by key', async () => {
        const result = await run('"a" -> use<host:value>', {
          resolvers: { host: valueResolver({ a: 1 }) },
        });
        expect(result).toBe(1);
      });

      it('selects a host-resolved list element by index', async () => {
        const result = await run('1 -> use<host:value>', {
          resolvers: { host: valueResolver(['x', 'y', 'z']) },
        });
        expect(result).toBe('y');
      });

      rule('dispatch.fn').it(
        'returns a function held in a host-resolved dict uncalled',
        async () => {
          const fn = toCallable({
            params: [],
            returnType: anyTypeValue,
            fn: () => 'called',
          });
          const result = await run('"f" -> use<host:value>', {
            resolvers: { host: valueResolver({ f: fn }) },
          });
          expect(result).toBe(fn);
        }
      );

      it('converts the piped value through a host-resolved type value', async () => {
        const result = await run('"5" -> use<host:value>', {
          resolvers: {
            host: valueResolver(structureToTypeValue({ kind: 'number' })),
          },
        });
        expect(result).toBe(5);
      });

      it('returns the callable uninvoked when use<> is not a pipe target', async () => {
        const result = await run('use<module:greeter>', {
          resolvers: {
            module: sourceResolver('fn { "got:{$}" }'),
          },
          parseSource,
        });
        expect(isCallable(result)).toBe(true);
      });
    });

    describe('Source resolver — last expression value', () => {
      it('AC-2+AC-22: module source last expression is returned', async () => {
        const result = await run('use<module:greetings>', {
          resolvers: {
            module: sourceResolver('"hello world"'),
          },
          parseSource,
        });
        expect(result).toBe('hello world');
      });

      it('AC-22: multi-statement module returns last expression', async () => {
        const result = await run('use<module:calc>', {
          resolvers: {
            module: sourceResolver('"ignored" => $x\n"final"'),
          },
          parseSource,
        });
        expect(result).toBe('final');
      });

      it('AC-2: module returns dict; member access works after binding', async () => {
        const result = await run('use<module:greetings> => $g\n$g.msg', {
          resolvers: {
            module: sourceResolver('dict[msg: "hello world"]'),
          },
          parseSource,
        });
        expect(result).toBe('hello world');
      });
    });
  });

  // ============================================================
  // ERROR CASES
  // ============================================================

  describe('Error Cases', () => {
    describe('EC-6 — RILL-R054: scheme not registered', () => {
      it('throws RILL-R054 for unknown scheme', async () => {
        await expect(run('use<db:users>', {})).rejects.toHaveProperty(
          'errorId',
          'RILL-R054'
        );
      });

      it('RILL-R054 message includes scheme name', async () => {
        await expect(run('use<db:users>', {})).rejects.toThrow(
          "No resolver registered for scheme 'db'"
        );
      });
    });

    describe('EC-7 — RILL-R055: circular resolution', () => {
      it('throws RILL-R055 when resolver A re-enters module:A', async () => {
        // module:a resolver returns source that calls use<module:a> again.
        // The runtime tracks in-flight keys via resolvingSchemes and detects the cycle.
        const circularModuleResolver: SchemeResolver = () => ({
          kind: 'source',
          text: 'use<module:a>',
        });

        await expect(
          run('use<module:a>', {
            resolvers: { module: circularModuleResolver },
            parseSource,
          })
        ).rejects.toHaveProperty('errorId', 'RILL-R055');
      });

      it('RILL-R055 message includes the circular key', async () => {
        const selfResolver: SchemeResolver = () => ({
          kind: 'source',
          text: 'use<mod:items>',
        });

        await expect(
          run('use<mod:items>', {
            resolvers: { mod: selfResolver },
            parseSource,
          })
        ).rejects.toThrow(
          'Circular resolution detected: mod:items is already being resolved'
        );
      });
    });

    describe('Real resolver failures surface as RILL-R056', () => {
      // Every resolver throw is wrapped by use<> as a catchable RILL-R056 halt
      // carrying the real resolver's own message.
      it('wraps moduleResolver missing-module failure', async () => {
        await expectHalt(
          () =>
            run('use<module:missing>', {
              resolvers: { module: moduleResolver },
              configurations: {
                resolvers: { module: { other: '/tmp/other.rill' } },
              },
            }),
          {
            code: 'RILL_R056',
            hostErrorId: 'RILL-R056',
            messagePattern: "Module 'missing' not found in resolver config",
          }
        );
      });

      it('wraps moduleResolver file read failure', async () => {
        await expectHalt(
          () =>
            run('use<module:greetings>', {
              resolvers: { module: moduleResolver },
              configurations: {
                resolvers: {
                  module: { greetings: '/nonexistent-rill-dir/greetings.rill' },
                },
              },
            }),
          {
            code: 'RILL_R056',
            hostErrorId: 'RILL-R056',
            messagePattern: "Failed to read module 'greetings'",
          }
        );
      });

      it('wraps moduleResolver invalid config failure', async () => {
        await expectHalt(
          () =>
            run('use<module:greetings>', {
              resolvers: { module: moduleResolver },
              configurations: { resolvers: { module: 'not-an-object' } },
            }),
          {
            code: 'RILL_R056',
            hostErrorId: 'RILL-R056',
            messagePattern: 'moduleResolver config must be a plain object',
          }
        );
      });

      it('wraps extResolver absent-extension failure', async () => {
        await expectHalt(
          () =>
            run('use<ext:qdrant>', {
              resolvers: { ext: extResolver },
              configurations: { resolvers: { ext: {} } },
            }),
          {
            code: 'RILL_R056',
            hostErrorId: 'RILL-R056',
            messagePattern: "Extension 'qdrant' not found in resolver config",
          }
        );
      });

      it('wraps extResolver missing-member failure', async () => {
        await expectHalt(
          () =>
            run('use<ext:qdrant.nonexistent>', {
              resolvers: { ext: extResolver },
              configurations: {
                resolvers: { ext: { qdrant: { search: 'ok' } } },
              },
            }),
          {
            code: 'RILL_R056',
            hostErrorId: 'RILL-R056',
            messagePattern:
              "Member 'nonexistent' not found in extension 'qdrant'",
          }
        );
      });
    });

    describe('EC-8 — RILL-R056: resolver throws', () => {
      it('wraps resolver exception in RILL-R056', async () => {
        const resolver: SchemeResolver = () => {
          throw new Error('connection refused');
        };
        await expect(
          run('use<host:api>', { resolvers: { host: resolver } })
        ).rejects.toHaveProperty('errorId', 'RILL-R056');
      });

      it('RILL-R056 message includes scheme:resource and original message', async () => {
        const resolver: SchemeResolver = () => {
          throw new Error('connection refused');
        };
        await expect(
          run('use<host:api>', { resolvers: { host: resolver } })
        ).rejects.toThrow("Resolver error for 'host:api': connection refused");
      });
    });

    describe('EC-9 — RILL-R057: non-string from variable form', () => {
      it('throws RILL-R057 when $var resolves to non-string', async () => {
        await expect(
          run('42 => $id\nuse<$id>', {
            resolvers: { host: valueResolver('x') },
          })
        ).rejects.toHaveProperty('errorId', 'RILL-R057');
      });

      it('RILL-R057 message includes actual type', async () => {
        await expect(
          run('42 => $id\nuse<$id>', {
            resolvers: { host: valueResolver('x') },
          })
        ).rejects.toThrow(
          'use<> identifier must resolve to string, got number'
        );
      });
    });

    describe('EC-10 — RILL-R058: missing colon separator in dynamic form', () => {
      it('throws RILL-R058 when variable resolves to string without colon', async () => {
        await expect(
          run('"nocolon" => $id\nuse<$id>', {
            resolvers: { host: valueResolver('x') },
          })
        ).rejects.toHaveProperty('errorId', 'RILL-R058');
      });

      it('throws RILL-R058 when computed form produces string without colon', async () => {
        await expect(
          run('use<("nocolon")>', {
            resolvers: { host: valueResolver('x') },
          })
        ).rejects.toHaveProperty('errorId', 'RILL-R058');
      });
    });

    describe('EC-11 — RILL-P020: missing colon in static form', () => {
      it('throws RILL-P020 parse error when static identifier lacks colon', () => {
        expect(() => parse('use<hostfn>')).toThrow(ParseError);
        expect(() => parse('use<hostfn>')).toThrow(
          "Expected ':' after scheme in use<>"
        );
      });

      it('RILL-P020 carries correct errorId', () => {
        try {
          parse('use<hostfn>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect((err as ParseError).errorId).toBe('RILL-P020');
        }
      });
    });

    describe('EC-12 — RILL-P021: empty resource in static form', () => {
      it('throws RILL-P021 parse error when resource part is empty', () => {
        expect(() => parse('use<host:>')).toThrow(ParseError);
        expect(() => parse('use<host:>')).toThrow(
          "Expected resource identifier after ':' in use<>"
        );
      });

      it('RILL-P021 carries correct errorId', () => {
        try {
          parse('use<host:>');
          expect.fail('Should have thrown');
        } catch (err) {
          expect((err as ParseError).errorId).toBe('RILL-P021');
        }
      });
    });

    describe('EC-13 — RILL-P022: missing closing >', () => {
      it('throws RILL-P022 parse error when closing > is absent', () => {
        expect(() => parse('use<host:fn')).toThrow(ParseError);
        expect(() => parse('use<host:fn')).toThrow(
          "Expected '>' to close use<>"
        );
      });

      it('RILL-P022 carries correct errorId', () => {
        try {
          parse('use<host:fn');
          expect.fail('Should have thrown');
        } catch (err) {
          expect((err as ParseError).errorId).toBe('RILL-P022');
        }
      });
    });

    // ============================================================
    // AC-12 — RILL-R060: legacy frontmatter keys removed
    // ============================================================

    describe('AC-12 — RILL-R060: use: frontmatter removed', () => {
      it('throws RILL-R060 when script uses use: frontmatter key', async () => {
        const script = `---\nuse:\n  math: ./math.rill\n---\n"hello"`;
        await expect(run(script, {})).rejects.toHaveProperty(
          'errorId',
          'RILL-R060'
        );
      });

      it('RILL-R060 message indicates the syntax is removed', async () => {
        const script = `---\nuse:\n  math: ./math.rill\n---\n"hello"`;
        await expect(run(script, {})).rejects.toThrow('removed');
      });
    });

    describe('AC-12 — RILL-R060: export: frontmatter removed', () => {
      it('throws RILL-R060 when script uses export: frontmatter key', async () => {
        const script = `---\nexport:\n  result: $x\n---\n"hello"`;
        await expect(run(script, {})).rejects.toHaveProperty(
          'errorId',
          'RILL-R060'
        );
      });

      it('RILL-R060 message indicates the syntax is removed', async () => {
        const script = `---\nexport:\n  result: $x\n---\n"hello"`;
        await expect(run(script, {})).rejects.toThrow('removed');
      });
    });

    // ============================================================
    // AC-13 — RILL-P012: legacy call/pipe syntax removed
    // ============================================================

    describe('AC-13 — RILL-P012: app:: direct-call syntax removed', () => {
      it('throws ParseError for app::fn() syntax', () => {
        expect(() => parse('app::myFunc()')).toThrow(ParseError);
      });

      it('RILL-P012 message indicates the syntax is removed', () => {
        expect(() => parse('app::myFunc()')).toThrow('removed');
      });
    });

    describe('RILL-P012: namespaced host-call syntax removed', () => {
      function parseError(source: string): unknown {
        try {
          parse(source);
        } catch (e) {
          return e;
        }
        return undefined;
      }

      it.each([
        ['namespaced call', 'math::double(21)'],
        ['bare namespaced name', 'greet::user'],
        ['namespaced call as pipe target', '"hello" -> str::pad(10, "-")'],
        ['bare namespaced pipe target', '"hello" -> str::upper'],
        ['call inside a closure body', 'fn(x) { ns::f($x) }'],
      ])('throws RILL-P012 for %s', (_label, source) => {
        const err = parseError(source);
        expect(err).toBeInstanceOf(ParseError);
        expect(err).toHaveProperty('errorId', 'RILL-P012');
      });

      it('suggests the extension form for a multi-segment name', () => {
        const err = parseError('std::math::add(1, 2)');
        expect(err).toHaveProperty('errorId', 'RILL-P012');
        const message = (err as Error).message;
        expect(message).toContain('use<ext:std> => $std');
        expect(message).toContain('$std.math.add()');
      });

      it('reports the exact migration message', () => {
        const err = parseError('math::double(21)');
        expect((err as Error).message).toContain(
          'Syntax removed: math::double namespaced host call removed; use use<ext:math> => $math, then $math.double()'
        );
      });

      it('fails at parse time without invoking a registered function', async () => {
        let calls = 0;
        await expect(
          run('math::double(21)', {
            functions: {
              'math::double': {
                params: [],
                returnType: anyTypeValue,
                fn: () => {
                  calls += 1;
                  return 42;
                },
              },
            },
          })
        ).rejects.toHaveProperty('errorId', 'RILL-P012');
        expect(calls).toBe(0);
      });
    });

    describe('AC-13 — RILL-P012: -> export pipe syntax removed', () => {
      it('throws ParseError for -> export syntax', () => {
        expect(() => parse('"value" -> export')).toThrow(ParseError);
      });

      it('RILL-P012 message indicates the syntax is removed', () => {
        expect(() => parse('"value" -> export')).toThrow('removed');
      });
    });
  });

  // ============================================================
  // BOUNDARY CASES
  // ============================================================

  describe('Boundary Cases', () => {
    describe('AC-16: No caching — resolver called twice', () => {
      it('invokes resolver on each use<> call, not once', async () => {
        let callCount = 0;
        const resolver: SchemeResolver = (_resource) => {
          callCount++;
          return { kind: 'value', value: callCount };
        };
        await run('use<host:fn> => $a\nuse<host:fn> => $b', {
          resolvers: { host: resolver },
        });
        expect(callCount).toBe(2);
      });
    });

    describe('AC-17: Completed resolution not tracked as in-flight', () => {
      it('does not throw circular error after A resolves successfully', async () => {
        // Resolver for module:a succeeds first time.
        // Second call use<module:a> must succeed (not trigger RILL-R055).
        const resolver: SchemeResolver = (_resource) => ({
          kind: 'value',
          value: 'ok',
        });
        const result = await run(
          'use<module:a> => $first\nuse<module:a> => $second\n$second',
          {
            resolvers: { module: resolver },
          }
        );
        expect(result).toBe('ok');
      });
    });

    describe('AC-18: Full ext dict vs member access', () => {
      it('extResolver-style: full dict returned when no dot path', async () => {
        const dictValue = { search: 'searchFn', upsert: 'upsertFn' };
        const resolver: SchemeResolver = (resource) => {
          if (resource === 'qdrant') {
            return {
              kind: 'value',
              value: dictValue as import('@rcrsr/rill').RillValue,
            };
          }
          return { kind: 'value', value: null };
        };
        const result = await run('use<ext:qdrant>', {
          resolvers: { ext: resolver },
        });
        expect(result).toEqual(dictValue);
      });

      it('extResolver-style: member returned for dot path', async () => {
        const resolver: SchemeResolver = (resource) => {
          if (resource === 'qdrant.search') {
            return { kind: 'value', value: 'searchFn' };
          }
          return { kind: 'value', value: null };
        };
        const result = await run('use<ext:qdrant.search>', {
          resolvers: { ext: resolver },
        });
        expect(result).toBe('searchFn');
      });
    });

    describe('AC-19: Closure-time resolution (lazy eval)', () => {
      it('use<> inside closure resolves at invocation time, not definition time', async () => {
        let callCount = 0;
        const resolver: SchemeResolver = () => {
          callCount++;
          return { kind: 'value', value: callCount };
        };

        // Define a closure that contains use<host:fn> — no invocation yet
        const result = await run('fn() { use<host:fn> } => $fn\n$fn()', {
          resolvers: { host: resolver },
        });

        // Resolver is called when closure body executes, not when closure is defined
        expect(callCount).toBe(1);
        expect(result).toBe(1);
      });
    });

    describe('AC-20: Empty resolvers → RILL-R054 for all use<>', () => {
      it('throws RILL-R054 when no resolvers configured', async () => {
        await expect(run('use<host:fn>', {})).rejects.toHaveProperty(
          'errorId',
          'RILL-R054'
        );
      });
    });

    describe('AC-21: Computed form equivalence to static', () => {
      it('use<("module:greetings")> resolves same as use<module:greetings>', async () => {
        const resolver: SchemeResolver = (resource) => ({
          kind: 'value',
          value: `resolved:${resource}`,
        });
        const staticResult = await run('use<module:greetings>', {
          resolvers: { module: resolver },
        });
        const computedResult = await run('use<("module:greetings")>', {
          resolvers: { module: resolver },
        });
        expect(computedResult).toBe(staticResult);
      });
    });

    describe('AC-22: Module last-expression result', () => {
      it('last expression in module source is the resolved value', async () => {
        const result = await run('use<module:numbers>', {
          resolvers: {
            module: sourceResolver('1 => $a\n2 => $b\n$a + $b'),
          },
          parseSource,
        });
        expect(result).toBe(3);
      });
    });
  });

  describe('Halts escaping a module are not recoverable by the caller', () => {
    const MISMATCH = '"a" -> :number';
    const badModule = (text: string) => ({
      resolvers: { m: sourceResolver(text) },
      parseSource,
    });

    function counterFn(counter: { calls: number }) {
      return {
        params: [] as never,
        returnType: { __type: 'any' } as never,
        fn: () => {
          counter.calls += 1;
          return 'counted';
        },
      };
    }

    rule('use.module-halt').it(
      'guard does not catch an unmapped-atom halt from a module',
      async () => {
        await expectHalt(
          () => run(`guard { use<m:bad> }`, badModule(MISMATCH)),
          {
            code: 'TYPE_MISMATCH',
          }
        );
      }
    );

    rule('use.module-halt').it(
      'retry runs a failing module body exactly once',
      async () => {
        const counter = { calls: 0 };
        await expectHalt(
          () =>
            run('retry(attempts: 3) { count_calls() -> use<m:bad> }', {
              ...badModule(MISMATCH),
              functions: { count_calls: counterFn(counter) },
            }),
          { code: 'TYPE_MISMATCH' }
        );
        expect(counter.calls).toBe(1);
      }
    );

    rule('use.module-halt').it(
      'timeout does not catch a halt from a module',
      async () => {
        await expectHalt(
          () =>
            run(
              'timeout(total: duration("500ms")) { use<m:bad> }',
              badModule(MISMATCH)
            ),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    rule('use.module-halt').it(
      'pass(ignore_halts: true) does not ignore a halt from a module',
      async () => {
        await expectHalt(
          () =>
            run(
              '5 -> pass(ignore_halts: true) { use<m:bad> }',
              badModule(MISMATCH)
            ),
          { code: 'TYPE_MISMATCH' }
        );
      }
    );

    it('a module reading $ with nothing piped halts RILL-R005 past guard', async () => {
      await expectHalt(() => run('guard { use<m:bad> }', badModule('$')), {
        code: 'RILL_R005',
        hostErrorId: 'RILL-R005',
      });
    });

    it('a guard inside the module catches its own halt', async () => {
      const result = await run(
        'use<m:ok>',
        badModule('guard { "a" -> :number } => $r\n"recovered"')
      );
      expect(result).toBe('recovered');
    });

    rule('use.resolution-catchable').it(
      'guard catches RILL-R056 for an unparseable module',
      async () => {
        const result = await run(
          'guard { use<m:bad> } => $r\n$r.!code -> .eq(#RILL_R056)',
          badModule('??? invalid syntax')
        );
        expect(result).toBe(true);
      }
    );

    rule('use.resolution-catchable').it(
      'guard catches RILL-R054 for an unregistered scheme',
      async () => {
        const result = await run(
          'guard { use<nope:x> } => $r\n$r.!code -> .eq(#RILL_R054)'
        );
        expect(result).toBe(true);
      }
    );

    rule('use.resolution-catchable').it(
      'guard catches RILL-R058 for a missing scheme separator',
      async () => {
        const result = await run(
          '"nocolon" => $id\nguard { use<$id> } => $r\n$r.!code -> .eq(#RILL_R058)'
        );
        expect(result).toBe(true);
      }
    );

    it('RILL-R055 is not caught by guard around the use', async () => {
      await expectHalt(() => run('guard { use<m:a> }', badModule('use<m:a>')), {
        code: 'RILL_R055',
        hostErrorId: 'RILL-R055',
      });
    });

    it('RILL-R055 is not caught by a guard inside the module', async () => {
      await expectHalt(() => run('use<m:a>', badModule('guard { use<m:a> }')), {
        code: 'RILL_R055',
        hostErrorId: 'RILL-R055',
      });
    });
  });
});
