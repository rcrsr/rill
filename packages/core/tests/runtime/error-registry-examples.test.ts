/**
 * Rill Runtime Tests: every registry example raises the error it documents
 *
 * Each entry in ERROR_REGISTRY carries `examples: [{ description, code }]`.
 * Running an example's code against the in-test host below must raise the
 * entry's own errorId, so the generated error reference never documents a
 * script that halts with a different id or runs clean.
 *
 * The extension ids (RILL-R017 to RILL-R035) are thrown by in-test stubs, so
 * those cases prove an extension error propagates through `use<ext:...>`
 * unchanged, not that the real extensions raise those ids; the extensions
 * live in other repositories.
 *
 * Two kinds of exception are listed explicitly:
 *
 * - EXCLUDED: ids no script can raise (retired, internal invariants, or
 *   raised by a tool outside this package). Listed with the reason.
 * - HOST_API_CASES: ids raised by a host-side API call rather than by script
 *   text. The example `code` is a comment describing the host call, and the
 *   thunk keyed by `id: description` performs that call for real.
 *
 * REPLACEMENTS pins what each retired entry's documented scenario raises
 * today, so the replacement a retired entry names stays true.
 */

import {
  anyTypeValue,
  contextResolver,
  createConfigFilterResolver,
  createRuntimeContext,
  createTestContext,
  createVector,
  emitExtensionEvent,
  execute,
  extResolver,
  moduleResolver,
  parse,
  resolvePolicy,
  ERROR_REGISTRY,
  RillError,
  RuntimeError,
  RuntimeHaltSignal,
  toCallable,
  type RillValue,
  type RuntimeContext,
  type TimeoutScheduler,
} from '@rcrsr/rill';
import { describe, expect, it } from 'vitest';
import { expectHalt } from '../helpers/halt.js';

// ============================================================
// IN-TEST HOST
// ============================================================

type ContextOptions = NonNullable<Parameters<typeof createRuntimeContext>[0]>;
type StubArgs = Record<string, RillValue>;

/** Timers fire after one millisecond so timeout examples need no real wait. */
const FAST_SCHEDULER: TimeoutScheduler = {
  setTimeout: (fn) => setTimeout(fn, 1),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  },
};

function stub(
  signature: string,
  fn: (args: StubArgs, ctx: RuntimeContext) => RillValue | Promise<RillValue>
): RillValue {
  return toCallable({ signature, fn });
}

/**
 * A host call that never returns. It rejects when the runtime aborts it, as a
 * well-behaved host function does, so a `timeout(...)` block can end it.
 */
