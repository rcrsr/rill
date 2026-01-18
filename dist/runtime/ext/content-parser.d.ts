/**
 * Content Parser
 *
 * Auto-detects and extracts structured content from LLM responses.
 * Handles markdown code blocks, raw JSON, XML tags, YAML frontmatter,
 * checklists, and other common patterns.
 */
import type { RillValue } from '../core/values.js';
export type ParseType = 'json' | 'xml' | 'yaml' | 'frontmatter' | 'fence' | 'checklist' | 'text';
export interface ParseResult {
    /** Detected format type */
    type: ParseType;
    /** Parsed structured data */
    data: RillValue;
    /** Original extracted content (before parsing) */
    raw: string;
    /** Detection confidence (0.0-1.0) */
    confidence: number;
    /** Whether error recovery was applied */
    repaired: boolean;
    /** List of repairs made (if any) */
    repairs: string[];
}
export interface ParseOptions {
    /** Prefer a specific format when ambiguous */
    prefer?: ParseType;
    /** Strict mode - no repairs, higher confidence threshold */
    strict?: boolean;
    /** Specific XML tag to extract */
    tag?: string;
}
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
export declare function parse(text: string, options?: ParseOptions): ParseResult;
/**
 * Extract content from a specific fenced code block type.
 */
export declare function extractFenceByLang(text: string, lang: string): string | null;
/**
 * Extract all fenced code blocks with their language tags.
 */
export declare function extractAllFences(text: string): Array<{
    lang: string;
    content: string;
}>;
/**
 * Extract content from a named XML tag.
 */
export declare function extractXmlTag(text: string, tagName: string): string | null;
/**
 * Extract all instances of a named XML tag.
 */
export declare function extractAllXmlTags(text: string, tagName: string): string[];
/**
 * Parse JSON with automatic repair of common errors.
 */
export declare function parseJson(text: string, repair?: boolean): RillValue | null;
/**
 * Extract frontmatter and body from a document.
 */
export declare function parseFrontmatter(text: string): {
    meta: Record<string, RillValue>;
    body: string;
} | null;
/**
 * Parse checklist items.
 */
export declare function parseChecklist(text: string): Array<{
    checked: boolean;
    text: string;
}>;
//# sourceMappingURL=content-parser.d.ts.map