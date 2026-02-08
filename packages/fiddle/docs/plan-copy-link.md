---
type: implementation-plan
last-modified: 2026-02-08
status: draft
blocked-by:
  - spec-copy-link.md
---

# Implementation Plan: Copy Link

**Specification:** `packages/fiddle/docs/spec-copy-link.md`

## Overview

4 phases, 14 tasks. Each phase produces a verifiable deliverable that builds on the previous phase. Phase 1 (lib) has zero React dependencies and can be tested in isolation. Phases 2-3 integrate the lib into the app. Phase 4 adds all test files.

## Phase 1: Core Sharing Library

**Goal:** Create `src/lib/sharing.ts` with encode, decode, URL read, and clipboard copy functions. No React imports. No DOM rendering.

**Depends on:** Nothing (greenfield module).

### Task 1.1: Create `src/lib/sharing.ts` with `CopyLinkResult` type and `MAX_URL_CODE_LENGTH` constant

**Action:** Create file

**File:** `src/lib/sharing.ts`

**Details:**

- Export `CopyLinkResult` interface with `status`, `url?`, and `message` fields per spec
- Export `MAX_URL_CODE_LENGTH` constant set to `8192`
- Add module-level docstring describing the sharing pipeline
- No React imports (enforced by FDL.2.1 layer boundary)

**Acceptance:**

- `pnpm --filter @rcrsr/rill-fiddle typecheck` passes
- `CopyLinkResult` type has 3 status variants: `'copied' | 'too-large' | 'error'`
- `MAX_URL_CODE_LENGTH` equals `8192`

### Task 1.2: Implement `encodeSource` function

**Action:** Modify file

**File:** `src/lib/sharing.ts`

**Details:**

- Implement `async function encodeSource(source: string): Promise<string | null>`
- Pipeline: TextEncoder -> CompressionStream('gzip') -> collect bytes -> base64url encode
- Base64url alphabet: replace `+` with `-`, `/` with `_`, strip `=` padding
- Return `null` if encoded output exceeds `MAX_URL_CODE_LENGTH`
- Return `null` and `console.warn` if CompressionStream is unavailable

**Acceptance:**

- `encodeSource("hello")` returns a non-null string containing only `[A-Za-z0-9_-]`
- `encodeSource("")` returns `null` (empty input guard)
- Output string length never exceeds 8,192 characters for any input

### Task 1.3: Implement `decodeSource` function

**Action:** Modify file

**File:** `src/lib/sharing.ts`

**Details:**

- Implement `async function decodeSource(encoded: string): Promise<string | null>`
- Pipeline: base64url decode (restore `+`, `/`, `=` padding) -> DecompressionStream('gzip') -> TextDecoder
- Return `null` on any failure (invalid base64, decompression error, empty result)
- Log `console.warn` on failure for debugging
- No thrown exceptions -- all errors caught and return `null`

**Acceptance:**

- `decodeSource(await encodeSource("test"))` returns `"test"` (round-trip)
- `decodeSource("!!!invalid!!!")` returns `null` (no throw)
- `decodeSource("")` returns `null`

### Task 1.4: Implement `readSourceFromURL` function

**Action:** Modify file

**File:** `src/lib/sharing.ts`

**Details:**

- Implement `async function readSourceFromURL(): Promise<string | null>`
- Read `code` parameter from `window.location.search` using `URLSearchParams`
- If parameter absent or empty, return `null`
- Call `decodeSource` on the parameter value
- On successful decode, remove `code` parameter via `history.replaceState`
- Preserve other query parameters when cleaning the URL (AC-B6)
- Return decoded source string, or `null` on any failure

**Acceptance:**

- Returns `null` when no `?code=` parameter exists
- Returns `null` for empty `?code=` parameter value (AC-B1)
- Calls `history.replaceState` to remove `code` param after successful read (AC-S4)
- Preserves non-code query parameters in cleaned URL (AC-B6)

### Task 1.5: Implement `copyLinkToClipboard` function