function hang(_args: StubArgs, ctx: RuntimeContext): Promise<RillValue> {
  return new Promise<RillValue>((_resolve, reject) => {
    if (ctx.signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    ctx.signal?.addEventListener('abort', () => {
      reject(new Error('aborted'));
    });
  });
}

function fail(
  errorId: string,
  message: string,
  context?: Record<string, unknown>
): never {
  throw new RuntimeError(errorId, message, undefined, context);
}

const FS_MOUNTS: Record<
  string,
  { read: boolean; write: boolean; glob?: RegExp }
> = {
  data: { read: true, write: true },
  csv_only: { read: true, write: false, glob: /\.csv$/ },
  configs: { read: true, write: false, glob: /\.(json|yaml)$/ },
  readonly: { read: true, write: false },
  writeonly: { read: false, write: true },
};

/** Mount rules of a file extension, checked in the order it reports them. */
function fsAccess(
  operation: 'read' | 'write',
  mountName: string,
  path: string
): string {
  const mount = FS_MOUNTS[mountName];
  if (mount === undefined) {
    return fail('RILL-R017', `mount "${mountName}" not configured`, {
      mountName,
    });
  }
  if (path.includes('..') || path.startsWith('symlink_')) {
    return fail('RILL-R018', 'path escapes mount boundary');
  }
  if (mount.glob !== undefined && !mount.glob.test(path)) {
    return fail(
      'RILL-R019',
      `file type not permitted in mount "${mountName}"`,
      { mountName }
    );
  }
  if (!mount[operation]) {
    return fail(
      'RILL-R020',
      `mount "${mountName}" does not permit ${operation}`,
      { mountName, operation }
    );
  }
  if (path === 'protected.txt' || path === 'missing.txt') {
    return fail('RILL-R021', `permission denied: ${path}`, { path });
  }
  return 'contents';
}

const FETCH_FAILURES: Record<string, () => never> = {
  '/nonexistent': () => fail('RILL-R022', 'fetch: HTTP 404 — not found'),
  '/users': () => fail('RILL-R022', 'fetch: HTTP 400 — bad request'),
  '/resource': () => fail('RILL-R023', 'fetch: HTTP 503 after 3 retries'),
  '/slow': () => fail('RILL-R024', 'fetch: request timeout (30000ms)'),
  '/down': () => fail('RILL-R025', 'fetch: network error — ECONNREFUSED'),
  '/html': () => fail('RILL-R026', 'fetch: invalid JSON response'),
};

function fetchRequest(path: string): string {
  const failure = FETCH_FAILURES[path];
  return failure === undefined ? 'body' : failure();
}

/** One agent per failure mode, named after the situation it models. */
const AHI_AGENTS: Record<string, (params: RillValue) => never> = {
  parser: () => fail('RILL-R027', 'ahi: validation failed (HTTP 400)'),
  removed: () => fail('RILL-R028', 'ahi: agent unreachable (HTTP 404)'),
  crashing: () => fail('RILL-R029', 'ahi: downstream exec failed (HTTP 500)'),
  slow: () => fail('RILL-R030', 'ahi: timeout exceeded'),
  offline: () => fail('RILL-R031', 'ahi: connection refused'),
  busy: () => fail('RILL-R032', 'ahi: rate limited (HTTP 429)'),
  disposed: () => fail('RILL-R033', 'ahi: extension disposed'),
  flaky: () => fail('RILL-R034', 'ahi: downstream HTTP 503'),
  unregistered: () => fail('RILL-R035', 'ahi: agent unresolvable'),
};

/** The extension values every example can mount with `use<ext:name>`. */
function stubExtensions(): Record<string, RillValue> {
  const ahi: Record<string, RillValue> = {};
  for (const [agent, raise] of Object.entries(AHI_AGENTS)) {
    ahi[agent] = stub('fn(params: dict): any', (args) => {
      const params = args['params'] ?? {};
      // A validating agent accepts a non-empty params dict.
      if (
        agent === 'parser' &&
        Object.keys(params as Record<string, unknown>).length > 0
      ) {
        return 'parsed';
      }
      return raise(params);
    });
  }
  return {
    app: {
      slow: stub('fn(): any', hang),
      hang: stub('fn(): any', hang),
    },
    fs: {
      read: stub('fn(mount: string, path: string): string', (a) =>
        fsAccess('read', a['mount'] as string, a['path'] as string)
      ),
      write: stub(
        'fn(mount: string, path: string, data: string): string',
        (a) => fsAccess('write', a['mount'] as string, a['path'] as string)
      ),
    },
    fetch: {
      get: stub('fn(api: string, path: string): string', (a) =>
        fetchRequest(a['path'] as string)
      ),
      post: stub('fn(api: string, path: string, body: dict): string', (a) =>
        fetchRequest(a['path'] as string)
      ),
    },
    ahi,
    kb: {
      search: stub('fn(): string', () => 'result'),
      delete: stub('fn(): string', () => 'deleted'),
    },
  };
}

function baseOptions(): ContextOptions {
  return {
    resolvers: {
      ext: extResolver,
      module: moduleResolver,
      context: contextResolver,
    },
    configurations: {
      resolvers: { ext: stubExtensions(), module: {}, context: {} },
    },
    parseSource: parse,
    scheduler: FAST_SCHEDULER,
    functions: {
      slow_api: { params: [], returnType: anyTypeValue, fn: hang },
      returns_date: {
        params: [],
        returnType: anyTypeValue,
        fn: (): RillValue => new Date() as unknown as RillValue,
      },
    },
    variables: {
      hand_built: {
        __type: 'callable',
        kind: 'application',
        fn: () => 1,
      } as unknown as RillValue,
    },
  };
}

/** A kb extension wide enough to exhaust the policy branding budget. */
function wideExtension(): Record<string, RillValue> {
  const wide: Record<string, RillValue> = {};
  for (let i = 0; i < 10_001; i++) {
    wide[`m${i}`] = stub('fn(): string', () => 'ok');
  }
  return wide;
}

function policyOptions(
  policy: Parameters<typeof resolvePolicy>[0],
  kb: RillValue
): ContextOptions {
  const extensions = { ...stubExtensions(), kb };
  return {
    ...baseOptions(),
    configurations: { resolvers: { ext: extensions } },
    filterResolver: createConfigFilterResolver(
      resolvePolicy(policy, new Map(Object.entries(extensions)))
    ),
  };
}

/**
 * Per-id context for examples that need host configuration beyond the base
 * host. Each entry builds the context the example's comment-free script runs
 * against.
 */
const CONTEXTS: Record<string, () => RuntimeContext> = {
  'RILL-R012': () => createRuntimeContext({ ...baseOptions(), timeout: 20 }),
  'RILL-R055': () =>
    createRuntimeContext({
      ...baseOptions(),
      resolvers: {
        ...baseOptions().resolvers,
        module: () => ({ kind: 'source', text: 'use<module:a>' }),
      },
    }),
  'RILL-R056': () =>
    createRuntimeContext({
      ...baseOptions(),
      resolvers: {
        ...baseOptions().resolvers,
        module: () => {
          throw new Error('connection refused');
        },
      },
    }),
  'RILL-R061': () => {
    const options = baseOptions();
    delete options.parseSource;
    return createRuntimeContext({
      ...options,
      resolvers: {
        ...options.resolvers,
        module: () => ({ kind: 'source', text: '"hello"' }),
      },
    });
  },
  'RILL-R088': () =>
    createRuntimeContext(
      policyOptions(
        { kb: { delete: { access: 'deny' } } },
        stubExtensions()['kb'] as RillValue
      )
    ),
  'RILL-R089': () => {
    // The out transform runs a script that calls the same policed method, so
    // its chain reaches back into the transform that is already running.
    const filter = {
      redact: stub('fn(value: any): any', async (_args, ctx) => {
        const { result } = await execute(
          parse('use<ext:kb> => $kb\n$kb.search()'),
          ctx
        );
        return result;
      }),
    };
    const extensions = { ...stubExtensions(), filter };
    return createRuntimeContext({
      ...baseOptions(),
      configurations: { resolvers: { ext: extensions } },
      filterResolver: createConfigFilterResolver(
        resolvePolicy(
          { kb: { search: { access: 'allow', out: ['filter.redact'] } } },
          new Map(Object.entries(extensions))
        )
      ),
    });
  },
  'RILL-R090': () =>
    createRuntimeContext(
      policyOptions({ kb: { '*': { access: 'deny' } } }, wideExtension())
    ),
};

// ============================================================
// HOST API CASES
// ============================================================

const NO_DESCRIPTION_FN = {
  params: [],
  returnType: anyTypeValue,
  fn: (): RillValue => 1,
};

/**
 * Ids raised by a host-side API call. One thunk per example, keyed by `id: description`;
 * each performs the call the example's comment describes.
 */
const HOST_API_CASES: Record<string, () => unknown> = {
  'RILL-R011: Unclosed group in an autoExceptions pattern': () =>
    createRuntimeContext({ autoExceptions: ['(abc'] }),
  'RILL-R011: Unclosed character class in an autoExceptions pattern': () =>
    createRuntimeContext({ autoExceptions: ['[a'] }),
  'RILL-R050: Module absent from the resolver config': () =>
    moduleResolver('greetings', {}),
  'RILL-R051: Module file does not exist': () =>
    moduleResolver('greetings', { greetings: '/nonexistent/greetings.rill' }),
  'RILL-R052: Extension absent from the resolver config': () =>
    extResolver('missing', {}),
  'RILL-R053: Nonexistent member': () =>
    extResolver('app.missing', stubExtensions()),
  'RILL-R059: Non-object config': () => moduleResolver('greetings', null),
  'RILL-R062: Missing top-level key': () => contextResolver('timeout', {}),
  'RILL-R063: Non-dict intermediate segment': () =>
    contextResolver('limits.max_tokens', { limits: 'not a dict' }),
  'RILL-R069: Missing function description': () =>
    createRuntimeContext({
      requireDescriptions: true,
      functions: { greet: NO_DESCRIPTION_FN },
    }),
  'RILL-R070: Missing parameter description': () =>
    createRuntimeContext({
      requireDescriptions: true,
      functions: {
        greet: {
          params: [
            {
              name: 'x',
              type: { kind: 'string' },
              defaultValue: undefined,
              annotations: {},
            },
          ],
          returnType: anyTypeValue,
          annotations: { description: 'Greets' },
          fn: (): RillValue => 1,
        },
      },
    }),
  'RILL-R074: Zero-dimension vector': () =>
    createVector(new Float32Array([]), 'model'),
  'RILL-R075: Empty event field': () =>
    emitExtensionEvent(createRuntimeContext({}), { event: '' }),
  'RILL-R076: Invalid module resource': () =>
    createTestContext({ app: { value: {} } }).resolvers.get('module')?.(
      'unknown'
    ),
  'RILL-R077: Type mismatch in default': () =>
    createRuntimeContext({
      functions: {
        greet: {
          params: [
            {
              name: 'x',
              type: { kind: 'number' },
              defaultValue: 'hello',
              annotations: {},
            },
          ],
          returnType: anyTypeValue,
          fn: (): RillValue => 1,
        },
      },
    }),
  'RILL-R084: Host attempts to invalidate with the reserved "ok" code': () =>
    createRuntimeContext({}).invalidate(new Error('rejected'), {
      code: 'ok',
      provider: 'host',
    }),
  'RILL-R084: Host attempts to invalidate with a code it invented': () =>
    createRuntimeContext({}).invalidate(new Error('rejected'), {
      code: 'PAYMENT_FAILED',
      provider: 'host',
    }),
  'RILL-R086: Wildcard rule declares an out transform': () =>
    resolvePolicy(
      { kb: { '*': { access: 'deny', out: ['filter.redact'] } } },
      new Map()
    ),
  'RILL-R087: Transform reference naming an unmounted extension': () =>
    resolvePolicy(
      { kb: { search: { access: 'allow', out: ['filter.redact'] } } },
      new Map()
    ),
  'RILL-R091: Signature string with an unclosed parameter list': () =>
    createRuntimeContext({
      functions: {
        bad: { signature: 'fn(x: string', fn: (): RillValue => 1 },
      },
    }),
  'RILL-R091: Signature combined with an explicit params list': () =>
    createRuntimeContext({
      functions: {
        bad: {
          signature: 'fn(x: string)',
          params: [],
          fn: (): RillValue => 1,
        } as never,
      },
    }),
};

// ============================================================
// EXCEPTIONS
// ============================================================

/** Ids no example can raise, with the reason. */
const EXCLUDED: Record<string, string> = {
  'RILL-P008':
    'Retired: a bare bracket literal parses as list[...] or dict[...] and no longer raises.',
  'RILL-R013':
    'Retired: host cancellation now halts with #DISPOSED, not RILL-R013.',
  'RILL-R039':
    'Retired: the `:>` variable dispatch form was removed; nothing raises it.',
  'RILL-R041':
    'Retired: a non-integer list dispatch index halts with #INVALID_INPUT.',
  'RILL-R042':
    'Retired: an out-of-range list dispatch index halts with RILL-R009.',
  'RILL-R014':
    'Retired: a string matching an autoExceptions pattern halts with the non-catchable #R999 atom.',
  'RILL-R064':
    'Retired: converting a non-numeric string to number raises RILL-R038.',
  'RILL-R065':
    'Retired: converting an invalid string to bool raises RILL-R036.',
  'RILL-R066':
    'Retired: converting a non-binary number to bool raises RILL-R036.',
  'RILL-R067':
    'Retired: serializing a function to JSON halts with #INVALID_INPUT.',
  'RILL-R068':
    'Internal invariant: raised only when the built-in type table is frozen before methods are populated at module load.',
  'RILL-R071':
    'Internal invariant: raised only when the built-in type table holds a duplicate name; the shipped table never does.',
  'RILL-R072':
    'Internal invariant: raised only when a built-in type lacks a format protocol; the shipped table never does.',
  'RILL-R073':
    'Internal invariant: raised only when a built-in type registers a method twice; the shipped table never does.',
  'RILL-C001': 'Raised by the rill-check command line tool, not by a script.',
  'RILL-C002': 'Raised by the rill-check command line tool, not by a script.',
  'RILL-C003': 'Raised by the rill-check command line tool, not by a script.',
  'RILL-C004': 'Raised by the rill-check auto-fixer, not by a script.',
};

/**
 * What each retired entry's documented scenario raises today. `raises` is the
 * errorId of a RillError, or the halt code of an invalid-value halt.
 */
const REPLACEMENTS: Record<string, string> = {
  'RILL-R014': '#R999',
  'RILL-R041': '#INVALID_INPUT',
  'RILL-R042': 'RILL-R009',
  'RILL-R064': 'RILL-R038',
  'RILL-R065': 'RILL-R036',
  'RILL-R066': 'RILL-R036',
  'RILL-R067': '#INVALID_INPUT',
};

// ============================================================
// RUNNER
// ============================================================

/** The id a failed run raised, or what it raised instead. */
function raisedId(error: unknown): string {
  if (error instanceof RillError) return error.errorId;
  if (error instanceof RuntimeHaltSignal) {
    return (
      error.errorId ?? `halt without a registered id (${String(error.value)})`
    );
  }
  return `unexpected ${String(error)}`;
}

/** Retired entries run in the context their scenario names. */
const REPLACEMENT_CONTEXTS: Record<string, () => RuntimeContext> = {
  'RILL-R014': () =>
    createRuntimeContext({ ...baseOptions(), autoExceptions: ['^ERROR:'] }),
};

async function runScript(code: string, ctx: RuntimeContext): Promise<string> {
  try {
    await execute(parse(code), ctx);
  } catch (error) {
    return raisedId(error);
  }
  return 'completed without raising';
}

async function runExample(
  errorId: string,
  description: string,
  code: string
): Promise<string> {
  const thunk = HOST_API_CASES[`${errorId}: ${description}`];
  if (thunk === undefined) {
    return runScript(
      code,
      CONTEXTS[errorId]?.() ?? createRuntimeContext(baseOptions())
    );
  }
  try {
    await thunk();
  } catch (error) {
    return raisedId(error);
  }
  return 'completed without raising';
}

interface ExampleCase {
  readonly name: string;
  readonly errorId: string;
  readonly description: string;
  readonly code: string;
}

const CASES: ExampleCase[] = [];
for (const [errorId, definition] of ERROR_REGISTRY.entries()) {
  if (errorId in EXCLUDED) continue;
  for (const example of definition.examples ?? []) {
    CASES.push({
      name: `${errorId}: ${example.description}`,
      errorId,
      description: example.description,
      code: example.code,
    });
  }
}

describe('Rill Runtime: error registry examples', () => {
  it('lists only registered ids in the exception tables', () => {
    const listed = [
      ...Object.keys(EXCLUDED),
      ...Object.keys(CONTEXTS),
      ...Object.keys(REPLACEMENTS),
      ...Object.keys(HOST_API_CASES).map((key) => key.split(': ')[0] ?? key),
    ];
    for (const errorId of listed) {
      expect(ERROR_REGISTRY.has(errorId)).toBe(true);
    }
  });

  it('provides exactly one host call per host API example', () => {
    const exampleKeys = CASES.map((c) => c.name);
    const thunkKeys = Object.keys(HOST_API_CASES);
    for (const key of thunkKeys) {
      expect(exampleKeys.filter((name) => name === key)).toHaveLength(1);
    }
    for (const name of new Set(exampleKeys)) {
      const id = name.split(': ')[0] ?? name;
      const idHasThunk = thunkKeys.some((key) => key.startsWith(`${id}: `));
      if (idHasThunk) {
        expect(thunkKeys).toContain(name);
      }
    }
  });

  it('keeps example names unique within the registry', () => {
    const names = CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(CASES)('$name', async ({ errorId, description, code }) => {
    expect(await runExample(errorId, description, code)).toBe(errorId);
  });

  it.each(Object.entries(REPLACEMENTS))(
    'raises %s replacement from its documented scenario',
    async (errorId, raises) => {
      const example = ERROR_REGISTRY.get(errorId)?.examples?.[0];
      expect(example).toBeDefined();
      const ctx =
        REPLACEMENT_CONTEXTS[errorId]?.() ??
        createRuntimeContext(baseOptions());
      const code = example?.code ?? '';
      if (raises.startsWith('#')) {
        await expectHalt(() => execute(parse(code), ctx), {
          code: raises.slice(1),
        });
      } else {
        expect(await runScript(code, ctx)).toBe(raises);
      }
    }
  );
});
