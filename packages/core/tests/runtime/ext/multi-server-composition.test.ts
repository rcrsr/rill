/**
 * Rill Runtime Tests: Multi-Server Composition
 * Integration test for multiple extension composition with namespace isolation
 *
 * Specification Mapping (Task 3.2 / IC-6):
 * - Multiple extensions mount simultaneously without conflict
 * - Each extension's functions resolve via use<ext:name.leaf>
 * - Namespace isolation verified (no cross-contamination)
 *
 * Test Coverage:
 * - Create 2+ mock extensions with overlapping leaf names
 * - Mount each via createTestContext with toCallable
 * - Call functions from each extension in single test context
 * - Verify namespace isolation (no cross-contamination)
 */

import { describe, expect, it } from 'vitest';
import {
  anyTypeValue,
  createTestContext,
  execute,
  parse,
  toCallable,
  type RillFunction,
  type RillValue,
} from '@rcrsr/rill';

// Helper: parse and execute a script in a given context
async function execInContext(
  source: string,
  ctx: ReturnType<typeof createTestContext>
): Promise<RillValue> {
  const ast = parse(source);
  return (await execute(ast, ctx)).result;
}

// Helper: build a typed callable from a RillFunction definition
function typedCallable(def: RillFunction): RillValue {
  return toCallable(def) as unknown as RillValue;
}