**Action:** Modify file

**File:** `src/lib/sharing.ts`

**Details:**

- Implement `async function copyLinkToClipboard(source: string): Promise<CopyLinkResult>`
- Guard: return `{ status: 'error' }` if `source.trim()` is empty (AC-E4, AC-B2)
- Call `encodeSource(source)` to get encoded string
- If `encodeSource` returns `null` (size exceeded), return `{ status: 'too-large' }` (AC-E1)
- Build URL using `window.location.origin + window.location.pathname + '?code=' + encoded`
- Copy URL via `navigator.clipboard.writeText(url)`
- Return `{ status: 'copied', url, message: 'Copied!' }` on success
- Catch clipboard errors, return `{ status: 'error' }` (AC-E3)
- Check for `navigator.clipboard` availability before calling

**Acceptance:**

- Empty source returns `{ status: 'error' }`
- Whitespace-only source returns `{ status: 'error' }` (AC-B2)
- Oversized source returns `{ status: 'too-large' }` (AC-E1)
- Successful copy returns `{ status: 'copied', url: '...', message: 'Copied!' }`
- Missing clipboard API returns `{ status: 'error' }` (AC-E3)

### Phase 1 Verification

```bash
pnpm --filter @rcrsr/rill-fiddle typecheck
```

- `src/lib/sharing.ts` exists with 4 exported functions and 2 exported types
- No React or component imports in the file
- All functions are `async` and return `Promise` types
- `CopyLinkResult` interface matches spec exactly

---

## Phase 2: App.tsx Integration

**Goal:** Wire URL-read on mount and copy-link handler into the App orchestrator. Add `copyLinkState` as App-owned state per FDL.4.2.

**Depends on:** Phase 1 (sharing lib must exist).

### Task 2.1: Add sharing imports and `copyLinkState` to App.tsx

**Action:** Modify file

**File:** `src/App.tsx`

**Details:**

- Add import: `import { readSourceFromURL, copyLinkToClipboard, type CopyLinkResult } from './lib/sharing.js'`
- Add state: `const [copyLinkState, setCopyLinkState] = useState<'idle' | 'copied' | 'error'>('idle')`
- Add ref for feedback timer cleanup: `const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)`
- Place new state declarations after `isExecutingRef` (line 38) in the STATE INITIALIZATION section

**Acceptance:**

- `pnpm --filter @rcrsr/rill-fiddle typecheck` passes
- `copyLinkState` initialized to `'idle'`
- Timer ref initialized to `null`

### Task 2.2: Add URL-read `useEffect` on mount

**Action:** Modify file

**File:** `src/App.tsx`

**Details:**

- Add a new `useEffect` with `[]` dependency array (runs once on mount)
- Place it between the PERSISTENCE section (line 50) and EVENT HANDLERS section (line 52)
- Inside the effect, call `readSourceFromURL()` (async)
- If the result is non-null and non-empty, call `setSource(result)` to override localStorage default
- Do NOT call `handleRun` or auto-execute (AC-S5)
- Use an IIFE or `.then()` pattern since `useEffect` callbacks cannot be async

**Acceptance:**

- URL with `?code=<valid-encoded>` sets editor source to decoded content on mount (AC-S2)
- URL without `?code=` parameter loads localStorage default (existing behavior preserved)
- `?code=` parameter removed from address bar after reading (AC-S4)
- Shared code does NOT auto-execute (AC-S5)
- Invalid `?code=` value falls back to localStorage default silently (AC-E2)

### Task 2.3: Add `handleCopyLink` callback

**Action:** Modify file

**File:** `src/App.tsx`

**Details:**

- Add `handleCopyLink` as a `useCallback` in the EVENT HANDLERS section
- Dependency array: `[source]`
- Implementation flow:
  1. Clear any existing feedback timer via `copyFeedbackTimerRef.current`
  2. Call `await copyLinkToClipboard(source)`
  3. Set `copyLinkState` based on result status (`'copied'` or `'error'`)
  4. Set a `setTimeout` of 2,000ms that resets `copyLinkState` to `'idle'`
  5. Store the timer ID in `copyFeedbackTimerRef`
