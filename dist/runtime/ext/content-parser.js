/**
 * Content Parser
 *
 * Auto-detects and extracts structured content from LLM responses.
 * Handles markdown code blocks, raw JSON, XML tags, YAML frontmatter,
 * checklists, and other common patterns.
 */
// ============================================================
// DETECTION PATTERNS
// ============================================================
const PATTERNS = {
    // Frontmatter: starts with ---\n and ends with ---\n
    frontmatter: /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/,
    // Fenced code block: ```lang\ncontent\n```
    fence: /```(\w*)\r?\n([\s\S]*?)```/,
    fenceAll: /```(\w*)\r?\n([\s\S]*?)```/g,
    // XML tags: <tag>content</tag>
    xmlTag: /<(\w+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/,
    xmlTagNamed: (tag) => new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`),
    xmlTagAll: /<(\w+)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g,
    // JSON object or array (with possible preamble)
    jsonObject: /\{[\s\S]*\}/,
    jsonArray: /\[[\s\S]*\]/,
    // YAML-like key: value patterns
    yaml: /^\w+:\s+.+$/m,
    // Checklist items
    checklist: /^[-*]\s*\[([ xX])\]\s*(.+)$/gm,
    checklistSingle: /^[-*]\s*\[([ xX])\]\s*(.+)$/m,
};
/**
 * Attempt to repair common JSON formatting errors.
 */
function repairJson(text) {
    const repairs = [];
    let result = text;
    // Remove trailing commas before } or ]
    const trailingComma = /,(\s*[}\]])/g;
    if (trailingComma.test(result)) {
        result = result.replace(trailingComma, '$1');
        repairs.push('removed trailing commas');
    }
    // Convert single quotes to double quotes (for string values)
    // This is tricky - only convert quotes that look like string delimiters
    const singleQuotePattern = /:\s*'([^']*?)'/g;
    if (singleQuotePattern.test(result)) {
        result = result.replace(singleQuotePattern, ': "$1"');
        repairs.push('converted single quotes to double quotes');
    }
    // Quote unquoted keys
    const unquotedKey = /([{,]\s*)(\w+)(\s*:)/g;
    const needsQuoting = unquotedKey.test(result);
    if (needsQuoting) {
        result = result.replace(unquotedKey, '$1"$2"$3');
        repairs.push('quoted unquoted keys');
    }
    // Try to close unclosed braces/brackets
    let openBraces = 0;
    let openBrackets = 0;
    for (const char of result) {
        if (char === '{')
            openBraces++;
        if (char === '}')
            openBraces--;
        if (char === '[')
            openBrackets++;
        if (char === ']')
            openBrackets--;
    }
    if (openBraces > 0) {
        result += '}'.repeat(openBraces);
        repairs.push(`closed ${openBraces} unclosed brace(s)`);
    }
    if (openBrackets > 0) {
        result += ']'.repeat(openBrackets);
        repairs.push(`closed ${openBrackets} unclosed bracket(s)`);
    }
    return { text: result, repairs };
}
/**
 * Extract and parse frontmatter from document.
 */
function extractFrontmatter(text, _options) {
    const match = PATTERNS.frontmatter.exec(text);
    if (!match)
        return null;
    const [, yamlContent, body] = match;
    if (!yamlContent)
        return null;
    try {
        // Parse YAML manually (simple key: value format)
        const data = parseSimpleYaml(yamlContent);
        return {
            raw: yamlContent,
            parsed: { meta: data, body: body?.trim() ?? '' },
            confidence: 0.95,
            repaired: false,
            repairs: [],
        };
    }
    catch {
        return null;
    }
}
/**
 * Extract content from fenced code blocks.
 */
function extractFence(text, options) {
    const match = PATTERNS.fence.exec(text);
    if (!match)
        return null;
    const [, lang, content] = match;
    if (!content)
        return null;
    const trimmed = content.trim();
    const langLower = (lang ?? '').toLowerCase();
    // If JSON fence, parse as JSON
    if (langLower === 'json') {
        const jsonResult = parseJsonWithRepair(trimmed, !options.strict);
        if (jsonResult) {
            return {
                raw: trimmed,
                parsed: jsonResult.data,
                confidence: jsonResult.repaired ? 0.85 : 0.98,
                repaired: jsonResult.repaired,
                repairs: jsonResult.repairs,
            };
        }
    }
    // If YAML fence, parse as YAML
    if (langLower === 'yaml' || langLower === 'yml') {
        try {
            const data = parseSimpleYaml(trimmed);
            return {
                raw: trimmed,
                parsed: data,
                confidence: 0.95,
                repaired: false,
                repairs: [],
            };
        }
        catch {
            // Fall through to return raw content
        }
    }
    // Return raw content for other languages
    return {
        raw: trimmed,
        parsed: trimmed,
        confidence: 0.9,
        repaired: false,
        repairs: [],
    };
}
/**
 * Extract content from XML tags.
 */
function extractXml(text, options) {
    // If a specific tag is requested, extract just that
    if (options.tag) {
        const pattern = PATTERNS.xmlTagNamed(options.tag);
        const match = pattern.exec(text);
        if (!match || !match[1])
            return null;
        return {
            raw: match[1].trim(),
            parsed: match[1].trim(),
            confidence: 0.95,
            repaired: false,
            repairs: [],
        };
    }
    // Find all XML tags and extract their content
    const matches = text.match(PATTERNS.xmlTagAll);
    if (!matches || matches.length === 0)
        return null;
    // Parse into a dict of tag -> content
    const data = {};
    let rawParts = [];
    for (const fullMatch of matches) {
        const tagMatch = /<(\w+)(?:\s[^>]*)?>/.exec(fullMatch);
        if (!tagMatch || !tagMatch[1])
            continue;
        const tagName = tagMatch[1];
        const contentPattern = PATTERNS.xmlTagNamed(tagName);
        const contentMatch = contentPattern.exec(fullMatch);
        if (contentMatch && contentMatch[1]) {
            const content = contentMatch[1].trim();
            data[tagName] = content;
            rawParts.push(fullMatch);
        }
    }
    if (Object.keys(data).length === 0)
        return null;
    return {
        raw: rawParts.join('\n'),
        parsed: data,
        confidence: 0.92,
        repaired: false,
        repairs: [],
    };
}
/**
 * Extract raw JSON from text (handling preamble/postamble).
 */
function extractJson(text, options) {
    // Try to find JSON object
    let match = PATTERNS.jsonObject.exec(text);
    if (!match) {
        // Try array
        match = PATTERNS.jsonArray.exec(text);
    }
    if (!match)
        return null;
    const jsonText = match[0];
    const result = parseJsonWithRepair(jsonText, !options.strict);
    if (!result)
        return null;
    // Lower confidence if JSON was found with preamble/postamble
    const hasPreamble = text.indexOf(jsonText) > 0;
    const hasPostamble = text.indexOf(jsonText) + jsonText.length < text.length;
    let confidence = result.repaired ? 0.8 : 0.9;
    if (hasPreamble || hasPostamble) {
        confidence -= 0.05;
    }
    return {
        raw: jsonText,
        parsed: result.data,
        confidence,
        repaired: result.repaired,
        repairs: result.repairs,
    };
}
/**
 * Extract checklist items.
 */
function extractChecklist(text, _options) {
    const items = [];
    const rawLines = [];
    let match;
    const pattern = new RegExp(PATTERNS.checklist.source, 'gm');
    while ((match = pattern.exec(text)) !== null) {
        const checked = match[1]?.toLowerCase() === 'x';
        const content = match[2]?.trim() ?? '';
        items.push([checked, content]);
        rawLines.push(match[0]);
    }
    if (items.length === 0)
        return null;
    return {
        raw: rawLines.join('\n'),
        parsed: items,
        confidence: 0.92,
        repaired: false,
        repairs: [],
    };
}
/**
 * Extract YAML content (without frontmatter delimiters).
 */
function extractYaml(text, _options) {
    // Only try if it looks YAML-ish and not like other formats
    if (!PATTERNS.yaml.test(text))
        return null;
    if (PATTERNS.jsonObject.test(text))
        return null;
    if (PATTERNS.xmlTag.test(text))
        return null;
    // Don't match YAML if text contains checklist items
    if (PATTERNS.checklistSingle.test(text))
        return null;
    // Require multiple key: value lines to be confident it's YAML
    const yamlLines = text
        .split('\n')
        .filter((line) => /^\w+:\s+.+$/.test(line.trim()));
    if (yamlLines.length < 2)
        return null;
    try {
        const data = parseSimpleYaml(text.trim());
        return {
            raw: text.trim(),
            parsed: data,
            confidence: 0.75, // Lower confidence for bare YAML
            repaired: false,
            repairs: [],
        };
    }
    catch {
        return null;
    }
}
/**
 * Parse JSON with optional repair.
 */
function parseJsonWithRepair(text, attemptRepair) {
    // Try parsing as-is
    try {
        const data = JSON.parse(text);
        return { data, repaired: false, repairs: [] };
    }
    catch {
        if (!attemptRepair)
            return null;
    }
    // Attempt repair
    const { text: repairedText, repairs } = repairJson(text);
    if (repairs.length === 0)
        return null;
    try {
        const data = JSON.parse(repairedText);
        return { data, repaired: true, repairs };
    }
    catch {
        return null;
    }
}
/**
 * Simple YAML parser for key: value format.
 * Does not handle full YAML spec - just common LLM output patterns.
 */
function parseSimpleYaml(text) {
    const result = {};
    const lines = text.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx === -1)
            continue;
        const key = trimmed.slice(0, colonIdx).trim();
        let value = trimmed.slice(colonIdx + 1).trim();
        // Parse value type
        if (value === 'true')
            value = true;
        else if (value === 'false')
            value = false;
        else if (value === 'null' || value === '~')
            value = null;
        else if (/^-?\d+$/.test(value))
            value = parseInt(value, 10);
        else if (/^-?\d+\.\d+$/.test(value))
            value = parseFloat(value);
        else if (value.startsWith('[') && value.endsWith(']')) {
            // Simple array: [a, b, c]
            try {
                value = JSON.parse(value);
            }
            catch {
                // Keep as string if JSON parse fails
            }
        }
        else if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        }
        result[key] = value;
    }
    return result;
}
// ============================================================
// MAIN SMART PARSE FUNCTION
// ============================================================
/**
 * Auto-detect and parse structured content from LLM output.
 *
 * Detection priority:
 * 1. Frontmatter (---\n...\n---\n)
 * 2. Fenced JSON/YAML (```json or ```yaml)
 * 3. Other fenced blocks (```lang)
 * 4. XML tags (<tag>...</tag>)
 * 5. Raw JSON ({...} or [...])
 * 6. Raw YAML (key: value patterns)
 * 7. Checklist (- [ ] or - [x])
 * 8. Plain text (fallback)
 */
export function parse(text, options = {}) {
    const trimmed = text.trim();
    // Detection order (most specific first)
    const detectors = [
        { type: 'frontmatter', extract: extractFrontmatter },
        { type: 'fence', extract: extractFence },
        { type: 'xml', extract: extractXml },
        { type: 'json', extract: extractJson },
        { type: 'yaml', extract: extractYaml },
        { type: 'checklist', extract: extractChecklist },
    ];
    // If a format is preferred, try it first
    if (options.prefer) {
        const preferred = detectors.find((d) => d.type === options.prefer);
        if (preferred) {
            const result = preferred.extract(trimmed, options);
            if (result && (!options.strict || result.confidence >= 0.9)) {
                return {
                    type: preferred.type === 'fence'
                        ? detectFenceType(trimmed)
                        : preferred.type,
                    data: result.parsed,
                    raw: result.raw,
                    confidence: result.confidence,
                    repaired: result.repaired,
                    repairs: result.repairs,
                };
            }
        }
    }
    // Try each detector in order
    for (const { type, extract } of detectors) {
        const result = extract(trimmed, options);
        if (result) {
            // In strict mode, require higher confidence
            if (options.strict && result.confidence < 0.9)
                continue;
            return {
                type: type === 'fence' ? detectFenceType(trimmed) : type,
                data: result.parsed,
                raw: result.raw,
                confidence: result.confidence,
                repaired: result.repaired,
                repairs: result.repairs,
            };
        }
    }
    // Fallback: return as plain text
    return {
        type: 'text',
        data: trimmed,
        raw: trimmed,
        confidence: 1.0,
        repaired: false,
        repairs: [],
    };
}
/**
 * Detect the actual content type of a fenced block.
 */
function detectFenceType(text) {
    const match = PATTERNS.fence.exec(text);
    if (!match)
        return 'fence';
    const lang = (match[1] ?? '').toLowerCase();
    if (lang === 'json')
        return 'json';
    if (lang === 'yaml' || lang === 'yml')
        return 'yaml';
    if (lang === 'xml')
        return 'xml';
    return 'fence';
}
// ============================================================
// CONVENIENCE EXTRACTORS
// ============================================================
/**
 * Extract content from a specific fenced code block type.
 */
export function extractFenceByLang(text, lang) {
    const pattern = new RegExp(`\`\`\`${lang}\\r?\\n([\\s\\S]*?)\`\`\``, 'i');
    const match = pattern.exec(text);
    return match ? (match[1]?.trim() ?? null) : null;
}
/**
 * Extract all fenced code blocks with their language tags.
 */
export function extractAllFences(text) {
    const results = [];
    let match;
    const pattern = new RegExp(PATTERNS.fenceAll.source, 'g');
    while ((match = pattern.exec(text)) !== null) {
        results.push({
            lang: match[1] ?? '',
            content: match[2]?.trim() ?? '',
        });
    }
    return results;
}
/**
 * Extract content from a named XML tag.
 */
export function extractXmlTag(text, tagName) {
    const pattern = PATTERNS.xmlTagNamed(tagName);
    const match = pattern.exec(text);
    return match ? (match[1]?.trim() ?? null) : null;
}
/**
 * Extract all instances of a named XML tag.
 */
export function extractAllXmlTags(text, tagName) {
    const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g');
    const results = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        if (match[1]) {
            results.push(match[1].trim());
        }
    }
    return results;
}
/**
 * Parse JSON with automatic repair of common errors.
 */
export function parseJson(text, repair = true) {
    const result = parseJsonWithRepair(text.trim(), repair);
    return result ? result.data : null;
}
/**
 * Extract frontmatter and body from a document.
 */
export function parseFrontmatter(text) {
    const match = PATTERNS.frontmatter.exec(text);
    if (!match || !match[1])
        return null;
    try {
        const meta = parseSimpleYaml(match[1]);
        return { meta, body: (match[2] ?? '').trim() };
    }
    catch {
        return null;
    }
}
/**
 * Parse checklist items.
 */
export function parseChecklist(text) {
    const items = [];
    let match;
    const pattern = new RegExp(PATTERNS.checklist.source, 'gm');
    while ((match = pattern.exec(text)) !== null) {
        items.push({
            checked: match[1]?.toLowerCase() === 'x',
            text: match[2]?.trim() ?? '',
        });
    }
    return items;
}
//# sourceMappingURL=content-parser.js.map