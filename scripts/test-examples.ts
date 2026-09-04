#!/usr/bin/env npx tsx
/**
 * Test rill code examples from markdown files
 *
 * Usage:
 *   npx tsx scripts/test-examples.ts docs/guide.md
 *   npx tsx scripts/test-examples.ts docs/
 *
 * Mock host functions are provided with app:: namespace.
 * Unknown functions are tracked and reported.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  createRuntimeContext,
  execute,
  extResolver,
  formatRillLiteral,
  formatValue,
  isCallable,
  parse,
  RillError,
  toCallable,
  type RillFunction,
  type RillValue,
  type ScriptNode,
} from '@rcrsr/rill';

interface CodeBlock {
  code: string;
  lineNumber: number;
  file: string;
  expectedResult?: string;
}

interface TestResult {
  block: CodeBlock;
  success: boolean;
  error?: string;
  errorColumn?: number;
  skipped?: boolean;
  skipReason?: string;
}

// Track unknown functions across all tests
const unknownFunctions = new Map<string, Set<string>>();

function trackUnknownFunction(name: string, location: string): void {
  if (!unknownFunctions.has(name)) {
    unknownFunctions.set(name, new Set());
  }
  unknownFunctions.get(name)!.add(location);
}

// Generate mock functions for a vector DB namespace (chroma, pinecone, qdrant)
function vectorDbMocks(ns: string): Record<string, RillFunction> {
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
function createMockFunctions(): Record<string, RillFunction> {
  return {
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
      fn: (a, b) => (a as number) + (b as number),
    },
    'math::multiply': {
      params: [
        { name: 'a', type: { type: 'number' } },
        { name: 'b', type: { type: 'number' } },
      ],
      fn: (a, b) => (a as number) * (b as number),
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
        const keyOrMount = args.key_or_mount as string;
        const keyParam = args.key as string;
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
}

function extractRillBlocks(content: string, filePath: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let blockLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith('```rill')) {
      inBlock = true;
      blockStart = i + 1; // 1-indexed line number
      blockLines = [];
    } else if (inBlock && line.trim() === '```') {
      inBlock = false;
      // Capture the LAST `# Result:` annotation in the block
      let expectedResult: string | undefined;
      for (const bl of blockLines) {
        const resultMatch = bl.trim().match(/^# Result:\s*(.*)$/);
        if (resultMatch) {
          expectedResult = resultMatch[1]!;
        }
      }
      blocks.push({
        code: blockLines.join('\n'),
        lineNumber: blockStart + 1, // Line after the opening fence
        file: filePath,
        ...(expectedResult !== undefined ? { expectedResult } : {}),
      });
    } else if (inBlock) {
      blockLines.push(line);
    }
  }

  return blocks;
}

function findMarkdownFiles(targetPath: string): string[] {
  const stat = fs.statSync(targetPath);

  if (stat.isFile()) {
    return targetPath.endsWith('.md') ? [targetPath] : [];
  }

  if (stat.isDirectory()) {
    const files: string[] = [];
    const entries = fs.readdirSync(targetPath);

    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry);
      const entryStat = fs.statSync(fullPath);

      if (entryStat.isFile() && entry.endsWith('.md')) {
        files.push(fullPath);
      } else if (entryStat.isDirectory() && !entry.startsWith('.')) {
        files.push(...findMarkdownFiles(fullPath));
      }
    }

    return files;
  }

  return [];
}

// Strip YAML frontmatter and extract variables
function processFrontmatter(code: string): {
  code: string;
  variables: Record<string, RillValue>;
} {
  const frontmatterMatch = code.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { code, variables: {} };
  }

  const frontmatter = frontmatterMatch[1]!;
  const restCode = frontmatterMatch[2]!;
  const variables: Record<string, RillValue> = {};

  // Parse simple YAML-like args: "args: name: type, name2: type2"
  const argsMatch = frontmatter.match(/args:\s*(.+)/);
  if (argsMatch) {
    const argPairs = argsMatch[1]!.split(',');
    for (const pair of argPairs) {
      const nameMatch = pair.trim().match(/^(\w+):/);
      if (nameMatch) {
        // Provide mock values based on type hints
        const name = nameMatch[1]!;
        if (pair.includes('string')) {
          variables[name] = 'mock_' + name;
        } else if (pair.includes('number')) {
          variables[name] = 42;
        } else if (pair.includes('bool')) {
          variables[name] = true;
        } else {
          variables[name] = 'mock_value';
        }
      }
    }
  }

  return { code: restCode, variables };
}

// A line that is entirely an ellipsis-continuation comment, e.g. "# ... later use $x".
const ELLIPSIS_LINE_RE = /^[ \t]*#[ \t]+\.\.\./;
// The comment-marker form of an expected-error annotation: a `#` that starts
// a comment (preceded by line-start or whitespace), not a literal "# Error:"
// occurring inside a quoted string on an otherwise-executable line.
const ERROR_MARKER_LINE_RE = /(^|\s)# (Error|ERROR|error):/;
// A rill error code, e.g. `RILL-R010` or `RILL_P007`. When a `# Error:`
// marker's text carries one, testBlock additionally asserts the caught
// error message contains it — a cheap strengthening on top of the baseline
// halt-only assertion, since marker prose otherwise varies across docs.
const ERROR_CODE_TOKEN_RE = /RILL[-_][RPLC]\d+/;

// True if the line's `# Error:`-style marker sits inside an unclosed string
// literal rather than starting a real comment, e.g. `"see # Error: docs"`.
function markerInsideStringLiteral(line: string): boolean {
  const match = ERROR_MARKER_LINE_RE.exec(line);
  if (!match) return false;
  const before = line.slice(0, match.index);
  const quoteCount = (before.match(/(?<!\\)"/g) ?? []).length;
  return quoteCount % 2 === 1;
}

// Strip a contiguous run of ellipsis continuation lines (`# ...`) from the
// trailing edge of the block, walking backward past blank lines. These are
// pure narrative markers with no rill semantics, so they cannot be left in
// the code the way `# Error:` markers can. Only trailing ellipsis lines are
// exempt from execution — one followed by further executable code is left
// untouched, and only that trailing line is skipped.
//
// `# Error:`-style markers are NOT stripped here. The rill lexer already
// treats `#` as a comment-to-end-of-line, so a block containing one parses
// and runs natively whether the marker sits inline after real code or on
// its own line — stripping it would throw away the halt the marker exists
// to document. See `blockExpectsHalt` for how those markers are handled.
function stripTrailingMarkerLines(code: string): {
  executable: string;
  trimmed: boolean;
} {
  const lines = code.split('\n');
  let end = lines.length;
  let trimmed = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    if (ELLIPSIS_LINE_RE.test(line)) {
      end = i;
      trimmed = true;
      continue;
    }
    break;
  }

  return { executable: lines.slice(0, end).join('\n'), trimmed };
}

// True if any line of the (ellipsis-stripped) code carries a genuine
// `# Error:`-style marker — i.e. execution of this block is documented to
// halt. Used to flip the pass/fail polarity in testBlock: a thrown error is
// the expected outcome, and completing without one is the failure.
function blockExpectsHalt(code: string): boolean {
  return code
    .split('\n')
    .some(
      (line) =>
        ERROR_MARKER_LINE_RE.test(line) && !markerInsideStringLiteral(line)
    );
}

// Pull a strict `RILL-[RPLC]NNN` / `RILL_[RPLC]NNN` error code out of a
// block's `# Error:` marker text, if the marker names one. Baseline halt
// assertion doesn't need this — it's an optional, cheap strengthening for
// the common case where the marker already documents the exact code.
function expectedErrorCodeToken(code: string): string | null {
  for (const line of code.split('\n')) {
    if (!ERROR_MARKER_LINE_RE.test(line) || markerInsideStringLiteral(line)) {
      continue;
    }
    const match = ERROR_CODE_TOKEN_RE.exec(line);
    if (match) return match[0];
  }
  return null;
}

// Check if block should be skipped (pseudo-code, syntax demos)
function shouldSkipBlock(code: string): string | null {
  // Skip blocks with placeholder syntax like "collection -> each body"
  if (/^\s*\w+\s+->\s+(each|map|filter|fold)\s+\w+\s*$/m.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks with "condition ? then-body" pseudo-syntax
  if (/^\s*condition\s+\?/.test(code)) {
    return 'pseudo-code syntax';
  }

  // Skip blocks that are pure comments
  if (
    code
      .split('\n')
      .every((line) => line.trim().startsWith('#') || !line.trim())
  ) {
    return 'comments only';
  }

  return null;
}

// Determine what to run for a block: strip a trailing run of ellipsis
// continuation lines and only skip the whole block when nothing executable
// remains once those trailing lines are removed. `# Error:` markers are
// never stripped and never cause a skip — they flip `expectHalt` instead, so
// testBlock runs the code and asserts it halts rather than exempting it.
function analyzeBlock(code: string): {
  skipReason: string | null;
  executableCode: string;
  expectHalt: boolean;
} {
  const wholeBlockReason = shouldSkipBlock(code);
  if (wholeBlockReason) {
    return {
      skipReason: wholeBlockReason,
      executableCode: code,
      expectHalt: false,
    };
  }

  const { executable, trimmed } = stripTrailingMarkerLines(code);
  if (!trimmed) {
    return {
      skipReason: null,
      executableCode: code,
      expectHalt: blockExpectsHalt(code),
    };
  }

  if (executable.trim() === '') {
    return {
      skipReason: 'contains ellipsis placeholder',
      executableCode: code,
      expectHalt: false,
    };
  }

  return {
    skipReason: null,
    executableCode: executable,
    expectHalt: blockExpectsHalt(executable),
  };
}

// Common mock variables for examples - only input variables, not ones typically assigned
function createMockVariables(): Record<string, RillValue> {
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
function createExtExtensionDict(
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

// Also expose top-level single-word host functions (e.g. `prompt`) under the
// same convention so `use<ext:app> => $app; $app.prompt(...)` works in docs
// that hoist a synthetic `app` extension covering all `app::*` entries.

// A block's final statement ending in an explicit capture (`=> $name`) is a
// deliberate closure definition, not a forgotten invocation — only flag a
// callable result when the last statement does not store it anywhere.
//
// A trailing `-> $name` is NOT recognized here. Syntactically that's a
// pipe-target invocation (the parser marks the target `Variable` node
// `isPipeTarget: true`, never `type: 'Capture'`), not a capture: it applies
// the piped value to whatever `$name` already holds rather than storing a
// new closure. Detecting it would require distinguishing "invocation that
// happens to no-op" from "deliberate closure definition", which the AST
// alone doesn't disambiguate — so only the unambiguous `=>` form is exempt.
function lastStatementEndsInCapture(ast: ScriptNode): boolean {
  const last = ast.statements[ast.statements.length - 1];
  if (!last) return false;
  const statement = last.type === 'AnnotatedStatement' ? last.statement : last;
  if (statement.type !== 'Statement') return false;
  const { pipes, terminator } = statement.expression;
  if (terminator?.type === 'Capture') return true;
  const lastPipe = pipes[pipes.length - 1];
  return lastPipe?.type === 'Capture';
}

async function testBlock(block: CodeBlock): Promise<TestResult> {
  const location = `${block.file}:${block.lineNumber}`;

  // Process frontmatter first
  const { code, variables: frontmatterVars } = processFrontmatter(block.code);

  // Check for skip conditions on the processed code. A trailing run of
  // ellipsis continuation lines is exempt from execution, but any executable
  // lines ahead of it still run. `# Error:` markers are never stripped and
  // never skip — they flip expectHalt below, so the block still runs and is
  // asserted to halt.
  const { skipReason, executableCode, expectHalt } = analyzeBlock(code);
  if (skipReason) {
    return { block, success: true, skipped: true, skipReason };
  }

  const mockFunctions = createMockFunctions();
  const ctx = createRuntimeContext({
    callbacks: {
      onLog: () => {}, // Suppress output
    },
    functions: mockFunctions,
    variables: { ...createMockVariables(), ...frontmatterVars },
    resolvers: { ext: extResolver },
    configurations: {
      resolvers: {
        ext: createExtExtensionDict(mockFunctions),
      },
    },
  });

  try {
    const ast = parse(executableCode);
    const exec = await execute(ast, ctx);
    if (block.expectedResult !== undefined) {
      const actual1 = formatValue(exec.result).trim();
      const actual2 = formatRillLiteral(exec.result).trim();
      const expected = block.expectedResult.trim();
      const normalized = expected.replace(/\s*\([^)]*\)\s*$/, '');
      if (
        expected !== actual1 &&
        expected !== actual2 &&
        normalized !== actual1 &&
        normalized !== actual2
      ) {
        return {
          block,
          success: false,
          error: `Result drift: expected \`${block.expectedResult}\`, got \`${actual1}\``,
          errorColumn: undefined,
        };
      }
    } else if (isCallable(exec.result) && !lastStatementEndsInCapture(ast)) {
      // A block with no `# Result:` annotation that ends in an uninvoked
      // callable almost always means the example forgot to apply it, rather
      // than intentionally documenting a callable value. A block whose last
      // statement stores the callable via an explicit capture (`=> $name`)
      // is a deliberate closure definition and is exempt.
      return {
        block,
        success: false,
        error: 'Block ends in an unapplied callable (result was never invoked)',
        errorColumn: undefined,
      };
    }
    if (expectHalt) {
      return {
        block,
        success: false,
        error:
          'Expected execution to halt (block carries a `# Error:` marker), but the block completed',
        errorColumn: undefined,
      };
    }
    return { block, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorColumn =
      err instanceof RillError ? err.location?.column : undefined;

    if (expectHalt) {
      // Baseline assertion is halt-only — marker text is inconsistent across
      // docs, so we don't require it to match. When the marker does carry a
      // strict rill error code, assert the caught message contains it as a
      // cheap strengthening.
      const expectedToken = expectedErrorCodeToken(executableCode);
      if (expectedToken && !errorMessage.includes(expectedToken)) {
        return {
          block,
          success: false,
          error: `Expected halt to mention ${expectedToken}, but got: ${errorMessage}`,
          errorColumn,
        };
      }
      return { block, success: true };
    }

    // Track unknown functions
    const unknownMatch = errorMessage.match(
      /Unknown function: (\w+(?:::\w+)*)/
    );
    if (unknownMatch) {
      trackUnknownFunction(unknownMatch[1]!, location);
    }

    return { block, success: false, error: errorMessage, errorColumn };
  }
}

function formatLocation(block: CodeBlock): string {
  return `${block.file}:${block.lineNumber}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonFlag = args.includes('--json');
  const filteredArgs = args.filter((a) => a !== '--json');

  if (filteredArgs.length === 0) {
    console.error(
      'Usage: npx tsx scripts/test-examples.ts [--json] <file-or-directory>...'
    );
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/test-examples.ts docs/guide.md');
    console.error('  npx tsx scripts/test-examples.ts docs/');
    console.error('  npx tsx scripts/test-examples.ts docs/ README.md');
    console.error('  npx tsx scripts/test-examples.ts --json docs/');
    process.exit(1);
  }

  for (const targetPath of filteredArgs) {
    if (!fs.existsSync(targetPath)) {
      console.error(`Path not found: ${targetPath}`);
      process.exit(1);
    }
  }

  // Accepts several targets so a run can cover docs/ and the root README in
  // one pass. Dedupe by resolved path: a file named explicitly may also sit
  // under a directory target (even under a differently spelled path, e.g. a
  // trailing slash or `./` prefix), and testing it twice would double-count
  // the totals. Keep the first-seen (unresolved) spelling for display so
  // reported paths stay relative when the caller passed relative targets.
  const seenByResolvedPath = new Map<string, string>();
  for (const file of filteredArgs.flatMap(findMarkdownFiles)) {
    const resolved = path.resolve(file);
    if (!seenByResolvedPath.has(resolved)) {
      seenByResolvedPath.set(resolved, file);
    }
  }
  const files = [...seenByResolvedPath.values()];

  if (files.length === 0) {
    console.error('No markdown files found');
    process.exit(1);
  }

  if (!jsonFlag) {
    console.log(`Testing rill examples in ${files.length} file(s)...\n`);
  }

  const allBlocks: CodeBlock[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const blocks = extractRillBlocks(content, file);
    allBlocks.push(...blocks);
  }

  if (allBlocks.length === 0) {
    if (!jsonFlag) {
      console.log('No ```rill code blocks found');
    }
    process.exit(0);
  }

  const results: TestResult[] = [];

  for (const block of allBlocks) {
    const result = await testBlock(block);
    results.push(result);

    if (!jsonFlag) {
      if (result.skipped) {
        process.stdout.write('s');
      } else if (result.success) {
        process.stdout.write('.');
      } else {
        process.stdout.write('F');
      }
    }
  }

  const failures = results.filter((r) => !r.success && !r.skipped);
  const passes = results.filter((r) => r.success && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  // Skip-ratio guard: a spike in skipped rill fences usually means the marker
  // detection in analyzeBlock() is over-matching again (e.g. back to treating
  // any block that merely contains "# Error:" or "# ..." anywhere as fully
  // skippable, instead of only a trailing run of marker lines). The threshold
  // is pinned just above the ratio measured immediately after that fix landed
  // (2/660 skipped ≈ 0.30% across docs/ + README.md), so a regression back
  // toward whole-block skipping fails the run instead of silently widening.
  // Pinned tight enough that a single additional skip (3/660 ≈ 0.45%) already
  // trips the guard, rather than requiring the count to double first.
  const SKIP_RATIO_THRESHOLD = 0.0035; // 0.35%
  const skipRatio =
    allBlocks.length > 0 ? skipped.length / allBlocks.length : 0;
  const skipRatioExceeded = skipRatio > SKIP_RATIO_THRESHOLD;

  if (jsonFlag) {
    // JSONL output: one JSON object per line for each failure
    for (const result of failures) {
      const obj: Record<string, unknown> = {
        file: result.block.file,
        line: result.block.lineNumber,
        message: result.error,
      };
      if (result.errorColumn !== undefined) {
        obj.column = result.errorColumn;
      }
      console.log(JSON.stringify(obj));
    }
    if (skipRatioExceeded) {
      console.log(
        JSON.stringify({
          kind: 'skip-ratio-exceeded',
          skipped: skipped.length,
          total: allBlocks.length,
          ratio: skipRatio,
          threshold: SKIP_RATIO_THRESHOLD,
          message: `Skipped ${skipped.length}/${allBlocks.length} rill fences (${(skipRatio * 100).toFixed(2)}%), exceeding the ${(SKIP_RATIO_THRESHOLD * 100).toFixed(2)}% threshold`,
        })
      );
    }
  } else {
    console.log('\n');

    if (failures.length > 0) {
      console.log('Failures:\n');

      for (const result of failures) {
        console.log(`  ${formatLocation(result.block)}`);
        console.log(`    ${result.error}`);
        console.log(`    Code: ${result.block.code.split('\n')[0]}...`);
        console.log('');
      }
    }

    // Report unknown functions
    if (unknownFunctions.size > 0) {
      console.log('Unknown functions (need mock or app:: prefix in docs):\n');
      for (const [name, locations] of unknownFunctions) {
        console.log(`  ${name}:`);
        for (const loc of [...locations].slice(0, 3)) {
          console.log(`    - ${loc}`);
        }
        if (locations.size > 3) {
          console.log(`    ... and ${locations.size - 3} more`);
        }
      }
      console.log('');
    }

    console.log(
      `${passes.length} passed, ${failures.length} failed, ${skipped.length} skipped, ${allBlocks.length} total`
    );

    if (skipRatioExceeded) {
      console.log(
        `Skip ratio guard: ${skipped.length}/${allBlocks.length} (${(skipRatio * 100).toFixed(2)}%) skipped, exceeding the ${(SKIP_RATIO_THRESHOLD * 100).toFixed(2)}% threshold`
      );
    }
  }

  if (failures.length > 0 || skipRatioExceeded) {
    process.exit(1);
  }
}

main();