- Multiple rapid clicks must clear previous timer before setting new one (AC-B5)

**Acceptance:**

- `handleCopyLink` calls `copyLinkToClipboard` with current `source`
- `copyLinkState` transitions to `'copied'` on success
- `copyLinkState` resets to `'idle'` after 2,000ms (AC-S3)
- Rapid clicks clear previous timer, only final timer runs (AC-B5)

### Task 2.4: Wire new props to Toolbar in render

**Action:** Modify file

**File:** `src/App.tsx`

**Details:**

- Add `onCopyLink={handleCopyLink}` prop to `<Toolbar>` element (line 99-103)
- Add `copyLinkState={copyLinkState}` prop to `<Toolbar>` element
- No changes to other component props

**Acceptance:**

- `pnpm --filter @rcrsr/rill-fiddle typecheck` passes
- Toolbar receives both new props
- Existing Toolbar props unchanged

### Phase 2 Verification

```bash
pnpm --filter @rcrsr/rill-fiddle typecheck
```

- App.tsx imports `readSourceFromURL` and `copyLinkToClipboard` from `./lib/sharing.js`
- `copyLinkState` state variable exists with type `'idle' | 'copied' | 'error'`
- URL-read `useEffect` runs on mount with `[]` deps
- `handleCopyLink` callback exists with `[source]` deps
- Toolbar receives `onCopyLink` and `copyLinkState` props

---

## Phase 3: Toolbar UI

**Goal:** Add Copy Link button to Toolbar with visual feedback states. Update barrel exports.

**Depends on:** Phase 2 (App.tsx must pass the new props).

### Task 3.1: Update `ToolbarProps` interface

**Action:** Modify file

**File:** `src/components/Toolbar.tsx`

**Details:**

- Add `onCopyLink?: () => void` to `ToolbarProps` interface (line 25-34)
- Add `copyLinkState?: 'idle' | 'copied' | 'error'` to `ToolbarProps` interface
- Add JSDoc comments matching spec descriptions
- Update function signature destructuring to include new props with defaults: `onCopyLink`, `copyLinkState = 'idle'`

**Acceptance:**

- `pnpm --filter @rcrsr/rill-fiddle typecheck` passes
- Both props are optional (backward compatible)
- Default `copyLinkState` is `'idle'`

### Task 3.2: Add Copy Link button to Toolbar render

**Action:** Modify file

**File:** `src/components/Toolbar.tsx`

**Details:**

- Add a Copy Link button between the example selector (line 115) and the spacer (line 117-118)
- Render the button only when `onCopyLink` is defined (conditional render)
- Button attributes: `type="button"`, `onClick={onCopyLink}`, `disabled={disabled}`, `aria-label="Copy shareable link"`
- CSS class: `toolbar-share`
- Button text: show `"Copied!"` when `copyLinkState === 'copied'`, show `"Error"` when `copyLinkState === 'error'`, show `"Copy Link"` otherwise
- Add a `toolbar-separator` div before the button for visual separation from the example selector

**Acceptance:**

- Button renders when `onCopyLink` is provided
- Button hidden when `onCopyLink` is undefined
- Button text reflects `copyLinkState` value (AC-S3)
- Button disabled during execution (AC-S8)
- Button has ARIA label (AC-S7)
- `type="button"` set to prevent form submission

### Task 3.3: Update barrel exports in `src/components/index.ts`

**Action:** Modify file

**File:** `src/components/index.ts`

**Details:**

- Re-export `CopyLinkResult` type from `../lib/sharing.js` for App.tsx consumption
- No changes to existing exports (ToolbarProps already re-exported on line 14)

**Acceptance:**

- `pnpm --filter @rcrsr/rill-fiddle typecheck` passes
- `CopyLinkResult` importable from `./components/index.js`

### Task 3.4: Add CSS styles for Copy Link button

