/**
 * Content Parser Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parse,
  extractFenceByLang,
  extractAllFences,
  extractXmlTag,
  extractAllXmlTags,
  parseJson,
  parseFrontmatter,
  parseChecklist,
} from '../../src/runtime/ext/content-parser.js';

describe('parse', () => {
  describe('parse_frontmatter detection', () => {
    it('parses YAML frontmatter', () => {
      const input = `---
title: My Document
status: draft
count: 42
---

# Content here

Some body text.`;

      const result = parse(input);
      expect(result.type).toBe('frontmatter');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.data).toEqual({
        meta: {
          title: 'My Document',
          status: 'draft',
          count: 42,
        },
        body: '# Content here\n\nSome body text.',
      });
    });

    it('handles boolean values in frontmatter', () => {
      const input = `---
published: true
draft: false
---
Body`;

      const result = parse(input);
      expect(result.type).toBe('frontmatter');
      expect((result.data as any).meta.published).toBe(true);
      expect((result.data as any).meta.draft).toBe(false);
    });
  });

  describe('parse_fenced code block detection', () => {
    it('extracts JSON from fenced block', () => {
      const input = `Here's the data:

\`\`\`json
{"name": "test", "count": 42}
\`\`\`

Hope this helps!`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.data).toEqual({ name: 'test', count: 42 });
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('extracts YAML from fenced block', () => {
      const input = `\`\`\`yaml
name: test
count: 42
\`\`\``;

      const result = parse(input);
      expect(result.type).toBe('yaml');
      expect(result.data).toEqual({ name: 'test', count: 42 });
    });

    it('returns raw content for other languages', () => {
      const input = `\`\`\`python
def hello():
    print("world")
\`\`\``;

      const result = parse(input);
      expect(result.type).toBe('fence');
      expect(result.data).toBe('def hello():\n    print("world")');
    });
  });

  describe('XML tag detection', () => {
    it('extracts single XML tag', () => {
      const input = `<thinking>
Step 1: Analyze the problem
Step 2: Find solution
</thinking>`;

      const result = parse(input);
      expect(result.type).toBe('xml');
      expect((result.data as any).thinking).toContain('Step 1');
    });

    it('extracts multiple XML tags', () => {
      const input = `<thinking>First think about it</thinking>
<answer>42</answer>`;

      const result = parse(input);
      expect(result.type).toBe('xml');
      expect((result.data as any).thinking).toBe('First think about it');
      expect((result.data as any).answer).toBe('42');
    });

    it('extracts specific tag with option', () => {
      const input = `<analysis>detailed analysis</analysis>
<answer>the answer</answer>`;

      const result = parse(input, { tag: 'answer' });
      expect(result.type).toBe('xml');
      expect(result.data).toBe('the answer');
    });
  });

  describe('raw JSON detection', () => {
    it('extracts JSON object with preamble', () => {
      const input = `The result is {"status": "ok", "items": [1, 2, 3]}.`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.data).toEqual({ status: 'ok', items: [1, 2, 3] });
    });

    it('extracts JSON array', () => {
      const input = `Here are the items: [1, 2, 3, 4, 5]`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.data).toEqual([1, 2, 3, 4, 5]);
    });

    it('repairs trailing commas', () => {
      const input = `{"name": "test", "items": [1, 2, 3,],}`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.data).toEqual({ name: 'test', items: [1, 2, 3] });
      expect(result.repaired).toBe(true);
      expect(result.repairs).toContain('removed trailing commas');
    });

    it('repairs unquoted keys', () => {
      const input = `{name: "test", count: 42}`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.data).toEqual({ name: 'test', count: 42 });
      expect(result.repaired).toBe(true);
    });

    it('repairs unclosed braces', () => {
      const input = `{"name": "test", "nested": {"value": 1}`;

      const result = parse(input);
      expect(result.type).toBe('json');
      expect(result.repaired).toBe(true);
      expect(result.repairs.some((r) => r.includes('unclosed'))).toBe(true);
    });

    it('strict mode rejects repaired JSON', () => {
      const input = `{name: "test"}`;

      const result = parse(input, { strict: true });
      // Should fall through to text since repair is disabled
      expect(result.type).toBe('text');
    });
  });

  describe('parse_checklist detection', () => {
    it('parses checklist items', () => {
      const input = `Tasks:
- [ ] Buy milk
- [x] Call mom
- [ ] Code review
- [X] Deploy to prod`;

      const result = parse(input);
      expect(result.type).toBe('checklist');
      expect(result.data).toEqual([
        [false, 'Buy milk'],
        [true, 'Call mom'],
        [false, 'Code review'],
        [true, 'Deploy to prod'],
      ]);
    });

    it('handles asterisk bullets', () => {
      const input = `* [ ] Task one
* [x] Task two`;

      const result = parse(input);
      expect(result.type).toBe('checklist');
      expect(result.data).toEqual([
        [false, 'Task one'],
        [true, 'Task two'],
      ]);
    });
  });

  describe('YAML detection', () => {
    it('parses bare YAML content', () => {
      const input = `name: John Doe
age: 30
active: true`;

      const result = parse(input);
      expect(result.type).toBe('yaml');
      expect(result.data).toEqual({
        name: 'John Doe',
        age: 30,
        active: true,
      });
    });
  });

  describe('text fallback', () => {
    it('returns text for unstructured content', () => {
      const input = `Just some regular text without any structure.`;

      const result = parse(input);
      expect(result.type).toBe('text');
      expect(result.data).toBe(input);
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('prefer option', () => {
    it('tries preferred format first', () => {
      // This could be parsed as JSON or XML
      const input = `<data>{"key": "value"}</data>`;

      const xmlResult = parse(input, { prefer: 'xml' });
      expect(xmlResult.type).toBe('xml');

      // Without prefer, XML is tried before JSON anyway
      const autoResult = parse(input);
      expect(autoResult.type).toBe('xml');
    });
  });
});

describe('extractFenceByLang', () => {
  it('extracts content by language', () => {
    const input = `\`\`\`json
{"test": true}
\`\`\``;

    expect(extractFenceByLang(input, 'json')).toBe('{"test": true}');
  });

  it('returns null when not found', () => {
    const input = `\`\`\`python
print("hi")
\`\`\``;

    expect(extractFenceByLang(input, 'json')).toBeNull();
  });
});

describe('extractAllFences', () => {
  it('extracts all fenced blocks', () => {
    const input = `First block:
\`\`\`json
{"a": 1}
\`\`\`

Second block:
\`\`\`python
print("hello")
\`\`\``;

    const fences = extractAllFences(input);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toEqual({ lang: 'json', content: '{"a": 1}' });
    expect(fences[1]).toEqual({ lang: 'python', content: 'print("hello")' });
  });
});

describe('extractXmlTag', () => {
  it('extracts named tag content', () => {
    const input = `<thinking>deep thoughts</thinking>
<answer>42</answer>`;

    expect(extractXmlTag(input, 'thinking')).toBe('deep thoughts');
    expect(extractXmlTag(input, 'answer')).toBe('42');
    expect(extractXmlTag(input, 'missing')).toBeNull();
  });
});

describe('extractAllXmlTags', () => {
  it('extracts all instances of a tag', () => {
    const input = `<step>First</step>
<step>Second</step>
<step>Third</step>`;

    const steps = extractAllXmlTags(input, 'step');
    expect(steps).toEqual(['First', 'Second', 'Third']);
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it('repairs invalid JSON by default', () => {
    expect(parseJson('{a: 1}')).toEqual({ a: 1 });
  });

  it('returns null for unparseable JSON without repair', () => {
    expect(parseJson('{a: 1}', false)).toBeNull();
  });
});

describe('parseFrontmatter', () => {
  it('parses frontmatter and body', () => {
    const input = `---
title: Test
---
Body content`;

    const result = parseFrontmatter(input);
    expect(result).toEqual({
      meta: { title: 'Test' },
      body: 'Body content',
    });
  });

  it('returns null for non-frontmatter', () => {
    expect(parseFrontmatter('No frontmatter here')).toBeNull();
  });
});

describe('parseChecklist', () => {
  it('parses checklist items', () => {
    const input = `- [ ] Todo
- [x] Done`;

    const items = parseChecklist(input);
    expect(items).toEqual([
      { checked: false, text: 'Todo' },
      { checked: true, text: 'Done' },
    ]);
  });

  it('returns empty array for no checklist', () => {
    expect(parseChecklist('No checklist')).toEqual([]);
  });
});

describe('edge cases', () => {
  it('handles empty input', () => {
    const result = parse('');
    expect(result.type).toBe('text');
    expect(result.data).toBe('');
  });

  it('handles whitespace-only input', () => {
    const result = parse('   \n\n   ');
    expect(result.type).toBe('text');
    expect(result.data).toBe('');
  });

  it('handles nested code blocks in fenced block', () => {
    const input = `\`\`\`markdown
Here's some code:
\\\`\\\`\\\`json
{"nested": true}
\\\`\\\`\\\`
\`\`\``;

    const result = parse(input);
    expect(result.type).toBe('fence');
  });

  it('handles malformed XML gracefully', () => {
    const input = `<thinking>unclosed tag`;

    const result = parse(input);
    // Should not crash, falls back to text
    expect(result.type).toBe('text');
  });

  it('prefers fenced JSON over raw JSON', () => {
    const input = `\`\`\`json
{"fenced": true}
\`\`\`

Also: {"raw": true}`;

    const result = parse(input);
    expect(result.type).toBe('json');
    expect(result.data).toEqual({ fenced: true });
  });

  it('handles tool call XML format', () => {
    const input = `<tool_call>
<function>search_database</function>
<arguments>
<query>find users</query>
<limit>10</limit>
</arguments>
</tool_call>`;

    const result = parse(input);
    expect(result.type).toBe('xml');
    expect(result.data).toHaveProperty('tool_call');
  });
});

// ============================================================
// RUNTIME INTEGRATION TESTS
// ============================================================

import { run } from '../helpers/runtime.js';

describe('Content Parsing: Runtime Integration', () => {
  describe('parse_json()', () => {
    it('parses valid JSON', async () => {
      // Escape braces with {{ }} to avoid interpolation
      const result = await run(
        `"{{\\\"a\\\": 1, \\\"b\\\": 2}}" -> parse_json`
      );
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('repairs and parses invalid JSON', async () => {
      // Unquoted keys - JSON repair handles this
      // Escape braces with {{ }} to avoid interpolation
      const result = await run(`"{{a: 1, b: 2}}" -> parse_json`);
      expect(result).toEqual({ a: 1, b: 2 });
    });

    it('returns empty dict on failure', async () => {
      const result = await run(`"not json at all" -> parse_json`);
      expect(result).toEqual({});
    });

    it('parses JSON array', async () => {
      const result = await run(`"[1, 2, 3]" -> parse_json`);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('parse_auto()', () => {
    it('returns dict with type, data, raw, confidence, repaired, repairs', async () => {
      // Escape braces with {{ }} to avoid interpolation
      const result = (await run(
        `"{{\\\"test\\\": true}}" -> parse_auto`
      )) as Record<string, unknown>;
      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('raw');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('repaired');
      expect(result).toHaveProperty('repairs');
    });

    it('detects JSON', async () => {
      // Escape braces with {{ }} to avoid interpolation
      const result = (await run(
        `"{{\\\"test\\\": true}}" -> parse_auto`
      )) as Record<string, unknown>;
      expect(result.type).toBe('json');
      expect(result.data).toEqual({ test: true });
    });

    it('detects XML', async () => {
      const result = (await run(
        `"<answer>42</answer>" -> parse_auto`
      )) as Record<string, unknown>;
      expect(result.type).toBe('xml');
    });

    it('falls back to text', async () => {
      const result = (await run(`"plain text" -> parse_auto`)) as Record<
        string,
        unknown
      >;
      expect(result.type).toBe('text');
      expect(result.data).toBe('plain text');
    });
  });

  describe('parse_xml()', () => {
    it('extracts specific tag content', async () => {
      const result = await run(
        `"<thinking>deep thoughts</thinking><answer>42</answer>" -> parse_xml("answer")`
      );
      expect(result).toBe('42');
    });

    it('returns empty string when tag not found', async () => {
      const result = await run(
        `"<other>content</other>" -> parse_xml("missing")`
      );
      expect(result).toBe('');
    });

    it('extracts all tags as dict without tag argument', async () => {
      const result = (await run(`"<a>1</a><b>2</b>" -> parse_xml`)) as Record<
        string,
        string
      >;
      expect(result.a).toBe('1');
      expect(result.b).toBe('2');
    });
  });

  describe('parse_fence()', () => {
    it('extracts first fenced block without language', async () => {
      // Triple-quote strings can't be directly piped; wrap in block and invoke
      const result = await run(`"" -> {
"""
\`\`\`
code here
\`\`\`
"""
} => $input
$input -> parse_fence`);
      expect(result).toBe('code here');
    });

    it('extracts fenced block by language', async () => {
      const result = await run(`"" -> {
"""
\`\`\`python
print("hi")
\`\`\`
"""
} => $input
$input -> parse_fence("python")`);
      expect(result).toBe('print("hi")');
    });

    it('returns empty string when not found', async () => {
      const result = await run(`"no fence here" -> parse_fence`);
      expect(result).toBe('');
    });

    it('returns empty string when language not found', async () => {
      const result = await run(`"" -> {
"""
\`\`\`js
code
\`\`\`
"""
} => $input
$input -> parse_fence("python")`);
      expect(result).toBe('');
    });
  });

  describe('parse_fences()', () => {
    it('extracts all fenced blocks', async () => {
      const result = (await run(`"" -> {
"""
\`\`\`js
a
\`\`\`
\`\`\`py
b
\`\`\`
"""
} => $input
$input -> parse_fences`)) as Array<{ lang: string; content: string }>;
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ lang: 'js', content: 'a' });
      expect(result[1]).toEqual({ lang: 'py', content: 'b' });
    });

    it('returns empty list when no fences', async () => {
      const result = await run(`"no fences" -> parse_fences`);
      expect(result).toEqual([]);
    });
  });

  describe('parse_frontmatter()', () => {
    it('parses frontmatter and body', async () => {
      const result = (await run(`"" -> {
"""
---
title: Test
---
Body content
"""
} => $input
$input -> parse_frontmatter`)) as {
        meta: Record<string, unknown>;
        body: string;
      };
      expect(result.meta).toEqual({ title: 'Test' });
      expect(result.body).toBe('Body content');
    });

    it('returns empty meta and body when no frontmatter', async () => {
      const result = (await run(
        `"No frontmatter here" -> parse_frontmatter`
      )) as {
        meta: Record<string, unknown>;
        body: string;
      };
      expect(result.meta).toEqual({});
      expect(result.body).toBe('');
    });
  });

  describe('parse_checklist()', () => {
    it('parses checklist items as [checked, text] tuples', async () => {
      const result = await run(`"" -> {
"""
- [ ] Todo
- [x] Done
"""
} => $input
$input -> parse_checklist`);
      expect(result).toEqual([
        [false, 'Todo'],
        [true, 'Done'],
      ]);
    });

    it('returns empty list when no checklist', async () => {
      const result = await run(`"no checklist" -> parse_checklist`);
      expect(result).toEqual([]);
    });
  });
});
