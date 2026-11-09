/**
 * Mock host for the rill example harness: host functions, input variables,
 * and the `ext` extension dict that documentation examples run against.
 */

import {
  anyTypeValue,
  toCallable,
  type CallableFn,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';

// Compact mock declaration: parameter types are written `{ type: 'string' }`
// and normalized to the runtime's `RillFunction` shape by `toRillFunction`.
interface MockParam {
  readonly name: string;
  readonly type?: { readonly type: string };
  readonly defaultValue?: RillValue;
}

interface MockFunction {
  readonly params: readonly MockParam[];
  readonly fn: CallableFn;
}

function toRillFunction(mock: MockFunction): RillFunction {
  return {
    params: mock.params.map((p) => ({
      name: p.name,
      type: p.type ? { kind: p.type.type } : undefined,
      defaultValue: p.defaultValue,
      annotations: {},
    })),
    fn: mock.fn,
    returnType: anyTypeValue,
  };
}

function toRillFunctions(
  mocks: Record<string, MockFunction>
): Record<string, RillFunction> {
  return Object.fromEntries(
    Object.entries(mocks).map(([name, mock]) => [name, toRillFunction(mock)])
  );
}

// Generate the member table for a vector DB namespace (chroma, pinecone, qdrant)
function vectorDbMocks(): Record<string, MockFunction> {
  const point = {
    id: 'doc-1',
    score: 0.95,
    vector: [0.1, 0.2, 0.3],
    metadata: { title: 'Example' },
    payload: { title: 'Example' },
    values: [0.1, 0.2, 0.3],
    status: 'ok',
  };
  return {
    upsert: {
      params: [
        { name: 'id', type: { type: 'string' } },
        { name: 'vector', type: { type: 'list' } },
        { name: 'metadata', type: { type: 'dict' }, defaultValue: {} },
      ],
      fn: () => ({
        success: true,
        upsertedCount: 1,
        deleted: true,
        status: 'ok',
      }),
    },
    upsert_batch: {
      params: [{ name: 'items', type: { type: 'list' } }],
      fn: () => ({ succeeded: 2, upsertedCount: 2, status: 'ok' }),
    },
    search: {
      params: [{ name: 'vector' }, { name: 'options' }],
      fn: () => [point],
    },
    get: {
      params: [{ name: 'id', type: { type: 'string' } }],
      fn: () => point,
    },
    delete: {
      params: [{ name: 'id', type: { type: 'string' } }],
      fn: () => ({ deleted: true, status: 'ok' }),
    },
    delete_batch: {
      params: [{ name: 'ids', type: { type: 'list' } }],
      fn: () => ({ succeeded: 3, status: 'ok' }),
    },
    count: {
      params: [],
      fn: () => ({ count: 42, vectorCount: 42 }),
    },
    create_collection: {
      params: [
        { name: 'name', type: { type: 'string' } },
        { name: 'options', type: { type: 'dict' }, defaultValue: {} },
      ],
      fn: () => ({ created: true, name: 'test', status: 'ok' }),
    },
    delete_collection: {
      params: [{ name: 'name', type: { type: 'string' } }],
      fn: () => ({ deleted: true, status: 'ok' }),
    },
    list_collections: {
      params: [],
      fn: () => ({ collections: ['col1', 'col2'] }),
    },
    describe: {
      params: [],
      fn: () => ({
        name: 'test',
        count: 42,
        dimension: 3,
        metric: 'cosine',
        totalVectorCount: 42,
        vectors_count: 42,
        config: { params: { vectors: { size: 3 } } },
      }),
    },
  };
}
// Bare host functions, callable without a namespace. Built-in functions
// (enumerate, identity, json, log, parse_*, range, repeat, type) and methods
// (.len, .trim, .upper, .lower, .join, etc.) are NOT mocked here.
export function createMockFunctions(): Record<string, RillFunction> {
  const mocks: Record<string, MockFunction> = {
    prompt: {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => 'mock LLM response',
    },
    fetch: {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: () => '{"status": "ok"}',
    },
    fetch_page: {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: () => '<html>page</html>',
    },
    exec: {
      params: [{ name: 'cmd', type: { type: 'string' } }],
      fn: () => ['output', 0],
    },
    error: {
      params: [{ name: 'msg', type: { type: 'string' } }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    process: {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'processed',
    },
    proceed: {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'proceeded',
    },
    handle: {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'handled',
    },
    validate: {
      params: [{ name: 'value', type: { type: 'string' } }],
      fn: (v) => v,
    },
    check_status: { params: [{ name: 'value' }], fn: () => 'ok' },
    get_page: {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: () => '<html></html>',
    },
    retry: {
      params: [{ name: 'action', type: { type: 'string' } }],
      fn: () => 'retried',
    },
    process_config: {
      params: [{ name: 'config', type: { type: 'string' } }],
      fn: (v) => v,
    },
    process_content: {
      params: [{ name: 'content', type: { type: 'string' } }],
      fn: (v) => v,
    },
    save_content: {
      params: [{ name: 'content', type: { type: 'string' } }],
      fn: () => true,
    },
    command: {
      params: [{ name: 'cmd', type: { type: 'string' } }],
      fn: () => 'output',
    },
    attempt: {
      params: [{ name: 'action', type: { type: 'string' } }],
      fn: () => 'success',
    },
    pause: {
      params: [{ name: 'ms', type: { type: 'number' } }],
      fn: () => null,
    },
    slow_process: {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'processed',
    },
  };
  return toRillFunctions(mocks);
}

// Extension mocks keyed by namespace. Scripts reach them through
// `use<ext:ns> => $ns` and then `$ns.fn(...)`.
export function createMockExtensions(): Record<string, RillValue> {
  const extensions: Record<string, Record<string, MockFunction>> = {
    app: {
      prompt: {
        params: [{ name: 'text', type: { type: 'string' } }],
        fn: () => 'mock LLM response',
      },
      fetch: {
        params: [{ name: 'url', type: { type: 'string' } }],
        fn: () => '{"status": "ok"}',
      },
      read: {
        params: [{ name: 'path', type: { type: 'string' } }],
        fn: () => 'file contents',
      },
      write: {
        params: [
          { name: 'path', type: { type: 'string' } },
          { name: 'content', type: { type: 'string' } },
        ],
        fn: () => true,
      },
      exec: {
        params: [{ name: 'cmd', type: { type: 'string' } }],
        fn: () => ['output', 0],
      },
      error: {
        params: [{ name: 'msg', type: { type: 'string' } }],
        fn: (msg) => {
          throw new Error(String(msg));
        },
      },
      embed: {
        params: [
          { name: 'text', type: { type: 'string' } },
          {
            name: 'model',
            type: { type: 'string' },
            defaultValue: 'mock-embed',
          },
        ],
        fn: (_text, model) => ({
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: String(model),
        }),
      },
      sleep: {
        params: [{ name: 'ms', type: { type: 'number' } }],
        fn: () => null,
      },
      process: {
        params: [{ name: 'input', type: { type: 'string' } }],
        fn: () => 'processed',
      },
      flag: {
        params: [{ name: 'input', type: { type: 'string' } }],
        fn: () => 'flagged',
      },
      // classify plus handle_billing back the dispatch-table example in the
      // root README. classify returns a dict so `.category` resolves to a key
      // present in that table.
      classify: {
        params: [{ name: 'input', type: { type: 'string' } }],
        fn: () => ({ category: 'billing', confidence: 0.9 }),
      },
      handle_billing: {
        params: [{ name: 'input', type: { type: 'string' } }],
        fn: () => 'billing handled',
      },
      validate: {
        params: [{ name: 'value', type: { type: 'string' } }],
        fn: (v) => v,
      },
      command: {
        params: [{ name: 'cmd', type: { type: 'string' } }],
        fn: () => 'output',
      },
      attempt: {
        params: [{ name: 'action', type: { type: 'string' } }],
        fn: () => 'success',
      },
      pause: {
        params: [{ name: 'ms', type: { type: 'number' } }],
        fn: () => null,
      },
      call: {
        params: [
          { name: 'fn_name', type: { type: 'string' } },
          { name: 'args', type: { type: 'dict' } },
        ],
        fn: () => 'called',
      },
      skip: {
        params: [{ name: 'reason', type: { type: 'string' } }],
        fn: () => null,
      },
    },
    math: {
      add: {
        params: [
          { name: 'a', type: { type: 'number' } },
          { name: 'b', type: { type: 'number' } },
        ],
        fn: (args) => (args['a'] as number) + (args['b'] as number),
      },
      multiply: {
        params: [
          { name: 'a', type: { type: 'number' } },
          { name: 'b', type: { type: 'number' } },
        ],
        fn: (args) => (args['a'] as number) * (args['b'] as number),
      },
    },
    str: {
      upper: {
        params: [{ name: 'text', type: { type: 'string' } }],
        fn: (args) => String(args['text']).toUpperCase(),
      },
      lower: {
        params: [{ name: 'text', type: { type: 'string' } }],
        fn: (args) => String(args['text']).toLowerCase(),
      },
    },
    anthropic: {
      message: {
        params: [
          { name: 'text', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          messages: [],
        }),
      },
      messages: {
        params: [
          { name: 'messages', type: { type: 'list' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          messages: [],
        }),
      },
      embed: {
        params: [{ name: 'text', type: { type: 'string' } }],
        fn: () => ({
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: 'mock-embed',
        }),
      },
      embed_batch: {
        params: [{ name: 'texts', type: { type: 'list' } }],
        fn: () => [
          {
            __rill_vector: true,
            data: new Float32Array([0.1, 0.2, 0.3]),
            model: 'mock-embed',
          },
        ],
      },
      tool_loop: {
        params: [
          { name: 'prompt', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          turns: 1,
          messages: [],
        }),
      },
      generate: {
        params: [
          { name: 'prompt', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          data: {
            name: 'rill',
            confidence: 0.95,
            tags: ['scripting', 'pipes'],
          },
          raw: '{"name":"rill","confidence":0.95,"tags":["scripting","pipes"]}',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'end_turn',
          id: 'mock-id',
        }),
      },
    },
    openai: {
      message: {
        params: [
          { name: 'text', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          messages: [],
        }),
      },
      messages: {
        params: [
          { name: 'messages', type: { type: 'list' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          messages: [],
        }),
      },
      embed: {
        params: [{ name: 'text', type: { type: 'string' } }],
        fn: () => ({
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: 'mock-embed',
        }),
      },
      embed_batch: {
        params: [{ name: 'texts', type: { type: 'list' } }],
        fn: () => [
          {
            __rill_vector: true,
            data: new Float32Array([0.1, 0.2, 0.3]),
            model: 'mock-embed',
          },
        ],
      },
      tool_loop: {
        params: [
          { name: 'prompt', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          content: 'mock response',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
          turns: 1,
          messages: [],
        }),
      },
      generate: {
        params: [
          { name: 'prompt', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' }, defaultValue: {} },
        ],
        fn: () => ({
          data: { name: 'Alice', age: 30, active: true },
          raw: '{"name":"Alice","age":30,"active":true}',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'stop',
          id: 'mock-id',
        }),
      },
    },
    llm: {
      generate: {
        params: [
          { name: 'prompt', type: { type: 'string' } },
          { name: 'options', type: { type: 'dict' } },
        ],
        fn: () => ({
          data: { name: 'Alice', age: 30, active: true },
          raw: '{"name":"Alice","age":30,"active":true}',
          model: 'mock-model',
          usage: { input: 10, output: 20 },
          stop_reason: 'end_turn',
          id: 'mock-id',
        }),
      },
    },
    chroma: vectorDbMocks(),
    pinecone: vectorDbMocks(),
    qdrant: vectorDbMocks(),
  };
  return Object.fromEntries(
    Object.entries(extensions).map(([ns, members]) => [
      ns,
      Object.fromEntries(
        Object.entries(members).map(([name, mock]) => [
          name,
          toCallable(toRillFunction(mock)),
        ])
      ) as unknown as RillValue,
    ])
  );
}

// Common mock variables for examples - only input variables, not ones typically assigned
export function createMockVariables(): Record<string, RillValue> {
  return {
    // Input variables commonly read in examples
    prompt: 'test prompt',
    text: 'sample text',
    query: 'search query',
    embedding: {
      __rill_vector: true,
      data: new Float32Array([0.1, 0.2, 0.3]),
      model: 'mock-embed',
    },
    email: 'test@example.com',
    article: { description: 'mock description' },
    items: ['a', 'b', 'c'],
    list: [1, 2, 3],
    config: { key: 'value', count: 42 },
    data: { items: [1, 2, 3], name: 'test' },
    input: 'mock input',
    task: 'refund request',
    response: 'mock LLM response',
    file: '/path/to/file.txt',
    // Pre-populated vectors for examples
    vec: {
      __rill_vector: true,
      data: new Float32Array([0.1, 0.2, 0.3]),
      model: 'mock-embed',
    },
    v1: {
      __rill_vector: true,
      data: new Float32Array([0.1, 0.2, 0.3]),
      model: 'mock-embed',
    },
    v2: {
      __rill_vector: true,
      data: new Float32Array([0.1, 0.2, 0.3]),
      model: 'mock-embed',
    },
  };
}