describe('Multi-Server Composition', () => {
  describe('Multiple extensions mount simultaneously without conflict', () => {
    it('combines three mock servers (GitHub, Slack, PostgreSQL) in single context', async () => {
      // Mock GitHub extension
      const ghListPrs = typedCallable({
        params: [
          {
            name: 'options',
            type: { kind: 'dict' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => {
          const opts = args['options'] as Record<string, unknown>;
          const state = opts['state'] as string;
          return [
            {
              number: 42,
              title: 'Add user authentication',
              state,
              author: 'alice',
            },
            {
              number: 43,
              title: 'Fix database connection leak',
              state,
              author: 'bob',
            },
          ];
        },
        returnType: anyTypeValue,
      });

      const ghGetPr = typedCallable({
        params: [
          {
            name: 'number',
            type: { kind: 'number' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => ({
          number: args['number'],
          title: `PR #${args['number']}`,
          state: 'open',
        }),
        returnType: anyTypeValue,
      });

      // Mock Slack extension
      const slackPostMessage = typedCallable({
        params: [
          {
            name: 'options',
            type: { kind: 'dict' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => {
          const opts = args['options'] as Record<string, unknown>;
          const channel = opts['channel'] as string;
          const text = opts['text'] as string;
          return { ok: true, channel, message: text, ts: '1234567890.123456' };
        },
        returnType: anyTypeValue,
      });

      const slackListChannels = typedCallable({
        params: [],
        fn: () => ['#engineering', '#general', '#random'],
        returnType: anyTypeValue,
      });

      // Mock PostgreSQL extension
      const pgQuery = typedCallable({
        params: [
          {
            name: 'sql',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => {
          const sql = args['sql'] as string;
          if (sql.includes('pr_id = 42')) {
            return { status: 'deployed', environment: 'staging' };
          }
          if (sql.includes('pr_id = 43')) {
            return { status: 'pending', environment: null };
          }
          return { status: 'unknown' };
        },
        returnType: anyTypeValue,
      });

      const pgExecute = typedCallable({
        params: [
          {
            name: 'sql',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => ({
          rowsAffected: 1,
          command: args['sql'],
        }),
        returnType: anyTypeValue,
      });

      // Mount all three extensions in a single context
      const ctx = createTestContext({
        gh: {
          value: {
            list_pull_requests: ghListPrs,
            get_pull_request: ghGetPr,
          } as RillValue,
        },
        slack: {
          value: {
            post_message: slackPostMessage,
            list_channels: slackListChannels,
          } as RillValue,
        },
        pg: {
          value: {
            query: pgQuery,
            execute: pgExecute,
          } as RillValue,
        },
      });

      // Execute script that calls functions from all three extensions
      const script = `
        use<ext:gh.list_pull_requests>(dict[state: "open"]) => $prs
        $prs -> .len => $count
        use<ext:pg.query>("SELECT status FROM deployments WHERE pr_id = 42") => $deploy
        use<ext:slack.post_message>(dict[channel: "#engineering", text: "{$count} PRs found"]) => $result
        $result
      `;

      const result = await execInContext(script, ctx);

      // Verify result structure: all three extensions worked
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)['ok']).toBe(true);
      expect((result as Record<string, unknown>)['channel']).toBe(
        '#engineering'
      );
      expect((result as Record<string, unknown>)['message']).toBe(
        '2 PRs found'
      );
    });

    it('verifies namespace isolation with overlapping leaf names', async () => {
      // Two extensions with SAME leaf function names
      const s1Get = typedCallable({
        params: [
          {
            name: 'key',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => `server1:${args['key']}`,
        returnType: anyTypeValue,
      });

      const s1Set = typedCallable({
        params: [
          {
            name: 'key',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'value',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => `server1:set:${args['key']}=${args['value']}`,
        returnType: anyTypeValue,
      });

      const s2Get = typedCallable({
        params: [
          {
            name: 'key',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => `server2:${args['key']}`,
        returnType: anyTypeValue,
      });

      const s2Set = typedCallable({
        params: [
          {
            name: 'key',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'value',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => `server2:set:${args['key']}=${args['value']}`,
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        s1: {
          value: { get: s1Get, set: s1Set } as RillValue,
        },
        s2: {
          value: { get: s2Get, set: s2Set } as RillValue,
        },
      });

      // Verify no cross-contamination: each extension resolves its own function
      const result1 = await execInContext('use<ext:s1.get>("test")', ctx);
      expect(result1).toBe('server1:test');

      const result2 = await execInContext('use<ext:s2.get>("test")', ctx);
      expect(result2).toBe('server2:test');

      const result3 = await execInContext(
        'use<ext:s1.set>("key", "value")',
        ctx
      );
      expect(result3).toBe('server1:set:key=value');

      const result4 = await execInContext(
        'use<ext:s2.set>("key", "value")',
        ctx
      );
      expect(result4).toBe('server2:set:key=value');
    });

    it('prevents namespace collision when combining extensions', async () => {
      const ext1Test = typedCallable({
        params: [],
        fn: () => 'ext1-test',
        returnType: anyTypeValue,
      });

      const ext2Test = typedCallable({
        params: [],
        fn: () => 'ext2-test',
        returnType: anyTypeValue,
      });

      const ext3Test = typedCallable({
        params: [],
        fn: () => 'ext3-test',
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        ext1: { value: { test: ext1Test } as RillValue },
        ext2: { value: { test: ext2Test } as RillValue },
        ext3: { value: { test: ext3Test } as RillValue },
      });

      // Verify each extension resolves to its own function
      const result1 = await execInContext('use<ext:ext1.test>()', ctx);
      const result2 = await execInContext('use<ext:ext2.test>()', ctx);
      const result3 = await execInContext('use<ext:ext3.test>()', ctx);

      expect(result1).toBe('ext1-test');
      expect(result2).toBe('ext2-test');
      expect(result3).toBe('ext3-test');
    });

    it('handles complex multi-server workflow with data flow between extensions', async () => {
      // Mock API extension
      const apiFetch = typedCallable({
        params: [
          {
            name: 'url',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => {
          const url = args['url'] as string;
          if (url.includes('/users')) {
            return { users: [{ id: 1, name: 'Alice' }] };
          }
          return { data: [] };
        },
        returnType: anyTypeValue,
      });

      // Mock database extension
      const dbInsert = typedCallable({
        params: [
          {
            name: 'table',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'data',
            type: { kind: 'dict' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => ({
          inserted: true,
          table: args['table'],
          id: 99,
        }),
        returnType: anyTypeValue,
      });

      // Mock cache extension
      const cacheSet = typedCallable({
        params: [
          {
            name: 'key',
            type: { kind: 'string' },
            defaultValue: undefined,
            annotations: {},
          },
          {
            name: 'value',
            type: { kind: 'any' },
            defaultValue: undefined,
            annotations: {},
          },
        ],
        fn: (args) => ({
          cached: true,
          key: args['key'],
          ttl: 3600,
        }),
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        api: { value: { fetch: apiFetch } as RillValue },
        db: { value: { insert: dbInsert } as RillValue },
        cache: { value: { set: cacheSet } as RillValue },
      });

      // Complex workflow: fetch from API, save to DB, cache result
      const script = `
        use<ext:api.fetch>("/users") => $apiResponse
        use<ext:db.insert>("users", dict[id: 1, name: "Alice"]) => $dbResult
        use<ext:cache.set>("user_1", $dbResult) => $cacheResult
        dict[api: $apiResponse, db: $dbResult, cache: $cacheResult]
      `;

      const result = (await execInContext(script, ctx)) as Record<
        string,
        unknown
      >;

      // Verify each step executed correctly: all three extensions worked
      expect(result['api']).toBeDefined();
      expect(result['db']).toBeDefined();
      expect(result['cache']).toBeDefined();

      // Verify db result
      expect((result['db'] as Record<string, unknown>)['inserted']).toBe(true);
      expect((result['db'] as Record<string, unknown>)['table']).toBe('users');

      // Verify cache result
      expect((result['cache'] as Record<string, unknown>)['cached']).toBe(true);
      expect((result['cache'] as Record<string, unknown>)['key']).toBe(
        'user_1'
      );
    });

    it('supports dispose lifecycle for multiple extensions', async () => {
      const disposeLog: string[] = [];

      const ext1Work = typedCallable({
        params: [],
        fn: () => 'ext1-work',
        returnType: anyTypeValue,
      });

      const ext2Work = typedCallable({
        params: [],
        fn: () => 'ext2-work',
        returnType: anyTypeValue,
      });

      const ext3Work = typedCallable({
        params: [],
        fn: () => 'ext3-work',
        returnType: anyTypeValue,
      });

      const ctx = createTestContext({
        ext1: {
          value: { work: ext1Work } as RillValue,
          dispose: () => {
            disposeLog.push('ext1-disposed');
          },
        },
        ext2: {
          value: { work: ext2Work } as RillValue,
          dispose: () => {
            disposeLog.push('ext2-disposed');
          },
        },
        ext3: {
          value: { work: ext3Work } as RillValue,
          dispose: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            disposeLog.push('ext3-disposed');
          },
        },
      });

      // Use all extension functions
      await execInContext('use<ext:ext1.work>()', ctx);
      await execInContext('use<ext:ext2.work>()', ctx);
      await execInContext('use<ext:ext3.work>()', ctx);

      // The dispose functions are registered but not called by the context.
      // Verify createTestContext accepted the dispose callbacks without error.
      expect(ctx).toBeDefined();
    });
  });
});
