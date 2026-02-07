/**
 * Root App Component for Rill Fiddle
 *
 * Wires Editor, Output, Toolbar, and SplitPane into root layout.
 * Manages ExecutionState via React state and passes to Output component.
 * Handles Run, example selection, theme toggle, and persistence.
 *
 * Features:
 * - AC-6: Example loading replaces editor content without auto-executing
 * - AC-16: Error clears on re-run with valid code
 * - AC-23: Rapid re-execution guard prevents duplicate outputs
 * - AC-24: First visit loads Hello World in dark theme
 */

import { type JSX, useEffect, useState, useCallback, useRef } from 'react';
import { Editor, Output, Toolbar, SplitPane, type ExecutionState } from './components/index.js';
import { executeRill } from './lib/execution.js';
import { loadEditorState, persistEditorState, type EditorState } from './lib/persistence.js';
import type { CodeExample } from './lib/examples.js';

// ============================================================
// APP COMPONENT
// ============================================================

/**
 * Root application component
 *
 * State management:
 * - Editor content (source code)
 * - Execution state (status, result, error, duration)
 * - Theme (dark/light)
 * - Split ratio (for SplitPane)
 * - Error line (for Editor gutter highlighting)
 *
 * Flow:
 * 1. Load initial state from localStorage on mount (AC-24)
 * 2. Run button executes code, updates execution state (AC-16, AC-23)
 * 3. Example selection replaces editor content (AC-6)
 * 4. Theme toggle updates theme and persists
 * 5. Split change persists ratio
 */
export function App(): JSX.Element {
  // ============================================================
  // STATE INITIALIZATION
  // ============================================================

  // Load initial state from localStorage (AC-24)
  const [editorState, setEditorState] = useState<EditorState>(() => loadEditorState());

  // Editor content state
  const [source, setSource] = useState<string>(editorState.lastSource);

  // Execution state
  const [executionState, setExecutionState] = useState<ExecutionState>({
    status: 'idle',
    result: null,
    error: null,
    duration: null,
  });

  // Error line for gutter highlighting (AC-16)
  const [errorLine, setErrorLine] = useState<number | null>(null);

  // Ref to track if execution is in progress (AC-23)
  const isExecutingRef = useRef<boolean>(false);

  // ============================================================
  // PERSISTENCE
  // ============================================================

  /**
   * Persist editor state to localStorage
   */
  useEffect(() => {
    const state: EditorState = {
      theme: editorState.theme,
      splitRatio: editorState.splitRatio,
      lastSource: source,
    };
    persistEditorState(state);
  }, [editorState.theme, editorState.splitRatio, source]);

  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  /**
   * Handle Run button click
   * AC-16: Clears previous error gutter on re-run
   * AC-23: Disabled during execution to prevent rapid re-execution
   */
  const handleRun = useCallback(async () => {
    // AC-23: Guard against rapid re-execution using ref
    if (isExecutingRef.current) {
      return;
    }

    isExecutingRef.current = true;

    // AC-16: Clear previous error gutter
    setErrorLine(null);

    // Set running status
    setExecutionState({
      status: 'running',
      result: null,
      error: null,
      duration: null,
    });

    // Execute code
    const result = await executeRill(source);

    // Update execution state
    setExecutionState(result);

    // AC-16: Set error line for gutter highlighting if execution failed
    if (result.status === 'error' && result.error !== null) {
      setErrorLine(result.error.line);
    }

    isExecutingRef.current = false;
  }, [source]);

  /**
   * Handle example selection from dropdown
   * AC-6: Replaces editor content without auto-executing
   */
  const handleExampleSelect = useCallback((example: CodeExample) => {
    setSource(example.source);
    // AC-6: Do NOT auto-execute when loading example
  }, []);

  /**
   * Handle theme toggle
   * AC-7: Persists theme via persistEditorState
   */
  const handleThemeToggle = useCallback(() => {
    setEditorState((prev) => ({
      ...prev,
      theme: prev.theme === 'light' ? 'dark' : 'light',
    }));
  }, []);

  /**
   * Handle split ratio change
   * AC-8: Persists split ratio via persistEditorState
   */
  const handleSplitChange = useCallback((ratio: number) => {
    setEditorState((prev) => ({
      ...prev,
      splitRatio: ratio,
    }));
  }, []);

  /**
   * Handle editor content change
   */
  const handleEditorChange = useCallback((value: string) => {
    setSource(value);
  }, []);

  // ============================================================
  // RENDER
  // ============================================================

  // Apply dark mode class to root element for Tailwind
  useEffect(() => {
    if (editorState.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [editorState.theme]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {/* Toolbar */}
      <Toolbar
        onRun={handleRun}
        onExampleSelect={handleExampleSelect}
        onThemeToggle={handleThemeToggle}
        theme={editorState.theme}
        disabled={executionState.status === 'running'}
      />

      {/* Split Pane with Editor and Output */}
      <div className="flex-1 overflow-hidden">
        <SplitPane
          left={
            <Editor
              value={source}
              onChange={handleEditorChange}
              onRun={handleRun}
              errorLine={errorLine}
              theme={editorState.theme}
            />
          }
          right={<Output state={executionState} theme={editorState.theme} />}
          theme={editorState.theme}
          initialSplitRatio={editorState.splitRatio}
          onSplitChange={handleSplitChange}
        />
      </div>
    </div>
  );
}
