/**
 * Root App Component for Rill Fiddle
 *
 * Wires Editor, Output, Toolbar, and SplitPane into root layout.
 * Dark-only brand aesthetic. Manages ExecutionState via React state.
 *
 * Features:
 * - Example loading replaces editor content without auto-executing
 * - Error clears on re-run with valid code
 * - Rapid re-execution guard prevents duplicate outputs
 * - First visit loads Hello World
 */

import { type JSX, useEffect, useState, useCallback, useRef } from 'react';
import { Editor } from './components/Editor.js';
import { Output } from './components/Output.js';
import { Toolbar } from './components/Toolbar.js';
import { SplitPane } from './components/SplitPane.js';
import type { ExecutionState } from './lib/execution.js';
import { contextResolver } from '@rcrsr/rill';
import { executeRill } from './lib/execution.js';
import { DEMO_CONTEXT_VALUES } from './lib/context.js';
import { loadEditorState, persistEditorState } from './lib/persistence.js';
import { readSourceFromURL, copyLinkToClipboard } from './lib/sharing.js';
import type { CodeExample } from './lib/examples.js';

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Debounce delay for the localStorage persistence effect. Coalesces
 * rapid-fire source/splitRatio changes (e.g. every keystroke) into a
 * single localStorage write.
 */
const PERSIST_DEBOUNCE_MS = 300;

/** Delay before copy-link feedback resets back to idle. */
const COPY_FEEDBACK_RESET_MS = 2000;

// ============================================================
// APP COMPONENT
// ============================================================

export function App(): JSX.Element {
  // ============================================================
  // STATE INITIALIZATION
  // ============================================================

  // `source` is seeded once from persisted state; `lastSource` itself is
  // never held in React state, so there is no stale field to keep in sync.
  const [source, setSource] = useState<string>(
    () => loadEditorState().lastSource
  );
  const [splitRatio, setSplitRatio] = useState<number>(
    () => loadEditorState().splitRatio
  );
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    result: null,
    error: null,
    duration: null,
    logs: [],
  });
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const [copyLinkState, setCopyLinkState] = useState<
    'idle' | 'copied' | 'too-large' | 'error'
  >('idle');
  const [copyLinkMessage, setCopyLinkMessage] = useState<string | null>(null);
  const [decodeNoticeMessage, setDecodeNoticeMessage] = useState<string | null>(
    null
  );
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  // Guards against concurrent runs. A ref (not state) so the check happens
  // synchronously against the latest value rather than through a setState
  // updater, which React 18 StrictMode double-invokes in dev to surface
  // impure updaters.
  const isRunningRef = useRef(false);

  // ============================================================
  // CLEANUP TIMERS ON UNMOUNT
  // ============================================================

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  // ============================================================
  // PERSISTENCE (debounced)
  // ============================================================

  useEffect(() => {
    const timerId = setTimeout(() => {
      persistEditorState({ splitRatio, lastSource: source });
    }, PERSIST_DEBOUNCE_MS);

    // Cancels the pending write whenever source/splitRatio change again
    // before it fires, coalescing bursts (e.g. every keystroke) into one
    // localStorage write.
    return () => clearTimeout(timerId);
  }, [splitRatio, source]);

  // ============================================================
  // URL SHARING
  // ============================================================

  useEffect(() => {
    readSourceFromURL()
      .then((result) => {
        if (result.ok) {
          setSource(result.source);
          return;
        }

        // The ?code= parameter is untrusted input. A missing parameter
        // ('absent') is the common case and stays silent; a payload that
        // was present but failed to decode is surfaced so the user knows
        // the shared link did not load.
        if (result.reason === 'corrupt') {
          setDecodeNoticeMessage(
            'Shared link could not be read: the code parameter is corrupted.'
          );
        } else if (result.reason === 'unavailable') {
          setDecodeNoticeMessage(
            'Shared link could not be read: this browser cannot decode it.'
          );
        }
      })
      .catch(() => {
        // readSourceFromURL resolves with a typed result rather than
        // rejecting; treat an unexpected rejection the same as a corrupt
        // payload instead of swallowing it silently.
        setDecodeNoticeMessage('Shared link could not be read.');
      });
  }, []);

  const handleDismissDecodeNotice = useCallback(() => {
    setDecodeNoticeMessage(null);
  }, []);

  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  const handleRun = useCallback(() => {
    // Guard: if already running, don't start a new execution.
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    setErrorLine(null);
    setExecutionState({
      status: 'running',
      result: null,
      error: null,
      duration: null,
      logs: [],
    });

    // Build resolver config with context scheme wired to demo values
    const resolverConfig = {
      resolvers: {
        context: (resource: string) =>
          contextResolver(resource, DEMO_CONTEXT_VALUES),
      },
      configurations: { resolvers: { context: DEMO_CONTEXT_VALUES } },
    };

    executeRill(source, resolverConfig)
      .then((result) => {
        isRunningRef.current = false;
        setExecutionState(result);
        if (result.status === 'error' && result.error !== null) {
          setErrorLine(result.error.line);
        }
      })
      .catch((err: unknown) => {
        // executeRill converts errors into an error state internally, so a
        // rejection here is unexpected. Surface it rather than leaving the
        // UI stuck on 'running' forever.
        isRunningRef.current = false;
        setExecutionState({
          status: 'error',
          result: null,
          error: {
            message: err instanceof Error ? err.message : String(err),
            category: 'runtime',
            line: null,
            column: null,
            errorId: null,
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: null,
          logs: [],
        });
      });
  }, [source]);

  const handleExampleSelect = useCallback((example: CodeExample) => {
    setSource(example.source);
  }, []);

  const handleSplitChange = useCallback((ratio: number) => {
    setSplitRatio(ratio);
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    setSource(value);
  }, []);

  const handleCopyLink = useCallback(async () => {
    // Clear any existing feedback timer
    if (copyFeedbackTimerRef.current !== null) {
      clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }

    // Copy link to clipboard
    const result = await copyLinkToClipboard(source);

    // W-1's copyLinkToClipboard status is already the tri/quad-state this
    // component needs ('copied' | 'too-large' | 'error'), so assign it
    // directly instead of collapsing every non-'copied' result to 'error'.
    setCopyLinkState(result.status);
    setCopyLinkMessage(result.message);

    // Reset to idle after a delay, regardless of which state was reached.
    const timerId = setTimeout(() => {
      setCopyLinkState('idle');
      setCopyLinkMessage(null);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_RESET_MS);

    copyFeedbackTimerRef.current = timerId;
  }, [source]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Toolbar
        onRun={handleRun}
        onExampleSelect={handleExampleSelect}
        onCopyLink={handleCopyLink}
        copyLinkState={copyLinkState === 'too-large' ? 'error' : copyLinkState}
        disabled={executionState.status === 'running'}
      />

      {copyLinkState === 'too-large' && (
        <div className="copy-link-notice" role="status">
          {copyLinkMessage ?? 'Code too large to share'}
        </div>
      )}

      {decodeNoticeMessage !== null && (
        <div className="decode-notice" role="status">
          <span>{decodeNoticeMessage}</span>
          <button
            type="button"
            onClick={handleDismissDecodeNotice}
            aria-label="Dismiss notice"
            className="decode-notice-dismiss"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <SplitPane
          left={
            <Editor
              value={source}
              onChange={handleEditorChange}
              onRun={handleRun}
              errorLine={errorLine}
            />
          }
          right={<Output state={executionState} />}
          initialSplitRatio={splitRatio}
          onSplitChange={handleSplitChange}
        />
      </div>
    </div>
  );
}
