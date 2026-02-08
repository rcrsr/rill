---
type: specification
last-modified: 2026-02-08
status: draft
---

# Copy Link: URL-Based Code Sharing

## Problem Statement

Fiddle users cannot share rill code snippets with others. The editor state persists only to localStorage on the same browser. Users need a way to encode their current editor code into a URL and copy it to the clipboard, so recipients can open the link and see the same code.

## Architecture Overview

```
User clicks "Copy Link"
    |
    v
App.tsx reads current `source` state
    |
    v
src/lib/sharing.ts encodes source -> compressed base64url string
    |
    v
Constructs URL with `?code=<encoded>` query parameter
    |
    v
Copies URL to clipboard via navigator.clipboard.writeText()
    |
    v
Toolbar shows brief "Copied!" feedback

---

Recipient opens URL
    |
    v
App.tsx reads `?code=` from window.location on mount
    |
    v
src/lib/sharing.ts decodes base64url -> decompressed source string
    |
    v
App.tsx sets `source` state (overrides localStorage default)
    |
    v
Editor displays the shared code
```

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| `src/lib/sharing.ts` | Encode/decode logic, URL construction, clipboard write |
| `src/App.tsx` | Read URL on mount, wire `onCopyLink` callback to Toolbar |
| `src/components/Toolbar.tsx` | Render Copy Link button, show feedback state |

### Data Flow

1. **Encode path**: `source` string -> UTF-8 bytes -> gzip compress -> base64url encode -> query param
2. **Decode path**: query param -> base64url decode -> gzip decompress -> UTF-8 string -> `source` state

## Data Model

### URL Parameter Schema

| Parameter | Type | Constraints |
|-----------|------|-------------|
| `code` | string | Base64url-encoded gzip-compressed UTF-8 source. Max encoded length: 8,192 characters. |

### Defaults and Nullability

| Condition | Behavior |
|-----------|----------|
| No `?code=` parameter | Load from localStorage (existing behavior) |
| Empty `code` value | Ignore, load from localStorage |
| Invalid base64url data | Ignore, load from localStorage, log warning |
| Decompression failure | Ignore, load from localStorage, log warning |
| Decoded string empty | Ignore, load from localStorage |

### Migration Strategy

No migration needed. This feature adds a new URL parameter without changing existing localStorage persistence.

## Interface Definitions

### `src/lib/sharing.ts`

```typescript
/**
 * Encode rill source code for URL sharing.
 *
 * Pipeline: UTF-8 encode -> gzip compress -> base64url encode
 *
 * Constraints:
 * - Uses built-in CompressionStream API (no external dependency)
 * - Output uses base64url alphabet (A-Z, a-z, 0-9, -, _) with no padding
 * - Returns null if encoded result exceeds MAX_URL_CODE_LENGTH
 *
 * Reference: src/lib/persistence.ts for graceful error handling pattern
 */
export async function encodeSource(source: string): Promise<string | null>;

/**
 * Decode a URL-shared code string back to rill source.
 *
 * Pipeline: base64url decode -> gzip decompress -> UTF-8 decode
 *
 * Constraints:
 * - Returns null on any decode/decompress failure (no throws)
 * - Handles missing padding characters in base64url input
 */
export async function decodeSource(encoded: string): Promise<string | null>;

/**
 * Read source code from the current URL's query parameters.
 *
 * Constraints:
 * - Reads `code` parameter from window.location.search
 * - Returns null if parameter absent, empty, or decode fails
 * - Cleans URL by removing `code` param via history.replaceState after read
 */
export async function readSourceFromURL(): Promise<string | null>;

/**
 * Build a shareable URL and copy it to the clipboard.
 *
 * Constraints:
 * - Uses window.location.origin + window.location.pathname as base
 * - Appends `?code=<encoded>` query parameter
 * - Copies full URL to clipboard via navigator.clipboard.writeText
 * - Returns status object indicating success, size-exceeded, or clipboard-error
 */
export async function copyLinkToClipboard(
  source: string
): Promise<CopyLinkResult>;

/** Maximum encoded length for the `code` query parameter value */
export const MAX_URL_CODE_LENGTH: number; // 8192

/** Result of a copy-link operation */
export interface CopyLinkResult {
  status: 'copied' | 'too-large' | 'error';
  /** URL that was copied (only when status is 'copied') */
  url?: string;
  /** Human-readable message for UI display */
  message: string;
}
```

#### Error Contracts

