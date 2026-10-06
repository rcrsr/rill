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

// Generate mock functions for a vector DB namespace (chroma, pinecone, qdrant)
function vectorDbMocks(ns: string): Record<string, MockFunction> {
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
    [`${ns}::upsert`]: {
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
    [`${ns}::upsert_batch`]: {
      params: [{ name: 'items', type: { type: 'list' } }],
      fn: () => ({ succeeded: 2, upsertedCount: 2, status: 'ok' }),
    },
    [`${ns}::search`]: {
      params: [{ name: 'vector' }, { name: 'options' }],
      fn: () => [point],
    },
    [`${ns}::get`]: {
      params: [{ name: 'id', type: { type: 'string' } }],
      fn: () => point,
    },
    [`${ns}::delete`]: {
      params: [{ name: 'id', type: { type: 'string' } }],
      fn: () => ({ deleted: true, status: 'ok' }),
    },
    [`${ns}::delete_batch`]: {
      params: [{ name: 'ids', type: { type: 'list' } }],
      fn: () => ({ succeeded: 3, status: 'ok' }),
    },
    [`${ns}::count`]: {
      params: [],
      fn: () => ({ count: 42, vectorCount: 42 }),
    },
    [`${ns}::create_collection`]: {
      params: [
        { name: 'name', type: { type: 'string' } },
        { name: 'options', type: { type: 'dict' }, defaultValue: {} },
      ],
      fn: () => ({ created: true, name: 'test', status: 'ok' }),
    },
    [`${ns}::delete_collection`]: {
      params: [{ name: 'name', type: { type: 'string' } }],
      fn: () => ({ deleted: true, status: 'ok' }),
    },
    [`${ns}::list_collections`]: {
      params: [],
      fn: () => ({ collections: ['col1', 'col2'] }),
    },
    [`${ns}::describe`]: {
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

// Mock host functions - all prefixed with app:: to clearly mark as host-provided
// Built-in functions (enumerate, identity, json, log, parse_*, range, repeat, type)
// and methods (.len, .trim, .upper, .lower, .join, etc.) are NOT mocked here
export function createMockFunctions(): Record<string, RillFunction> {
  const mocks: Record<string, MockFunction> = {
    // Primary app:: namespace (preferred convention for docs)
    'app::prompt': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => 'mock LLM response',
    },
    'app::fetch': {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: () => '{"status": "ok"}',
    },
    'app::read': {
      params: [{ name: 'path', type: { type: 'string' } }],
      fn: () => 'file contents',
    },
    'app::write': {
      params: [
        { name: 'path', type: { type: 'string' } },
        { name: 'content', type: { type: 'string' } },
      ],
      fn: () => true,
    },
    'app::exec': {
      params: [{ name: 'cmd', type: { type: 'string' } }],
      fn: () => ['output', 0],
    },
    'app::error': {
      params: [{ name: 'msg', type: { type: 'string' } }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    // Mock embedding function for vector examples
    'app::embed': {
      params: [
        { name: 'text', type: { type: 'string' } },
        { name: 'model', type: { type: 'string' }, defaultValue: 'mock-embed' },
      ],
      fn: (_text, model) => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: String(model),
      }),
    },
    'app::sleep': {
      params: [{ name: 'ms', type: { type: 'number' } }],
      fn: () => null,
    },
    'app::process': {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'processed',
    },
    'app::flag': {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'flagged',
    },
    // Classify plus handle_billing back the dispatch-table example in the
    // root README. classify returns a dict so `.category` resolves to a key
    // present in that table. classify always returns 'billing', so only the
    // billing arm of the dispatch table is ever evaluated; the technical and
    // general handler mocks were dropped since nothing exercises them.
    'app::classify': {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => ({ category: 'billing', confidence: 0.9 }),
    },
    'app::handle_billing': {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () => 'billing handled',
    },
    'app::validate': {
      params: [{ name: 'value', type: { type: 'string' } }],
      fn: (v) => v,
    },
    'app::command': {
      params: [{ name: 'cmd', type: { type: 'string' } }],
      fn: () => 'output',
    },
    'app::attempt': {
      params: [{ name: 'action', type: { type: 'string' } }],
      fn: () => 'success',
    },
    'app::pause': {
      params: [{ name: 'ms', type: { type: 'number' } }],
      fn: () => null,
    },
    'app::call': {
      params: [
        { name: 'fn_name', type: { type: 'string' } },
        { name: 'args', type: { type: 'dict' } },
      ],
      fn: () => 'called',
    },

    // IO namespace
    'io::read': {
      params: [{ name: 'path', type: { type: 'string' } }],
      fn: () => 'file contents',
    },
    'io::write': {
      params: [
        { name: 'path', type: { type: 'string' } },
        { name: 'content', type: { type: 'string' } },
      ],
      fn: () => true,
    },
    'io::file::read': {
      params: [{ name: 'path', type: { type: 'string' } }],
      fn: () => 'file contents',
    },
    'io::file::write': {
      params: [
        { name: 'path', type: { type: 'string' } },
        { name: 'content', type: { type: 'string' } },
      ],
      fn: () => true,
    },

    // Math namespace
    'math::add': {
      params: [
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (args) => (args['a'] as number) + (args['b'] as number),
    },
    'math::multiply': {
      params: [
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (args) => (args['a'] as number) * (args['b'] as number),
    },

    // HTTP namespace
    'http::get': {
      params: [{ name: 'url', type: { type: 'string' } }],
      fn: () => '{"data": "mock"}',
    },
    'http::post': {
      params: [
        { name: 'url', type: { type: 'string' } },
        { name: 'data', type: { type: 'string' } },
      ],
      fn: () => '{"status": "ok"}',
    },

    // String namespace (for host-provided string utils, not built-in methods)
    'str::upper': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: (s) => String(s).toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: (s) => String(s).toLowerCase(),
    },

    // FS namespace (supports both 2-param and 3-param mount-based signatures)
    'fs::read': {
      params: [
        { name: 'mount_or_path', type: { type: 'string' } },
        { name: 'path', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => 'file contents',
    },
    'fs::write': {
      params: [
        { name: 'mount_or_path', type: { type: 'string' } },
        { name: 'path_or_content', type: { type: 'string' } },
        { name: 'content', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => true,
    },

    // KV namespace (supports both 2-param and 3-param mount-based signatures)
    // 2-param: kv::set(key, value) - for rill app mode
    // 3-param: kv::set(mount, key, value) - for host integration with mounts
    'kv::set': {
      params: [
        { name: 'key_or_mount', type: { type: 'string' } },
        { name: 'value_or_key' },
        { name: 'value', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => true,
    },
    'kv::get': {
      params: [
        { name: 'key_or_mount', type: { type: 'string' } },
        { name: 'key', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: (args) => {
        const keyOrMount = args['key_or_mount'] as string;
        const keyParam = args['key'] as string;
        const key = !keyParam ? keyOrMount : keyParam;
        // Return appropriate test values for common keys
        if (key === 'user_count' || key === 'run_count') return 42;
        if (key === 'last_sync') return '2024-01-15';
        if (key.startsWith('cache:')) return 'cached_value';
        if (key === 'name') return 'Alice';
        return 'mock_value';
      },
    },
    'kv::delete': {
      params: [
        { name: 'key_or_mount', type: { type: 'string' } },
        { name: 'key', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => true,
    },
    'kv::has': {
      params: [
        { name: 'key_or_mount', type: { type: 'string' } },
        { name: 'key', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => true,
    },
    'kv::keys': {
      params: [],
      fn: () => ['key1', 'key2', 'key3'],
    },
    'kv::getAll': {
      params: [],
      fn: () => ({ key1: 'value1', key2: 'value2' }),
    },
    'kv::clear': {
      params: [],
      fn: () => true,
    },
    'kv::schema': {
      params: [],
      fn: () => [],
    },

    // crypto:: namespace
    'crypto::uuid': {
      params: [],
      fn: () => '550e8400-e29b-41d4-a716-446655440000',
    },
    'crypto::hash': {
      params: [
        { name: 'input', type: { type: 'string' } },
        { name: 'algo', type: { type: 'string' }, defaultValue: 'sha256' },
      ],
      fn: () =>
        'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    },
    'crypto::hmac': {
      params: [{ name: 'input', type: { type: 'string' } }],
      fn: () =>
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    },
    'crypto::random': {
      params: [{ name: 'bytes', type: { type: 'number' }, defaultValue: 32 }],
      fn: () =>
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    },

    // newsapi:: namespace
    'newsapi::headlines': {
      params: [],
      fn: () => [
        { title: 'Breaking News', source: { name: 'Reuters' } },
        { title: 'Tech Update', source: { name: 'AP' } },
      ],
    },
    'newsapi::top_headlines': {
      params: [
        { name: 'country' },
        { name: 'pageSize', type: { type: 'number' }, defaultValue: 10 },
      ],
      fn: () => [{ title: 'Breaking News', source: { name: 'Reuters' } }],
    },

    // api:: namespace
    'api::get_users': {
      params: [{ name: 'limit' }],
      fn: () => [{ name: 'Alice' }, { name: 'Bob' }],
    },
    'api::endpoints': {
      params: [],
      fn: () => [
        {
          name: 'get_users',
          method: 'GET',
          path: '/users',
          description: 'List users',
        },
      ],
    },

    // sh:: namespace (exec extension)
    'sh::git_status': {
      params: [],
      fn: () => ({ stdout: 'On branch main', stderr: '', exitCode: 0 }),
    },
    'sh::commands': {
      params: [],
      fn: () => [{ name: 'git_status', description: 'Run git status' }],
    },
    'sh::jq': {
      params: [
        { name: 'filter', type: { type: 'string' } },
        { name: 'input', type: { type: 'string' }, defaultValue: '' },
      ],
      fn: () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
    },

    // Extension examples (ai::, claude_code::)
    'ai::greet': {
      params: [{ name: 'name', type: { type: 'string' } }],
      fn: (name) => `Hello, ${name}!`,
    },
    'claude_code::prompt': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => 'mock Claude Code response',
    },
    'claude_code::skill': {
      params: [
        { name: 'name', type: { type: 'string' } },
        { name: 'args', type: { type: 'dict' } },
      ],
      fn: () => 'skill executed',
    },
    'claude_code::command': {
      params: [
        { name: 'name', type: { type: 'string' } },
        { name: 'args', type: { type: 'dict' } },
      ],
      fn: () => 'command executed',
    },

    // anthropic:: namespace
    'anthropic::message': {
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
    'anthropic::messages': {
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
    'anthropic::embed': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'anthropic::embed_batch': {
      params: [{ name: 'texts', type: { type: 'list' } }],
      fn: () => [
        {
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: 'mock-embed',
        },
      ],
    },
    'anthropic::tool_loop': {
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
    'anthropic::generate': {
      params: [
        { name: 'prompt', type: { type: 'string' } },
        { name: 'options', type: { type: 'dict' }, defaultValue: {} },
      ],
      fn: () => ({
        data: { name: 'rill', confidence: 0.95, tags: ['scripting', 'pipes'] },
        raw: '{"name":"rill","confidence":0.95,"tags":["scripting","pipes"]}',
        model: 'mock-model',
        usage: { input: 10, output: 20 },
        stop_reason: 'end_turn',
        id: 'mock-id',
      }),
    },

    // MCP extension namespaces (fs::, gh::, pg::, db::, ai::)
    'fs::list_tools': {
      params: [],
      fn: () => [
        { name: 'read_file', description: 'Read file contents' },
        { name: 'write_file', description: 'Write to file' },
        { name: 'list_directory', description: 'List directory contents' },
      ],
    },
    'fs::read_file': {
      params: [{ name: 'options', type: { type: 'dict' } }],
      fn: () => ({ content: 'mock file content' }),
    },
    'fs::list_resources': {
      params: [],
      fn: () => [{ uri: 'file:///tmp/test.txt', mime: 'text/plain' }],
    },
    'fs::list_prompts': {
      params: [],
      fn: () => [{ name: 'summarize', arguments: ['text'] }],
    },
    'gh::list_pull_requests': {
      params: [{ name: 'options', type: { type: 'dict' }, defaultValue: {} }],
      fn: () => [
        { number: 42, title: 'Fix bug', state: 'open' },
        { number: 43, title: 'Add feature', state: 'open' },
      ],
    },
    'pg::query': {
      params: [{ name: 'options', type: { type: 'dict' } }],
      fn: () => ({ status: 'deployed' }),
    },
    'db::read_query': {
      params: [{ name: 'options', type: { type: 'dict' } }],
      fn: () => [
        { name: 'Acme Corp', revenue: 1000000 },
        { name: 'Tech Inc', revenue: 800000 },
      ],
    },
    'ai::message': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => ({
        content: 'mock AI analysis',
        model: 'mock-model',
      }),
    },

    // openai:: namespace
    'openai::message': {
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
    'openai::messages': {
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
    'openai::embed': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'openai::embed_batch': {
      params: [{ name: 'texts', type: { type: 'list' } }],
      fn: () => [
        {
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: 'mock-embed',
        },
      ],
    },
    'openai::tool_loop': {
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
    'openai::generate': {
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

    // gemini:: namespace
    'gemini::message': {
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
    'gemini::messages': {
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
    'gemini::embed': {
      params: [{ name: 'text', type: { type: 'string' } }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'gemini::embed_batch': {
      params: [{ name: 'texts', type: { type: 'list' } }],
      fn: () => [
        {
          __rill_vector: true,
          data: new Float32Array([0.1, 0.2, 0.3]),
          model: 'mock-embed',
        },
      ],
    },
    'gemini::tool_loop': {
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
    'gemini::generate': {
      params: [
        { name: 'prompt', type: { type: 'string' } },
        { name: 'options', type: { type: 'dict' }, defaultValue: {} },
      ],
      fn: () => ({
        data: { name: 'rill', confidence: 0.95, tags: ['scripting', 'pipes'] },
        raw: '{"name":"rill","confidence":0.95,"tags":["scripting","pipes"]}',
        model: 'mock-model',
        usage: { input: 10, output: 20 },
        stop_reason: 'stop',
        id: 'mock-id',
      }),
    },

    // llm:: namespace (provider-agnostic)
    'llm::generate': {
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

    // Vector DB extensions (chroma::, pinecone::, qdrant::)
    ...vectorDbMocks('chroma'),
    ...vectorDbMocks('pinecone'),
    ...vectorDbMocks('qdrant'),

    // Legacy unnamespaced - these should be migrated to app:: in docs
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
    'app::skip': {
      params: [{ name: 'reason', type: { type: 'string' } }],
      fn: () => null,
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

// Group the flat `ns::fn` mock functions into per-namespace dicts so the
// extResolver can satisfy `use<ext:ns> => $ns` + `$ns.fn(...)` dotted access.
export function createExtExtensionDict(
  functions: Record<string, RillFunction>
): Record<string, RillValue> {
  const extensions: Record<string, Record<string, RillValue>> = {};
  for (const [fullName, fn] of Object.entries(functions)) {
    const sep = fullName.indexOf('::');
    if (sep === -1) continue;
    const ns = fullName.slice(0, sep);
    const rest = fullName.slice(sep + 2);
    // Only handle single-level namespaces (ns::method). Skip nested forms
    // like io::file::read — those stay in the flat registry.
    if (rest.includes('::')) continue;
    if (!extensions[ns]) extensions[ns] = {};
    extensions[ns][rest] = toCallable(fn) as unknown as RillValue;
  }
  const out: Record<string, RillValue> = {};
  for (const [ns, members] of Object.entries(extensions)) {
    out[ns] = members as unknown as RillValue;
  }
  return out;
}