**Action:** Modify file

**File:** `src/index.css`

**Details:**

- Add `.toolbar-share` styles in the TOOLBAR section (after `.toolbar-select:disabled` at line 199)
- Style the button as a ghost/bordered button (not primary cyan like Run)
- Use `--void-card` background, `--void-border` border, `--text-secondary` color
- Match sizing, font, and border-radius of `.toolbar-select` for visual consistency
- Add hover state: `border-color: rgba(34, 211, 238, 0.3)` (matches `.toolbar-select:hover`)
- Add disabled state: `opacity: 0.4; cursor: not-allowed` (matches existing pattern)
- Add a `.toolbar-share-copied` variant or use the base class with adjusted color for "Copied!" state: `color: var(--neon-green)`, `border-color: var(--neon-green)`

**Acceptance:**

- Copy Link button visually distinct from Run button (ghost style, not filled cyan)
- Consistent with existing toolbar element sizing
- Hover, disabled, and feedback states styled
- No layout shift when button text changes between "Copy Link" / "Copied!" / "Error"

### Phase 3 Verification

```bash
pnpm --filter @rcrsr/rill-fiddle build
```

- Build completes without errors
- Toolbar renders Copy Link button when `onCopyLink` prop provided
- Button text changes based on `copyLinkState`
- CSS classes applied correctly

---

## Phase 4: Tests

**Goal:** Add unit tests for the sharing lib and component tests for the updated Toolbar. Follow existing test patterns from `persistence.test.ts` and `Toolbar.test.tsx`.

**Depends on:** Phases 1-3 (all source code must be complete).

### Task 4.1: Create `src/lib/__tests__/sharing-encode.test.ts`

**Action:** Create file

**File:** `src/lib/__tests__/sharing-encode.test.ts`

**Details:**

Test `encodeSource` function:

| Test Case | Maps To | Condition |
|-----------|---------|-----------|
| Encodes simple string | AC-S6 | `encodeSource("hello")` returns non-null base64url string |
| Output is URL-safe | AC-S6 | Result matches `/^[A-Za-z0-9_-]+$/` (no `+`, `/`, `=`) |
| Returns null for empty string | AC-E4 | `encodeSource("")` returns `null` |
| Returns null for whitespace-only | AC-B2 | `encodeSource("   ")` returns `null` |
| Respects MAX_URL_CODE_LENGTH | AC-E1 | Very large input returns `null` |
| Round-trip preserves ASCII | AC-S6 | Encode then decode returns original |
| Round-trip preserves unicode | AC-B4 | Source with emoji/CJK round-trips |
| Round-trip preserves rill operators | AC-B4 | Source with `->`, `=>`, `$`, `{}` round-trips |
| Round-trip preserves whitespace | AC-S6 | Source with tabs, newlines, spaces round-trips |

**Acceptance:**

- All tests pass with `pnpm --filter @rcrsr/rill-fiddle test -- src/lib/__tests__/sharing-encode`
- No happy-dom environment required (lib tests run in Node)

### Task 4.2: Create `src/lib/__tests__/sharing-decode.test.ts`

**Action:** Create file

**File:** `src/lib/__tests__/sharing-decode.test.ts`

**Details:**

Test `decodeSource`, `readSourceFromURL`, and `copyLinkToClipboard` functions:

| Test Case | Maps To | Condition |
|-----------|---------|-----------|
| Decodes valid encoded string | AC-S6 | `decodeSource(encoded)` returns original |
| Returns null for invalid base64 | AC-E5 | `decodeSource("!!!bad!!!")` returns `null` |
| Returns null for empty string | AC-B1 | `decodeSource("")` returns `null` |
| Returns null for truncated data | AC-E5 | Truncated encoded string returns `null` |
| `readSourceFromURL` returns null without param | AC-B1 | No `?code=` returns `null` |
| `copyLinkToClipboard` returns error for empty source | AC-E4 | Empty string returns `{ status: 'error' }` |
| `copyLinkToClipboard` returns error for whitespace | AC-B2 | Spaces return `{ status: 'error' }` |

