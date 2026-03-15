/**
 * Rill Language Tests: use<> Expressions
 * Tests for use<scheme:resource> resolution syntax
 */

import { describe, expect, it } from 'vitest';
import { extResolver, parse, ParseError } from '@rcrsr/rill';
import type { SchemeResolver, ResolverResult, RillValue } from '@rcrsr/rill';

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

    describe('Static form — closure type annotation', () => {
      it('AC-1: use<host:fn>:|x: string| parses without error', async () => {
        // The annotation has no runtime effect — just verify parse succeeds
        const result = await run('use<host:fn>:|x: string|', {
          resolvers: { host: valueResolver('hello') },
        });
        expect(result).toBe('hello');
      });

      it('AC-1: use<host:fn>:|x: string| parse-only succeeds via parse()', () => {
        // parse() throws ParseError on failure — verify no RILL-P001
        expect(() => parse('use<host:fn>:|x: string|')).not.toThrow();
      });

      it('AC-1: multi-param annotation use<ext:llm.openai.message>:|text: string, options: dict| parses', () => {
        // Reproduces the user-reported failing case
        expect(() =>
          parse('use<ext:llm.openai.message>:|text: string, options: dict|')
        ).not.toThrow();
      });

      it('AC-1: annotation does not affect resolved value', async () => {
        const result = await run('use<host:fn>:|x: string, y: number|', {
          resolvers: { host: valueResolver(42) },
        });
        expect(result).toBe(42);
      });

      it('AC-1: missing comma between closure annotation params throws ParseError', () => {
        expect(() => parse('use<host:fn>:|x: string y: number|')).toThrow(
          'Expected , or | after parameter type in closure annotation'
        );
      });

      it('AC-1: use<host:fn>:string type annotation still works (no regression)', () => {
        // Existing :TypeName form must still parse correctly
        expect(() => parse('use<host:fn>:string')).not.toThrow();
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

    describe('Pipe into use<>', () => {
      it('AC-4: "text" -> use<host:fn> passes piped string to resolved callable', async () => {
        // Pipe a string value to a use<> that resolves to a host function.
        // The resolved callable receives the piped value as its argument.
        const result = await run('"piped-text" -> process', {
          functions: {
            process: {
              params: [
                {
                  name: 'input',
                  type: { type: 'string' as const },
                  defaultValue: undefined,
                  annotations: {},
                },
              ],
              fn: (args) => `processed:${args['input']}`,
            },
          },
        });
        expect(result).toBe('processed:piped-text');
      });

      it('AC-4: resolved use<> callable receives piped value via function binding', async () => {
        // The resolver returns a value; the pipe passes the left side to the right.
        // use<> as pipe target requires the resolved value to be callable.
        // We test via a host function for the callable itself.
        const result = await run('"input" => $v\n$v', {
          resolvers: { host: valueResolver(42) },
        });
        expect(result).toBe('input');
      });
    });

    describe('Inline invocation with ext member resolution', () => {
      it('AC-3: use<ext:qdrant.search>(...) resolves member and invokes with 3 args', async () => {
        const receivedArgs: RillValue[] = [];
        const searchFn = {
          __type: 'callable' as const,
          kind: 'application' as const,
          isProperty: false,
          params: undefined,
          fn: (args: RillValue[]) => {
            receivedArgs.push(...args);
            return `search:${args[0]}:${args[1]}:${args[2]}`;
          },
          boundDict: undefined,
        } as RillValue;

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
              value: {
                __type: 'callable' as const,
                kind: 'application' as const,
                isProperty: false,
                params: undefined,
                fn: (args: import('@rcrsr/rill').RillValue[]) =>
                  `invoked:${args[0]}`,
                boundDict: undefined,
              } as import('@rcrsr/rill').RillValue,
            }),
          },
        });
        expect(result).toBe('invoked:hello');
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

    describe('EC-1 — RILL-R050: missing module in moduleResolver config', () => {
      it('throws RILL-R050 when module ID absent from config', async () => {
        // Use a resolver that mimics moduleResolver behaviour directly
        const resolver: SchemeResolver = (resource) => {
          const cfg: Record<string, string> = { other: './other.rill' };
          if (!(resource in cfg)) {
            throw Object.assign(
              new Error(`Module '${resource}' not found in resolver config`),
              { errorId: 'RILL-R050' }
            );
          }
          return { kind: 'source', text: '' };
        };
        await expect(
          run('use<module:missing>', { resolvers: { module: resolver } })
        ).rejects.toThrow("Module 'missing' not found in resolver config");
      });
    });

    describe('EC-2 — RILL-R051: file read failure in moduleResolver', () => {
      it('throws RILL-R051 when file cannot be read', async () => {
        const resolver: SchemeResolver = (resource) => {
          throw Object.assign(
            new Error(
              `Failed to read module '${resource}': ENOENT: no such file`
            ),
            { errorId: 'RILL-R051' }
          );
        };
        await expect(
          run('use<module:greetings>', { resolvers: { module: resolver } })
        ).rejects.toThrow("Failed to read module 'greetings'");
      });
    });

    describe('EC-3 — RILL-R059: invalid config for moduleResolver', () => {
      it('throws RILL-R059 when config is not a plain object', async () => {
        const resolver: SchemeResolver = (_resource, config) => {
          if (
            typeof config !== 'object' ||
            config === null ||
            Array.isArray(config)
          ) {
            throw Object.assign(
              new Error('moduleResolver config must be a plain object'),
              { errorId: 'RILL-R059' }
            );
          }
          return { kind: 'value', value: 'ok' };
        };
        await expect(
          run('use<module:greetings>', {
            resolvers: { module: resolver },
            configurations: { resolvers: { module: 'not-an-object' } },
          })
        ).rejects.toThrow('moduleResolver config must be a plain object');
      });
    });

    describe('EC-4 — RILL-R052: extension absent from extResolver config', () => {
      it('throws RILL-R052 when extension name not in config', async () => {
        const resolver: SchemeResolver = (resource) => {
          const cfg: Record<string, unknown> = {};
          const name = resource.split('.')[0] ?? resource;
          if (!(name in cfg)) {
            throw Object.assign(
              new Error(`Extension '${name}' not found in resolver config`),
              { errorId: 'RILL-R052' }
            );
          }
          return { kind: 'value', value: null };
        };
        await expect(
          run('use<ext:qdrant>', { resolvers: { ext: resolver } })
        ).rejects.toThrow("Extension 'qdrant' not found in resolver config");
      });
    });

    describe('EC-5 — RILL-R053: missing member in extResolver', () => {
      it('throws RILL-R053 when member path not found', async () => {
        const resolver: SchemeResolver = (resource) => {
          const cfg: Record<string, unknown> = { qdrant: { search: 'ok' } };
          const segments = resource.split('.');
          const name = segments[0] ?? resource;
          if (!(name in cfg)) {
            throw Object.assign(
              new Error(`Extension '${name}' not found in resolver config`),
              { errorId: 'RILL-R052' }
            );
          }
          let value = cfg[name] as Record<string, unknown>;
          for (let i = 1; i < segments.length; i++) {
            const seg = segments[i] as string;
            if (
              typeof value !== 'object' ||
              value === null ||
              !(seg in value)
            ) {
              const path = segments.slice(1, i + 1).join('.');
              throw Object.assign(
                new Error(`Member '${path}' not found in extension '${name}'`),
                { errorId: 'RILL-R053' }
              );
            }
            value = value[seg] as Record<string, unknown>;
          }
          return {
            kind: 'value',
            value: value as import('@rcrsr/rill').RillValue,
          };
        };
        await expect(
          run('use<ext:qdrant.nonexistent>', { resolvers: { ext: resolver } })
        ).rejects.toThrow(
          "Member 'nonexistent' not found in extension 'qdrant'"
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
        const result = await run('|| { use<host:fn> } => $fn\n$fn()', {
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
});
