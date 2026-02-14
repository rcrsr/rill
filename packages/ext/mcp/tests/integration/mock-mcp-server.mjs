#!/usr/bin/env node
/**
 * Mock MCP server for integration testing.
 *
 * This is a Node.js script that implements an MCP server using stdio transport.
 * It exposes tools, resources, and prompts for end-to-end testing.
 *
 * Usage: node mock-mcp-server.mjs
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ============================================================
// CREATE SERVER
// ============================================================

const server = new McpServer(
  {
    name: 'test-mock-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

// ============================================================
// REGISTER TOOLS
// ============================================================

// Tool with JSON result (tests AC-8: JSON text -> dict)
server.registerTool(
  'get_status',
  {
    description: 'Get server status as JSON',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ status: 'ok', uptime: 42 }),
        },
      ],
    };
  }
);

// Tool with plain text result (tests AC-8: plain text -> string)
server.registerTool(
  'echo',
  {
    description: 'Echo back a message',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    },
  },
  async (args) => {
    return {
      content: [
        {
          type: 'text',
          text: args.message,
        },
      ],
    };
  }
);

// Tool with image result (tests AC-8: image -> dict with type/data/mime)
server.registerTool(
  'get_image',
  {
    description: 'Get a test image',
    inputSchema: { type: 'object', properties: {} },
  },
  async () => {
    // Return base64-encoded 1x1 PNG
    return {
      content: [
        {
          type: 'image',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          mimeType: 'image/png',
        },
      ],
    };
  }
);

// Tool with parameters (tests composition)
server.registerTool(
  'add',
  {
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
  },
  async (args) => {
    const result = args.a + args.b;
    return {
      content: [
        {
          type: 'text',
          text: String(result),
        },
      ],
    };
  }
);

// ============================================================
// REGISTER RESOURCES
// ============================================================

// Static resource
server.registerResource(
  'test-doc',
  'file:///test/doc.txt',
  {
    description: 'Test document',
    mimeType: 'text/plain',
  },
  async () => {
    return {
      contents: [
        {
          uri: 'file:///test/doc.txt',
          mimeType: 'text/plain',
          text: 'This is a test document',
        },
      ],
    };
  }
);

// Resource template
server.registerResource(
  'user-profile',
  {
    uriTemplate: 'user://{id}/profile',
    variables: { id: { type: 'string' } },
  },
  {
    description: 'User profile by ID',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const userId = variables.id;
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            id: userId,
            name: `User ${userId}`,
            email: `user${userId}@example.com`,
          }),
        },
      ],
    };
  }
);

// ============================================================
// REGISTER PROMPTS
// ============================================================

// Prompt without arguments
server.registerPrompt(
  'greeting',
  {
    description: 'Generate a greeting',
  },
  async () => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Hello! How can I help you today?',
          },
        },
      ],
    };
  }
);

// Prompt with arguments
server.registerPrompt(
  'code_review',
  {
    description: 'Generate a code review prompt',
    arguments: [
      {
        name: 'language',
        description: 'Programming language',
        required: true,
      },
      {
        name: 'code',
        description: 'Code to review',
        required: true,
      },
    ],
  },
  async (args) => {
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please review this ${args.language} code:\n\n${args.code}`,
          },
        },
      ],
    };
  }
);

// ============================================================
// START SERVER
// ============================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep process alive - transport will handle all communication
  // Server will exit when client closes connection
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
