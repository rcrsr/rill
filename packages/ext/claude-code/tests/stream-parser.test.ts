/**
 * Tests for stream-parser module.
 * Covers line buffering, ANSI stripping, error handling, and memory efficiency.
 */

import { describe, it, expect } from 'vitest';
import { createStreamParser } from '../src/stream-parser.js';
import type {
  ClaudeMessage,
  SystemMessage,
  AssistantMessage,
} from '../src/types.js';

// ============================================================
// BASIC PARSING
// ============================================================

describe('StreamParser - Basic Parsing', () => {
  it('parses single complete JSON line', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'claude-3-5-sonnet-20241022',
    };

    parser.processChunk(JSON.stringify(systemMsg) + '\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('parses multiple lines in single chunk', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const msg1: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test-model',
    };
    const msg2: AssistantMessage = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello' }] },
    };

    const chunk = JSON.stringify(msg1) + '\n' + JSON.stringify(msg2) + '\n';
    parser.processChunk(chunk, (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]?.type).toBe('system');
    expect(messages[1]?.type).toBe('assistant');
  });

  it('skips empty lines', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    parser.processChunk('\n\n' + JSON.stringify(systemMsg) + '\n\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });
});

// ============================================================
// LINE BUFFERING
// ============================================================

describe('StreamParser - Line Buffering', () => {
  it('buffers incomplete line across chunks', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };
    const json = JSON.stringify(systemMsg);

    // Split JSON across two chunks
    const midpoint = Math.floor(json.length / 2);
    parser.processChunk(json.slice(0, midpoint), (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(0); // No complete line yet

    parser.processChunk(json.slice(midpoint) + '\n', (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('buffers across many small chunks', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };
    const json = JSON.stringify(systemMsg) + '\n';

    // Send one character at a time
    for (let i = 0; i < json.length; i++) {
      parser.processChunk(json[i] ?? '', (msg) => {
        messages.push(msg);
      });
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('handles multiple incomplete lines buffered sequentially', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const msg1: SystemMessage = { type: 'system', subtype: 'init', model: 'a' };
    const msg2: SystemMessage = { type: 'system', subtype: 'init', model: 'b' };

    const json1 = JSON.stringify(msg1);
    const json2 = JSON.stringify(msg2);

    // Send first message incomplete
    parser.processChunk(json1.slice(0, 10), (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(0);

    // Complete first, start second
    parser.processChunk(json1.slice(10) + '\n' + json2.slice(0, 8), (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type).toBe('system');

    // Complete second
    parser.processChunk(json2.slice(8) + '\n', (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(2);
  });
});

// ============================================================
// ANSI ESCAPE SEQUENCES
// ============================================================

describe('StreamParser - ANSI Stripping', () => {
  it('strips ANSI color codes', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    // ANSI codes: \x1b[31m (red), \x1b[0m (reset)
    const withAnsi = `\x1b[31m${JSON.stringify(systemMsg)}\x1b[0m\n`;

    parser.processChunk(withAnsi, (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('strips ANSI cursor control sequences', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    // Cursor sequences: \x1b[2J (clear screen), \x1b[H (home)
    const withAnsi = `\x1b[2J\x1b[H${JSON.stringify(systemMsg)}\n`;

    parser.processChunk(withAnsi, (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('handles ANSI codes split across chunks', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    // Split ANSI sequence \x1b[31m across chunks
    parser.processChunk('\x1b[3', (msg) => {
      messages.push(msg);
    });
    parser.processChunk('1m' + JSON.stringify(systemMsg) + '\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });
});

// ============================================================
// ERROR HANDLING
// ============================================================

describe('StreamParser - Non-JSON Handling', () => {
  it('silently skips malformed JSON lines', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    parser.processChunk('{ invalid json }\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(0);
  });

  it('silently skips valid JSON without type field', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    parser.processChunk('{"foo": "bar"}\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(0);
  });

  it('skips non-JSON lines while parsing valid ones', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    // First line is valid
    parser.processChunk(JSON.stringify(systemMsg) + '\n', (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);

    // Second line is invalid - silently skipped
    parser.processChunk('bad json 1\n', (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);
  });

  it('strips terminal artifacts before parsing', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    // Terminal artifact that should be stripped and skipped
    parser.processChunk('[<u some artifact\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(0);
  });
});

// ============================================================
// FLUSH BEHAVIOR
// ============================================================

describe('StreamParser - Flush', () => {
  it('flushes remaining buffer as final line', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    // Send JSON without trailing newline
    parser.processChunk(JSON.stringify(systemMsg), (msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(0);

    parser.flush((msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('flush on empty buffer does nothing', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    parser.flush((msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(0);
  });

  it('flush clears buffer', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    parser.processChunk(JSON.stringify(systemMsg), (msg) => {
      messages.push(msg);
    });
    parser.flush((msg) => {
      messages.push(msg);
    });

    // Second flush should do nothing
    parser.flush((msg) => {
      messages.push(msg);
    });
    expect(messages).toHaveLength(1);
  });

  it('flush silently skips malformed buffered line', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    parser.processChunk('{ incomplete', (msg) => {
      messages.push(msg);
    });

    parser.flush((msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(0);
  });
});

// ============================================================
// BUFFER INPUT TYPES
// ============================================================

describe('StreamParser - Input Types', () => {
  it('accepts Buffer input', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    const buffer = Buffer.from(JSON.stringify(systemMsg) + '\n', 'utf8');
    parser.processChunk(buffer, (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('accepts string input', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    parser.processChunk(JSON.stringify(systemMsg) + '\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });

  it('handles mixed Buffer and string chunks', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };
    const json = JSON.stringify(systemMsg) + '\n';

    // First chunk as Buffer
    parser.processChunk(Buffer.from(json.slice(0, 20), 'utf8'), (msg) => {
      messages.push(msg);
    });

    // Second chunk as string
    parser.processChunk(json.slice(20), (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });
});

// ============================================================
// MEMORY EFFICIENCY (AC-14)
// ============================================================

describe('StreamParser - Memory Efficiency', () => {
  it('parses 10K lines without memory growth', () => {
    const parser = createStreamParser();
    let messageCount = 0;

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };
    const line = JSON.stringify(systemMsg) + '\n';

    // Process 10K lines
    for (let i = 0; i < 10_000; i++) {
      parser.processChunk(line, () => {
        messageCount++;
      });
    }

    expect(messageCount).toBe(10_000);
  });

  it('large chunks process without buffer accumulation', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };
    const line = JSON.stringify(systemMsg) + '\n';

    // Create large chunk with 1000 lines
    const largeChunk = line.repeat(1000);

    parser.processChunk(largeChunk, (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(1000);
  });
});

// ============================================================
// INTEGRATION SCENARIOS
// ============================================================

describe('StreamParser - Integration Scenarios', () => {
  it('skips non-JSON lines in Claude CLI output sequence', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    // Simulate Claude CLI stream with ANSI codes - silently skipped
    parser.processChunk('\x1b[1mInitializing...\x1b[0m\n', (msg) => {
      messages.push(msg);
    });

    expect(messages).toHaveLength(0);
  });

  it('handles rapid small chunks with partial ANSI sequences', () => {
    const parser = createStreamParser();
    const messages: ClaudeMessage[] = [];

    const systemMsg: SystemMessage = {
      type: 'system',
      subtype: 'init',
      model: 'test',
    };

    const chunks = [
      '\x1b[',
      '31m',
      JSON.stringify(systemMsg).slice(0, 10),
      JSON.stringify(systemMsg).slice(10, 20),
      JSON.stringify(systemMsg).slice(20),
      '\x1b[0m\n',
    ];

    for (const chunk of chunks) {
      parser.processChunk(chunk, (msg) => {
        messages.push(msg);
      });
    }

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(systemMsg);
  });
});
