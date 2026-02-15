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
  parse,
  RillError,
  type RillValue,
} from '@rcrsr/rill';

interface CodeBlock {
  code: string;
  lineNumber: number;
  file: string;
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
function vectorDbMocks(
  ns: string
): Record<string, import('@rcrsr/rill').HostFunctionDefinition> {
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
        { name: 'id', type: 'string' },
        { name: 'vector', type: 'list' },
        { name: 'metadata', type: 'dict', defaultValue: {} },
      ],
      fn: () => ({
        success: true,
        upsertedCount: 1,
        deleted: true,
        status: 'ok',
      }),
    },
    [`${ns}::upsert_batch`]: {
      params: [{ name: 'items', type: 'list' }],
      fn: () => ({ succeeded: 2, upsertedCount: 2, status: 'ok' }),
    },
    [`${ns}::search`]: {
      params: [{ name: 'vector' }, { name: 'options' }],
      fn: () => [point],
    },
    [`${ns}::get`]: {
      params: [{ name: 'id', type: 'string' }],
      fn: () => point,
    },
    [`${ns}::delete`]: {
      params: [{ name: 'id', type: 'string' }],
      fn: () => ({ deleted: true, status: 'ok' }),
    },
    [`${ns}::delete_batch`]: {
      params: [{ name: 'ids', type: 'list' }],
      fn: () => ({ succeeded: 3, status: 'ok' }),
    },
    [`${ns}::count`]: {
      params: [],
      fn: () => ({ count: 42, vectorCount: 42 }),
    },
    [`${ns}::create_collection`]: {
      params: [
        { name: 'name', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
      ],
      fn: () => ({ created: true, name: 'test', status: 'ok' }),
    },
    [`${ns}::delete_collection`]: {
      params: [{ name: 'name', type: 'string' }],
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
function createMockFunctions(): Record<
  string,
  import('@rcrsr/rill').HostFunctionDefinition
> {
  return {
    // Primary app:: namespace (preferred convention for docs)
    'app::prompt': {
      params: [{ name: 'text', type: 'string' }],
      fn: () => 'mock LLM response',
    },
    'app::fetch': {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"status": "ok"}',
    },
    'app::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'app::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },
    'app::exec': {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => ['output', 0],
    },
    'app::error': {
      params: [{ name: 'msg', type: 'string' }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    // Mock embedding function for vector examples
    'app::embed': {
      params: [
        { name: 'text', type: 'string' },
        { name: 'model', type: 'string', defaultValue: 'mock-embed' },
      ],
      fn: (_text, model) => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: String(model),
      }),
    },
    'app::sleep': { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    'app::process': {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'processed',
    },
    'app::validate': {
      params: [{ name: 'value', type: 'string' }],
      fn: (v) => v,
    },
    'app::command': {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => 'output',
    },
    'app::attempt': {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'success',
    },
    'app::pause': { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    'app::call': {
      params: [
        { name: 'fn_name', type: 'string' },
        { name: 'args', type: 'dict' },
      ],
      fn: () => 'called',
    },

    // IO namespace
    'io::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'io::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },
    'io::file::read': {
      params: [{ name: 'path', type: 'string' }],
      fn: () => 'file contents',
    },
    'io::file::write': {
      params: [
        { name: 'path', type: 'string' },
        { name: 'content', type: 'string' },
      ],
      fn: () => true,
    },

    // Math namespace
    'math::add': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (a, b) => (a as number) + (b as number),
    },
    'math::multiply': {
      params: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' },
      ],
      fn: (a, b) => (a as number) * (b as number),
    },

    // HTTP namespace
    'http::get': {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"data": "mock"}',
    },
    'http::post': {
      params: [
        { name: 'url', type: 'string' },
        { name: 'data', type: 'string' },
      ],
      fn: () => '{"status": "ok"}',
    },

    // String namespace (for host-provided string utils, not built-in methods)
    'str::upper': {
      params: [{ name: 'text', type: 'string' }],
      fn: (s) => String(s).toUpperCase(),
    },
    'str::lower': {
      params: [{ name: 'text', type: 'string' }],
      fn: (s) => String(s).toLowerCase(),
    },

    // FS namespace (supports both 2-param and 3-param mount-based signatures)
    'fs::read': {
      params: [
        { name: 'mount_or_path', type: 'string' },
        { name: 'path', type: 'string', defaultValue: '' },
      ],
      fn: () => 'file contents',
    },
    'fs::write': {
      params: [
        { name: 'mount_or_path', type: 'string' },
        { name: 'path_or_content', type: 'string' },
        { name: 'content', type: 'string', defaultValue: '' },
      ],
      fn: () => true,
    },

    // KV namespace (supports both 2-param and 3-param mount-based signatures)
    // 2-param: kv::set(key, value) - for rill app mode
    // 3-param: kv::set(mount, key, value) - for host integration with mounts
    'kv::set': {
      params: [
        { name: 'key_or_mount', type: 'string' },
        { name: 'value_or_key' },
        { name: 'value', type: 'string', defaultValue: '' },
      ],
      fn: () => true,
    },
    'kv::get': {
      params: [
        { name: 'key_or_mount', type: 'string' },
        { name: 'key', type: 'string', defaultValue: '' },
      ],
      fn: (args) => {
        // args is an array: [key] or [mount, key]; default fills '' for missing 2nd param
        const a = args as unknown as string[];
        const key = !a[1] ? a[0] : a[1];
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
        { name: 'key_or_mount', type: 'string' },
        { name: 'key', type: 'string', defaultValue: '' },
      ],
      fn: () => true,
    },
    'kv::has': {
      params: [
        { name: 'key_or_mount', type: 'string' },
        { name: 'key', type: 'string', defaultValue: '' },
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
        { name: 'input', type: 'string' },
        { name: 'algo', type: 'string', defaultValue: 'sha256' },
      ],
      fn: () =>
        'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a',
    },
    'crypto::hmac': {
      params: [{ name: 'input', type: 'string' }],
      fn: () =>
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    },
    'crypto::random': {
      params: [{ name: 'bytes', type: 'number', defaultValue: 32 }],
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
        { name: 'pageSize', type: 'number', defaultValue: 10 },
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
        { name: 'filter', type: 'string' },
        { name: 'input', type: 'string', defaultValue: '' },
      ],
      fn: () => ({ stdout: '{}', stderr: '', exitCode: 0 }),
    },

    // Extension examples (ai::, claude_code::)
    'ai::greet': {
      params: [{ name: 'name', type: 'string' }],
      fn: (name) => `Hello, ${name}!`,
    },
    'claude_code::prompt': {
      params: [{ name: 'text', type: 'string' }],
      fn: () => 'mock Claude Code response',
    },
    'claude_code::skill': {
      params: [
        { name: 'name', type: 'string' },
        { name: 'args', type: 'dict' },
      ],
      fn: () => 'skill executed',
    },
    'claude_code::command': {
      params: [
        { name: 'name', type: 'string' },
        { name: 'args', type: 'dict' },
      ],
      fn: () => 'command executed',
    },

    // anthropic:: namespace
    'anthropic::message': {
      params: [
        { name: 'text', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
        { name: 'messages', type: 'list' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
      params: [{ name: 'text', type: 'string' }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'anthropic::embed_batch': {
      params: [{ name: 'texts', type: 'list' }],
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
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
      params: [{ name: 'options', type: 'dict' }],
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
      params: [{ name: 'options', type: 'dict', defaultValue: {} }],
      fn: () => [
        { number: 42, title: 'Fix bug', state: 'open' },
        { number: 43, title: 'Add feature', state: 'open' },
      ],
    },
    'pg::query': {
      params: [{ name: 'options', type: 'dict' }],
      fn: () => ({ status: 'deployed' }),
    },
    'db::read_query': {
      params: [{ name: 'options', type: 'dict' }],
      fn: () => [
        { name: 'Acme Corp', revenue: 1000000 },
        { name: 'Tech Inc', revenue: 800000 },
      ],
    },
    'ai::message': {
      params: [{ name: 'text', type: 'string' }],
      fn: () => ({
        content: 'mock AI analysis',
        model: 'mock-model',
      }),
    },

    // openai:: namespace
    'openai::message': {
      params: [
        { name: 'text', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
        { name: 'messages', type: 'list' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
      params: [{ name: 'text', type: 'string' }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'openai::embed_batch': {
      params: [{ name: 'texts', type: 'list' }],
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
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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

    // gemini:: namespace
    'gemini::message': {
      params: [
        { name: 'text', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
        { name: 'messages', type: 'list' },
        { name: 'options', type: 'dict', defaultValue: {} },
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
      params: [{ name: 'text', type: 'string' }],
      fn: () => ({
        __rill_vector: true,
        data: new Float32Array([0.1, 0.2, 0.3]),
        model: 'mock-embed',
      }),
    },
    'gemini::embed_batch': {
      params: [{ name: 'texts', type: 'list' }],
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
        { name: 'prompt', type: 'string' },
        { name: 'options', type: 'dict', defaultValue: {} },
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

    // Vector DB extensions (chroma::, pinecone::, qdrant::)
    ...vectorDbMocks('chroma'),
    ...vectorDbMocks('pinecone'),
    ...vectorDbMocks('qdrant'),

    // Legacy unnamespaced - these should be migrated to app:: in docs
    prompt: {
      params: [{ name: 'text', type: 'string' }],
      fn: () => 'mock LLM response',
    },
    fetch: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '{"status": "ok"}',
    },
    fetch_page: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '<html>page</html>',
    },
    exec: {
      params: [{ name: 'cmd', type: 'string' }],
      fn: () => ['output', 0],
    },
    error: {
      params: [{ name: 'msg', type: 'string' }],
      fn: (msg) => {
        throw new Error(String(msg));
      },
    },
    process: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'processed',
    },
    proceed: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'proceeded',
    },
    handle: {
      params: [{ name: 'input', type: 'string' }],
      fn: () => 'handled',
    },
    validate: { params: [{ name: 'value', type: 'string' }], fn: (v) => v },
    check_status: { params: [], fn: () => 'ok' },
    get_page: {
      params: [{ name: 'url', type: 'string' }],
      fn: () => '<html></html>',
    },
    retry: {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'retried',
    },
    process_config: {
      params: [{ name: 'config', type: 'string' }],
      fn: (v) => v,
    },
    process_content: {
      params: [{ name: 'content', type: 'string' }],
      fn: (v) => v,
    },
    save_content: {
      params: [{ name: 'content', type: 'string' }],
      fn: () => true,
    },
    command: { params: [{ name: 'cmd', type: 'string' }], fn: () => 'output' },
    skip: { params: [{ name: 'reason', type: 'string' }], fn: () => null },
    attempt: {
      params: [{ name: 'action', type: 'string' }],
      fn: () => 'success',
    },
    pause: { params: [{ name: 'ms', type: 'number' }], fn: () => null },
    slow_process: {
      params: [{ name: 'input', type: 'string' }],
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
      blocks.push({
        code: blockLines.join('\n'),
        lineNumber: blockStart + 1, // Line after the opening fence
        file: filePath,
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

  // Skip blocks with "..." continuation markers (but not in strings or spread)
  if (/(?<!\[)\.\.\.[^$\]]/.test(code) && !/"\.\.\."/.test(code)) {
    return 'contains ellipsis placeholder';
  }

  // Skip blocks demonstrating expected errors
  if (/# Error:|# ERROR:|# error:/.test(code)) {
    return 'expected error example';
  }

  return null;
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
    items: ['a', 'b', 'c'],
    list: [1, 2, 3],
    config: { key: 'value', count: 42 },
    data: { items: [1, 2, 3], name: 'test' },
    input: 'mock input',
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

async function testBlock(block: CodeBlock): Promise<TestResult> {
  const location = `${block.file}:${block.lineNumber}`;

  // Process frontmatter first
  const { code, variables: frontmatterVars } = processFrontmatter(block.code);

  // Check for skip conditions on the processed code
  const skipReason = shouldSkipBlock(code);
  if (skipReason) {
    return { block, success: true, skipped: true, skipReason };
  }

  const ctx = createRuntimeContext({
    callbacks: {
      onLog: () => {}, // Suppress output
    },
    functions: createMockFunctions(),
    variables: { ...createMockVariables(), ...frontmatterVars },
  });

  try {
    const ast = parse(code);
    await execute(ast, ctx);
    return { block, success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorColumn =
      err instanceof RillError ? err.location?.column : undefined;

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
      'Usage: npx tsx scripts/test-examples.ts [--json] <file-or-directory>'
    );
    console.error('');
    console.error('Examples:');
    console.error('  npx tsx scripts/test-examples.ts docs/guide.md');
    console.error('  npx tsx scripts/test-examples.ts docs/');
    console.error('  npx tsx scripts/test-examples.ts --json docs/');
    process.exit(1);
  }

  const targetPath = filteredArgs[0]!;

  if (!fs.existsSync(targetPath)) {
    console.error(`Path not found: ${targetPath}`);
    process.exit(1);
  }

  const files = findMarkdownFiles(targetPath);

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
  }

  if (failures.length > 0) {
    process.exit(1);
  }
}

main();