**Notes:**

- Mock `window.location` and `history.replaceState` for `readSourceFromURL` tests
- Mock `navigator.clipboard` for `copyLinkToClipboard` tests
- Follow the mock pattern from `persistence-boundary.test.ts` (lines 20-31)

**Acceptance:**

- All tests pass with `pnpm --filter @rcrsr/rill-fiddle test -- src/lib/__tests__/sharing-decode`
- No happy-dom environment required for decode tests

### Task 4.3: Add Copy Link tests to `src/components/__tests__/Toolbar.test.tsx`

**Action:** Modify file

**File:** `src/components/__tests__/Toolbar.test.tsx`

**Details:**

Add a new `describe('Copy Link button')` section after the existing `example selector` section (line 235). Tests to add:

| Test Case | Maps To | Condition |
|-----------|---------|-----------|
| Not rendered when `onCopyLink` undefined | Spec error contract | Button absent from DOM |
| Rendered when `onCopyLink` provided | AC-S1 | `.toolbar-share` element exists |
| Triggers `onCopyLink` on click | AC-S1 | Mock callback called once |
| Shows "Copied!" text when `copyLinkState='copied'` | AC-S3 | Button text contains "Copied!" |
| Shows "Error" text when `copyLinkState='error'` | AC-E3 | Button text contains "Error" |
| Shows "Copy Link" text when `copyLinkState='idle'` | Default | Button text contains "Copy Link" |
| Disabled when `disabled` prop is true | AC-S8 | `button.disabled === true` |
| Has accessible ARIA label | AC-S7 | `aria-label` attribute present |
| Does not trigger callback when disabled | AC-S8 | Mock not called on click |

**Follow existing patterns:**

- Use `vi.fn()` for `mockOnCopyLink` (matches `mockOnRun` pattern at line 20)
- Use `container.querySelector('.toolbar-share')` (matches existing selector pattern)
- Add `mockOnCopyLink` to `defaultProps` as undefined initially

**Acceptance:**

- All new tests pass: `pnpm --filter @rcrsr/rill-fiddle test -- src/components/__tests__/Toolbar`
- Existing Toolbar tests continue to pass (no regressions)
- Total of 9 new test cases added

### Phase 4 Verification

```bash
pnpm --filter @rcrsr/rill-fiddle test
```

- All existing tests pass (0 regressions)
- New sharing encode tests pass
- New sharing decode tests pass
- New Toolbar Copy Link tests pass
- `pnpm --filter @rcrsr/rill-fiddle check` passes (build + test + lint)

---

## File Summary

| Phase | Action | File Path |
|-------|--------|-----------|
| 1 | Create | `src/lib/sharing.ts` |
| 2 | Modify | `src/App.tsx` |
| 3 | Modify | `src/components/Toolbar.tsx` |
| 3 | Modify | `src/components/index.ts` |
| 3 | Modify | `src/index.css` |
| 4 | Create | `src/lib/__tests__/sharing-encode.test.ts` |
| 4 | Create | `src/lib/__tests__/sharing-decode.test.ts` |
| 4 | Modify | `src/components/__tests__/Toolbar.test.tsx` |

**Total:** 3 files created, 5 files modified.

## Final Verification

After all 4 phases complete, run the full validation suite:

```bash
pnpm --filter @rcrsr/rill-fiddle check
```

This runs `build`, `test`, and `lint` in sequence. All 3 must pass.

**Manual verification checklist:**

- [ ] `pnpm --filter @rcrsr/rill-fiddle dev` starts without errors
- [ ] Copy Link button visible in toolbar
- [ ] Clicking Copy Link copies a URL to clipboard
- [ ] Opening the copied URL loads the shared code in the editor
- [ ] Shared code does NOT auto-execute
- [ ] `?code=` parameter removed from URL after loading
- [ ] "Copied!" feedback displays for 2 seconds
- [ ] Empty editor shows error feedback on Copy Link click
