/**
 * Rill Runtime Tests: Multi-Server Composition
 * Integration test for multiple extension composition with namespace isolation
 *
 * Specification Mapping (Task 4.2):
 * - AC-3: Multi-Server Composition
 *   - Three MCP servers (GitHub, Slack, PostgreSQL) each hoisted to distinct namespace
 *   - All functions callable in single script
 *   - Namespace isolation verified (no cross-contamination)
 *
 * Test Coverage:
 * - Create 2+ mock MCP servers with overlapping tool names
 * - Hoist each to distinct namespace via hoistExtension
 * - Call functions from each namespace in single test context
 * - Verify namespace isolation (no cross-contamination)
 */

import { describe, expect, it } from 'vitest';
import type { ExtensionResult } from '../../../src/runtime/ext/extensions.js';
import { hoistExtension } from '../../../src/runtime/ext/extensions.js';
import { run } from '../../helpers/runtime.js';

describe('Multi-Server Composition', () => {
  describe('AC-3: Multi-Server Composition with Namespace Isolation', () => {
    it('combines three mock MCP servers (GitHub, Slack, PostgreSQL) in single script', async () => {
      // Mock GitHub MCP server extension
      const githubExtension: ExtensionResult = {
        list_pull_requests: {
          params: [{ name: 'options', type: 'dict' }],
          fn: (args) => {
            const opts = args[0] as Record<string, unknown>;
            const state = opts['state'] as string;
            // Mock PR list
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
        },
        get_pull_request: {
          params: [{ name: 'number', type: 'number' }],
          fn: (args) => ({
            number: args[0],
            title: `PR #${args[0]}`,
            state: 'open',
          }),
        },
      };

      // Mock Slack MCP server extension
      const slackExtension: ExtensionResult = {
        post_message: {
          params: [{ name: 'options', type: 'dict' }],
          fn: (args) => {
            const opts = args[0] as Record<string, unknown>;
            const channel = opts['channel'] as string;
            const text = opts['text'] as string;
            return {
              ok: true,
              channel,
              message: text,
              ts: '1234567890.123456',
            };
          },
        },
        list_channels: {
          params: [],
          fn: () => ['#engineering', '#general', '#random'],
        },
      };

      // Mock PostgreSQL MCP server extension
      const postgresExtension: ExtensionResult = {
        query: {
          params: [{ name: 'sql', type: 'string' }],
          fn: (args) => {
            const sql = args[0] as string;
            // Mock query result based on SQL pattern
            if (sql.includes('pr_id = 42')) {
              return { status: 'deployed', environment: 'staging' };
            }
            if (sql.includes('pr_id = 43')) {
              return { status: 'pending', environment: null };
            }
            return { status: 'unknown' };
          },
        },
        execute: {
          params: [{ name: 'sql', type: 'string' }],
          fn: (args) => ({
            rowsAffected: 1,
            command: args[0],
          }),
        },
      };

      // Hoist each to distinct namespace
      const { functions: ghFunctions } = hoistExtension('gh', githubExtension);
      const { functions: slackFunctions } = hoistExtension(
        'slack',
        slackExtension
      );
      const { functions: pgFunctions } = hoistExtension(
        'pg',
        postgresExtension
      );

      // Combine all functions in single context
      const allFunctions = {
        ...ghFunctions,
        ...slackFunctions,
        ...pgFunctions,
      };

      // Execute script that calls functions from all three namespaces
      const script = `
        gh::list_pull_requests([state: "open"]) => $prs
        $prs -> .len => $count
        pg::query("SELECT status FROM deployments WHERE pr_id = 42") => $deploy
        slack::post_message([channel: "#engineering", text: "{$count} PRs found"]) => $result
        $result
      `;

      const result = await run(script, { functions: allFunctions });

      // Verify result structure - all three namespaces worked
      expect(result).toBeDefined();
      expect((result as Record<string, unknown>)['ok']).toBe(true);
      expect((result as Record<string, unknown>)['channel']).toBe(
        '#engineering'
      );
      expect((result as Record<string, unknown>)['message']).toBe(
        '2 PRs found'
      );
    });

    it('verifies namespace isolation with overlapping function names', async () => {
      // Create two mock servers with SAME function names
      const server1: ExtensionResult = {
        get: {
          params: [{ name: 'key', type: 'string' }],
          fn: (args) => `server1:${args[0]}`,
        },
        set: {
          params: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'string' },
          ],
          fn: (args) => `server1:set:${args[0]}=${args[1]}`,
        },
      };

      const server2: ExtensionResult = {
        get: {
          params: [{ name: 'key', type: 'string' }],
          fn: (args) => `server2:${args[0]}`,
        },
        set: {
          params: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'string' },
          ],
          fn: (args) => `server2:set:${args[0]}=${args[1]}`,
        },
      };

      // Hoist to different namespaces
      const { functions: s1Functions } = hoistExtension('s1', server1);
      const { functions: s2Functions } = hoistExtension('s2', server2);

      // Combine functions
      const combined = { ...s1Functions, ...s2Functions };

      // Verify no cross-contamination - each namespace calls its own function
      const result1 = await run('s1::get("test")', { functions: combined });
      expect(result1).toBe('server1:test');

      const result2 = await run('s2::get("test")', { functions: combined });
      expect(result2).toBe('server2:test');

      const result3 = await run('s1::set("key", "value")', {
        functions: combined,
      });
      expect(result3).toBe('server1:set:key=value');

      const result4 = await run('s2::set("key", "value")', {
        functions: combined,
      });
      expect(result4).toBe('server2:set:key=value');
    });

    it('combines multiple servers with state isolation', async () => {
      // Create stateful extensions (simulating connection state)
      interface ServerConfig {
        serverName: string;
      }

      const createMockServer = (config: ServerConfig): ExtensionResult => {
        let connectionCount = 0;
        let queryCount = 0;

        return {
          connect: {
            params: [],
            fn: () => {
              connectionCount += 1;
              return `${config.serverName}:connected:${connectionCount}`;
            },
          },
          query: {
            params: [{ name: 'sql', type: 'string' }],
            fn: (args) => {
              queryCount += 1;
              return {
                server: config.serverName,
                sql: args[0],
                queryNumber: queryCount,
              };
            },
          },
          getStats: {
            params: [],
            fn: () => ({
              server: config.serverName,
              connections: connectionCount,
              queries: queryCount,
            }),
          },
        };
      };

      // Create three independent server instances
      const db1 = createMockServer({ serverName: 'db1' });
      const db2 = createMockServer({ serverName: 'db2' });
      const db3 = createMockServer({ serverName: 'db3' });

      // Hoist to different namespaces
      const { functions: db1Functions } = hoistExtension('db1', db1);
      const { functions: db2Functions } = hoistExtension('db2', db2);
      const { functions: db3Functions } = hoistExtension('db3', db3);

      // Combine all functions
      const allFunctions = {
        ...db1Functions,
        ...db2Functions,
        ...db3Functions,
      };

      // Execute operations on different servers
      await run('db1::connect()', { functions: allFunctions });
      await run('db1::query("SELECT * FROM users")', {
        functions: allFunctions,
      });
      await run('db1::query("SELECT * FROM posts")', {
        functions: allFunctions,
      });

      await run('db2::connect()', { functions: allFunctions });
      await run('db2::connect()', { functions: allFunctions });
      await run('db2::query("SELECT * FROM orders")', {
        functions: allFunctions,
      });

      await run('db3::query("SELECT * FROM logs")', {
        functions: allFunctions,
      });
      await run('db3::query("SELECT * FROM events")', {
        functions: allFunctions,
      });
      await run('db3::query("SELECT * FROM metrics")', {
        functions: allFunctions,
      });

      // Verify state isolation - each server maintains independent state
      const stats1 = await run('db1::getStats()', { functions: allFunctions });
      expect(stats1).toEqual({
        server: 'db1',
        connections: 1,
        queries: 2,
      });

      const stats2 = await run('db2::getStats()', { functions: allFunctions });
      expect(stats2).toEqual({
        server: 'db2',
        connections: 2,
        queries: 1,
      });

      const stats3 = await run('db3::getStats()', { functions: allFunctions });
      expect(stats3).toEqual({
        server: 'db3',
        connections: 0,
        queries: 3,
      });
    });

    it('handles complex multi-server workflow with data flow between namespaces', async () => {
      // Mock API server
      const apiExtension: ExtensionResult = {
        fetch: {
          params: [{ name: 'url', type: 'string' }],
          fn: (args) => {
            const url = args[0] as string;
            if (url.includes('/users')) {
              return { users: [{ id: 1, name: 'Alice' }] };
            }
            return { data: [] };
          },
        },
      };

      // Mock database server
      const dbExtension: ExtensionResult = {
        insert: {
          params: [
            { name: 'table', type: 'string' },
            { name: 'data', type: 'dict' },
          ],
          fn: (args) => ({
            inserted: true,
            table: args[0],
            id: Math.floor(Math.random() * 1000),
          }),
        },
      };

      // Mock cache server
      const cacheExtension: ExtensionResult = {
        set: {
          params: [
            { name: 'key', type: 'string' },
            { name: 'value', type: 'any' },
          ],
          fn: (args) => ({
            cached: true,
            key: args[0],
            ttl: 3600,
          }),
        },
      };

      // Hoist to namespaces
      const { functions: apiFunctions } = hoistExtension('api', apiExtension);
      const { functions: dbFunctions } = hoistExtension('db', dbExtension);
      const { functions: cacheFunctions } = hoistExtension(
        'cache',
        cacheExtension
      );

      // Combine all functions
      const allFunctions = {
        ...apiFunctions,
        ...dbFunctions,
        ...cacheFunctions,
      };

      // Complex workflow: fetch from API, save to DB, cache result
      const script = `
        api::fetch("/users") => $apiResponse
        db::insert("users", [id: 1, name: "Alice"]) => $dbResult
        cache::set("user_1", $dbResult) => $cacheResult
        [api: $apiResponse, db: $dbResult, cache: $cacheResult]
      `;

      const result = (await run(script, {
        functions: allFunctions,
      })) as Record<string, unknown>;

      // Verify each step executed correctly - all three namespaces worked
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

    it('prevents namespace collision when combining extensions', async () => {
      const ext1: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'ext1-test',
        },
      };

      const ext2: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'ext2-test',
        },
      };

      const ext3: ExtensionResult = {
        test: {
          params: [],
          fn: () => 'ext3-test',
        },
      };

      // Hoist to unique namespaces
      const { functions: f1 } = hoistExtension('ext1', ext1);
      const { functions: f2 } = hoistExtension('ext2', ext2);
      const { functions: f3 } = hoistExtension('ext3', ext3);

      // Combine - namespace prevents collision
      const combined = { ...f1, ...f2, ...f3 };

      // Verify each namespace resolves to correct function
      const result1 = await run('ext1::test()', { functions: combined });
      const result2 = await run('ext2::test()', { functions: combined });
      const result3 = await run('ext3::test()', { functions: combined });

      expect(result1).toBe('ext1-test');
      expect(result2).toBe('ext2-test');
      expect(result3).toBe('ext3-test');

      // Verify all three functions coexist
      expect(Object.keys(combined)).toHaveLength(3);
      expect(combined['ext1::test']).toBeDefined();
      expect(combined['ext2::test']).toBeDefined();
      expect(combined['ext3::test']).toBeDefined();
    });

    it('supports dispose lifecycle for multiple extensions', async () => {
      const disposeLog: string[] = [];

      // Create extensions with dispose handlers
      const ext1: ExtensionResult = {
        work: { params: [], fn: () => 'ext1-work' },
        dispose: () => {
          disposeLog.push('ext1-disposed');
        },
      };

      const ext2: ExtensionResult = {
        work: { params: [], fn: () => 'ext2-work' },
        dispose: () => {
          disposeLog.push('ext2-disposed');
        },
      };

      const ext3: ExtensionResult = {
        work: { params: [], fn: () => 'ext3-work' },
        dispose: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          disposeLog.push('ext3-disposed');
        },
      };

      // Hoist all extensions
      const hoisted1 = hoistExtension('ext1', ext1);
      const hoisted2 = hoistExtension('ext2', ext2);
      const hoisted3 = hoistExtension('ext3', ext3);

      // Combine functions
      const allFunctions = {
        ...hoisted1.functions,
        ...hoisted2.functions,
        ...hoisted3.functions,
      };

      // Use all functions
      await run('ext1::work()', { functions: allFunctions });
      await run('ext2::work()', { functions: allFunctions });
      await run('ext3::work()', { functions: allFunctions });

      // Clean up all extensions
      hoisted1.dispose!();
      hoisted2.dispose!();
      await hoisted3.dispose!();

      // Verify all dispose handlers were called
      expect(disposeLog).toHaveLength(3);
      expect(disposeLog).toContain('ext1-disposed');
      expect(disposeLog).toContain('ext2-disposed');
      expect(disposeLog).toContain('ext3-disposed');
    });
  });
});