| Condition | Return Value | Side Effect |
|-----------|-------------|-------------|
| Source empty or whitespace-only | `{ status: 'error', message: '...' }` | None |
| Encoded output exceeds 8,192 chars | `{ status: 'too-large', message: '...' }` | None |
| CompressionStream unavailable | `{ status: 'error', message: '...' }` | `console.warn` |
| navigator.clipboard unavailable | `{ status: 'error', message: '...' }` | `console.warn` |
| Clipboard write rejected (permissions) | `{ status: 'error', message: '...' }` | `console.warn` |
| Decode receives invalid base64url | `null` return from `decodeSource` | `console.warn` |
| Decode decompression fails | `null` return from `decodeSource` | `console.warn` |

#### Idempotency

- `encodeSource` and `decodeSource`: Pure functions (deterministic for same input). Idempotent.
- `readSourceFromURL`: NOT idempotent. Cleans URL on first call. Second call returns null.
- `copyLinkToClipboard`: Idempotent on source content. Repeated calls produce the same URL.

### `src/components/Toolbar.tsx` -- Updated Props

```typescript
export interface ToolbarProps {
  onRun: () => void;
  onExampleSelect: (example: CodeExample) => void;
  /** Callback when Copy Link button is clicked */
  onCopyLink?: () => void;
  /** Feedback state for copy link button */
  copyLinkState?: 'idle' | 'copied' | 'error';
  disabled?: boolean;
  ariaLabel?: string;
}
```

#### Error Contracts

| Condition | Behavior |
|-----------|----------|
| `onCopyLink` undefined | Copy Link button not rendered |
| `copyLinkState` is `'copied'` | Button text changes to "Copied!" for feedback duration |
| `copyLinkState` is `'error'` | Button text changes to error message |

### `src/App.tsx` -- New Behaviors

| Behavior | Trigger | Constraint |
|----------|---------|------------|
| Read shared code from URL | Component mount (`useEffect` with `[]` deps) | URL source overrides localStorage; runs before first render settles |
| Copy link handler | `onCopyLink` callback wired to Toolbar | Calls `copyLinkToClipboard(source)`, sets feedback state, auto-resets after 2 seconds |
| Feedback timer | After successful copy or error | Resets `copyLinkState` to `'idle'` after 2,000ms via `setTimeout` |

## Security Requirements

| Requirement | Constraint |
|-------------|------------|
| No code execution on URL load | Shared code loads into editor only; does NOT auto-execute |
| Input validation | `decodeSource` validates base64url alphabet before decode |
| Size limiting | Reject encoded payloads exceeding 8,192 characters |
| URL cleaning | Remove `?code=` parameter after reading via `history.replaceState` |
| No sensitive data leakage | URL contains only user-authored code, no session/state data |

### Rate Limiting

N/A -- client-side feature with no server interaction.

## Acceptance Criteria

### Success Cases

- AC-S1: Click "Copy Link" copies a URL containing the current editor source to the clipboard
- AC-S2: Opening a URL with `?code=` parameter loads the encoded source into the editor
- AC-S3: Button shows "Copied!" feedback for 2 seconds after successful copy
- AC-S4: URL `?code=` parameter is removed from browser address bar after reading
- AC-S5: Shared code does NOT auto-execute on load
- AC-S6: Round-trip encode/decode preserves source exactly (including whitespace, unicode, special characters)
- AC-S7: Copy Link button has accessible label and keyboard support
- AC-S8: Copy Link button respects `disabled` prop during execution

### Error Cases

- AC-E1: Source exceeding URL size limit shows "too-large" feedback instead of copying
- AC-E2: Invalid `?code=` parameter falls back to localStorage default (no crash)
- AC-E3: Clipboard API unavailable shows error feedback (no crash)
- AC-E4: Empty editor source shows error feedback
- AC-E5: Corrupt/truncated base64url string falls back to localStorage default

### Boundary Conditions

- AC-B1: Empty `?code=` parameter value treated as absent (loads localStorage)
- AC-B2: Source with only whitespace triggers error feedback
- AC-B3: Maximum-length source (near 8,192 encoded chars) encodes and decodes correctly
- AC-B4: Source containing all printable ASCII, unicode, newlines, and rill operators (`->`, `=>`) round-trips correctly
- AC-B5: Multiple rapid "Copy Link" clicks do not stack feedback timers
- AC-B6: URL with `?code=` and other query parameters preserves non-code parameters

## Implementation Checklist

| Action | File Path |
|--------|-----------|
| Create | `src/lib/sharing.ts` |
| Create | `src/lib/__tests__/sharing-encode.test.ts` |
| Create | `src/lib/__tests__/sharing-decode.test.ts` |
| Modify | `src/components/Toolbar.tsx` (add Copy Link button, `onCopyLink` and `copyLinkState` props) |
| Modify | `src/components/index.ts` (re-export updated ToolbarProps) |
| Modify | `src/App.tsx` (URL read on mount, copy-link handler, feedback state) |
| Modify | `src/index.css` (Copy Link button styles) |
| Modify | `src/components/__tests__/Toolbar.test.tsx` (add Copy Link button tests) |
