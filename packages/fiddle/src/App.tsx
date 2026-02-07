/**
 * Root App Component for Rill Fiddle
 *
 * Wires Editor, Output, Toolbar, and SplitPane into root layout.
 * Dark-only brand aesthetic. Manages ExecutionState via React state.
 *
 * Features:
 * - AC-6: Example loading replaces editor content without auto-executing
 * - AC-16: Error clears on re-run with valid code
 * - AC-23: Rapid re-execution guard prevents duplicate outputs
 * - AC-24: First visit loads Hello World
 */

import { type JSX, useEffect, useState, useCallback, useRef } from 'react';
import { Editor, Output, Toolbar, SplitPane, type ExecutionState } from './components/index.js';
import { executeRill } from './lib/execution.js';
import { loadEditorState, persistEditorState, type EditorState } from './lib/persistence.js';
import type { CodeExample } from './lib/examples.js';

// ============================================================
// APP COMPONENT
// ============================================================

export function App(): JSX.Element {
  // ============================================================
  // STATE INITIALIZATION
  // ============================================================

  const [editorState, setEditorState] = useState<EditorState>(() => loadEditorState());
  const [source, setSource] = useState<string>(editorState.lastSource);
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    result: null,
    error: null,
    duration: null,
  });
  const [errorLine, setErrorLine] = useState<number | null>(null);
  const isExecutingRef = useRef<boolean>(false);

  // ============================================================
  // PERSISTENCE
  // ============================================================

  useEffect(() => {
    const state: EditorState = {
      splitRatio: editorState.splitRatio,
      lastSource: source,
    };
    persistEditorState(state);
  }, [editorState.splitRatio, source]);

  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  const handleRun = useCallback(async () => {
    if (isExecutingRef.current) return;
    isExecutingRef.current = true;

    setErrorLine(null);
    setExecutionState({
      status: 'running',
      result: null,
      error: null,
      duration: null,
    });

    const result = await executeRill(source);
    setExecutionState(result);

    if (result.status === 'error' && result.error !== null) {
      setErrorLine(result.error.line);
    }

    isExecutingRef.current = false;
  }, [source]);

  const handleExampleSelect = useCallback((example: CodeExample) => {
    setSource(example.source);
  }, []);

  const handleSplitChange = useCallback((ratio: number) => {
    setEditorState((prev) => ({
      ...prev,
      splitRatio: ratio,
    }));
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    setSource(value);
  }, []);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <Toolbar
        onRun={handleRun}
        onExampleSelect={handleExampleSelect}
        disabled={executionState.status === 'running'}
      />

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
          initialSplitRatio={editorState.splitRatio}
          onSplitChange={handleSplitChange}
        />
      </div>
    </div>
  );
}
