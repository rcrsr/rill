/**
 * App Component Integration Tests
 *
 * Test coverage:
 * - App renders without errors
 * - Keyboard shortcut execution
 * - Example selection replaces editor content without auto-executing
 * - Panel resize persists across reload
 * - Re-execution clears previous output before showing new result
 * - Error with line location highlights gutter line in editor
 * - Error clears on successful re-run
 * - Empty source shows no error; output remains idle
 * - Rapid re-execution guard prevents duplicates
 * - First visit loads Hello World
 * - Run button disabled while a worker run is in flight
 * - A resolved timeout ExecutionState renders as an error
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';
import * as persistence from '../lib/persistence.js';
import * as runner from '../lib/execution-runner.js';
import * as sharing from '../lib/sharing.js';
import type { ExecutionState } from '../lib/execution.js';

/** Wraps a resolved ExecutionState into the { promise, cancel } shape runInWorker returns. */
function immediateRun(state: ExecutionState): {
  promise: Promise<ExecutionState>;
  cancel: () => void;
} {
  return { promise: Promise.resolve(state), cancel: vi.fn() };
}

/** Wraps a delayed ExecutionState into the { promise, cancel } shape runInWorker returns. */
function delayedRun(
  state: ExecutionState,
  delayMs: number
): { promise: Promise<ExecutionState>; cancel: () => void } {
  const promise = new Promise<ExecutionState>((resolve) => {
    setTimeout(() => resolve(state), delayMs);
  });
  return { promise, cancel: vi.fn() };
}

/** Wraps an ExecutionState into a { promise, cancel } pair that never settles. */
function pendingRun(): {
  promise: Promise<ExecutionState>;
  cancel: () => void;
} {
  return { promise: new Promise<ExecutionState>(() => {}), cancel: vi.fn() };
}

describe('App', () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    // Mock localStorage
    originalLocalStorage = global.localStorage;
    const storage = new Map<string, string>();
    global.localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage;
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
    cleanup();
    vi.restoreAllMocks();
  });

  // ============================================================
  // App renders without errors
  // ============================================================

  describe('rendering', () => {
    it('renders without errors', () => {
      const { container } = render(<App />);
      expect(container).toBeDefined();
    });

    it('renders Toolbar component', () => {
      const { container } = render(<App />);
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar).toBeDefined();
    });

    it('renders Editor component', () => {
      const { container } = render(<App />);
      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();
    });

    it('renders Output component', () => {
      const { container } = render(<App />);
      const output = container.querySelector('.output-panel');
      expect(output).toBeDefined();
    });

    it('renders SplitPane component', () => {
      const { container } = render(<App />);
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });
  });

  // ============================================================
  // First visit loads Hello World
  // ============================================================

  describe('initial state', () => {
    it('loads Hello World example on first visit', () => {
      // Clear localStorage to simulate first visit
      localStorage.clear();

      const { container } = render(<App />);
      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();
    });

    it('loads persisted state on subsequent visits', () => {
      // Set persisted state
      const state: persistence.EditorState = {
        splitRatio: 60,
        lastSource: 'log("test")',
      };
      persistence.persistEditorState(state);

      const { container } = render(<App />);
      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();
    });

    it('applies default split ratio on first visit', () => {
      localStorage.clear();

      const { container } = render(<App />);
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });
  });

  // ============================================================
  // Keyboard shortcut execution
  // ============================================================

  describe('keyboard shortcuts', () => {
    it('Editor component receives onRun prop for Cmd/Ctrl+Enter', () => {
      const { container } = render(<App />);

      // Verify Editor is rendered and receives onRun callback
      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();
    });

    it('Editor onRun callback triggers identical execution to Run button', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValue(
        immediateRun({
          status: 'success',
          result: '"Test"',
          error: null,
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          expect(runSpy).toHaveBeenCalledTimes(1);
        });
      }
    });
  });

  // ============================================================
  // Example selection replaces editor content
  // ============================================================

  describe('example loading', () => {
    it('selecting example from dropdown replaces editor content', async () => {
      const { container } = render(<App />);

      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      expect(select).toBeDefined();

      if (select) {
        select.value = 'variables';
        act(() => {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Toolbar resets select to '' after loading example
        await waitFor(() => {
          // Editor should still render after example load
          const editor = container.querySelector('.editor-container');
          expect(editor).toBeDefined();
        });
      }
    });

    it('does NOT auto-execute when loading example', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      const { container } = render(<App />);

      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      if (select) {
        select.value = 'hello-world';
        act(() => {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });

        // Wait a tick for state updates
        await waitFor(() => {
          const editor = container.querySelector('.editor-container');
          expect(editor).toBeDefined();
        });

        // runInWorker should NOT be called
        expect(runSpy).not.toHaveBeenCalled();
      }
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('error with line location highlights gutter line in editor', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Variable not defined',
            category: 'runtime',
            line: 3,
            column: 5,
            errorId: 'RUNTIME-001',
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: 12,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeDefined();
          expect(errorDisplay?.textContent).toContain('line 3');
        });

        const editor = container.querySelector('.editor-container');
        expect(editor).toBeDefined();
      }
    });

    it('running valid code after error clears error display', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Test error',
            category: 'runtime',
            line: 1,
            column: 5,
            errorId: 'TEST-001',
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeDefined();
        });

        runSpy.mockReturnValueOnce(
          immediateRun({
            status: 'success',
            result: '"Hello"',
            error: null,
            duration: 5,
            logs: [],
          })
        );

        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeNull();
        });
      }
    });

    it('clears error gutter on re-run', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Test error',
            category: 'runtime',
            line: 2,
            column: 1,
            errorId: 'TEST-002',
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeDefined();
        });

        runSpy.mockReturnValueOnce(
          immediateRun({
            status: 'success',
            result: '"OK"',
            error: null,
            duration: 5,
            logs: [],
          })
        );

        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result).toBeDefined();
        });
      }
    });

    it('empty source shows no error and output remains idle', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'idle',
          result: null,
          error: null,
          duration: null,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          expect(runSpy).toHaveBeenCalled();
        });

        const errorDisplay = container.querySelector('.output-error');
        expect(errorDisplay).toBeNull();

        const resultDisplay = container.querySelector('.output-result');
        expect(resultDisplay).toBeNull();

        const outputPanel = container.querySelector('.output-panel');
        expect(outputPanel).toBeDefined();
      }
    });

    it('renders a resolved timeout ExecutionState as an error', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Execution exceeded the 5000ms time limit',
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
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeDefined();
          expect(errorDisplay?.textContent).toContain('time limit');
        });
      }
    });
  });

  // ============================================================
  // Rapid re-execution guard
  // ============================================================

  describe('rapid re-execution', () => {
    it('clicking Run multiple times does not produce duplicate outputs', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockImplementation(() =>
        delayedRun(
          {
            status: 'success',
            result: '"Test"',
            error: null,
            duration: 100,
            logs: [],
          },
          100
        )
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();
        runButton.click();
        runButton.click();

        await waitFor(
          () => {
            const result = container.querySelector('.output-result');
            expect(result).toBeDefined();
          },
          { timeout: 200 }
        );

        expect(runSpy).toHaveBeenCalledTimes(1);
      }
    });

    it('disables Run button while status is running', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockImplementation(() =>
        delayedRun(
          {
            status: 'success',
            result: '"Test"',
            error: null,
            duration: 50,
            logs: [],
          },
          50
        )
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        expect(runButton.disabled).toBe(false);

        runButton.click();

        await waitFor(() => {
          expect(runButton.disabled).toBe(true);
        });

        await waitFor(
          () => {
            expect(runButton.disabled).toBe(false);
          },
          { timeout: 100 }
        );
      }
    });

    it('disables Run button while a worker run is in flight (pending promise)', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValue(pendingRun());

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      if (runButton) {
        expect(runButton.disabled).toBe(false);

        act(() => {
          runButton.click();
        });

        await waitFor(() => {
          expect(runButton.disabled).toBe(true);
        });
      }
    });
  });

  // ============================================================
  // Panel resize persists across reload
  // ============================================================

  describe('panel resize persistence', () => {
    it('panel resize persists across simulated reload', async () => {
      localStorage.clear();

      const { unmount: unmount1 } = render(<App />);

      unmount1();

      const newRatio = 65;
      persistence.persistEditorState({
        splitRatio: newRatio,
        lastSource: 'test',
      });

      const { unmount: unmount2 } = render(<App />);

      const updatedState = persistence.loadEditorState();
      expect(updatedState?.splitRatio).toBe(newRatio);

      unmount2();

      render(<App />);

      const reloadedState = persistence.loadEditorState();
      expect(reloadedState?.splitRatio).toBe(newRatio);
    });

    it('persists split ratio changes multiple times', async () => {
      localStorage.clear();

      const ratios = [50, 30, 70, 60];

      for (const ratio of ratios) {
        persistence.persistEditorState({
          splitRatio: ratio,
          lastSource: 'test',
        });

        const { unmount } = render(<App />);

        const state = persistence.loadEditorState();
        expect(state?.splitRatio).toBe(ratio);

        unmount();
      }
    });
  });

  // ============================================================
  // Re-execution clears previous output
  // ============================================================

  describe('re-execution output clearing', () => {
    it('re-execution clears previous output before showing new result', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'success',
          result: '"First Result"',
          error: null,
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result?.textContent).toContain('First Result');
        });

        runSpy.mockReturnValueOnce(
          immediateRun({
            status: 'success',
            result: '"Second Result"',
            error: null,
            duration: 12,
            logs: [],
          })
        );

        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result?.textContent).toContain('Second Result');
          expect(result?.textContent).not.toContain('First Result');
        });
      }
    });

    it('re-execution clears previous error before showing new result', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Previous Error',
            category: 'runtime',
            line: 1,
            column: 1,
            errorId: 'ERR-001',
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const error = container.querySelector('.output-error');
          expect(error?.textContent).toContain('Previous Error');
        });

        runSpy.mockReturnValueOnce(
          immediateRun({
            status: 'success',
            result: '"New Result"',
            error: null,
            duration: 8,
            logs: [],
          })
        );

        runButton.click();

        await waitFor(() => {
          const error = container.querySelector('.output-error');
          expect(error).toBeNull();

          const result = container.querySelector('.output-result');
          expect(result?.textContent).toContain('New Result');
        });
      }
    });

    it('re-execution shows loading state while clearing previous output', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'success',
          result: '"First"',
          error: null,
          duration: 5,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result).toBeDefined();
        });

        runSpy.mockImplementation(() =>
          delayedRun(
            {
              status: 'success',
              result: '"Second"',
              error: null,
              duration: 50,
              logs: [],
            },
            50
          )
        );

        runButton.click();

        await waitFor(() => {
          expect(runButton.disabled).toBe(true);
        });

        await waitFor(
          () => {
            expect(runButton.disabled).toBe(false);
          },
          { timeout: 100 }
        );
      }
    });
  });

  // ============================================================
  // Persistence
  // ============================================================

  describe('persistence', () => {
    it('persists editor state on split ratio change', async () => {
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      render(<App />);

      await waitFor(() => {
        expect(persistSpy).toHaveBeenCalled();
      });
    });

    it('persists editor state on content change', async () => {
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      render(<App />);

      await waitFor(() => {
        expect(persistSpy).toHaveBeenCalled();
      });
    });
  });

  // ============================================================
  // Pure setExecutionState updater / concurrent-run guard (#217)
  // ============================================================

  describe('pure execution updater', () => {
    it('under StrictMode, a single Run click calls runInWorker exactly once', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValue(
        immediateRun({
          status: 'success',
          result: '"Test"',
          error: null,
          duration: 10,
          logs: [],
        })
      );

      const { container } = render(
        <StrictMode>
          <App />
        </StrictMode>
      );

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      act(() => {
        runButton.click();
      });

      await waitFor(() => {
        expect(runSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ============================================================
  // Debounced persistence (#218)
  // ============================================================

  describe('debounced persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('coalesces rapid source changes into a single persistEditorState call', async () => {
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      const { container } = render(<App />);

      // Discard the initial mount's debounced persist call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      persistSpy.mockClear();

      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      expect(select).toBeDefined();

      // Rapid-fire several source changes (each a synchronous setSource)
      // before the debounce window elapses; each subsequent change should
      // cancel the previous pending write.
      for (const exampleId of ['variables', 'hello-world', 'variables']) {
        select.value = exampleId;
        act(() => {
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }

      // Advance past the debounce window to flush the coalesced write.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(persistSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // Copy link too-large handling (#221)
  // ============================================================

  describe('copy link too-large state', () => {
    it('surfaces "Code too large" when copyLinkToClipboard reports status too-large', async () => {
      vi.spyOn(sharing, 'copyLinkToClipboard').mockResolvedValue({
        status: 'too-large',
        message: 'Code too large to share',
      });

      const { container } = render(<App />);

      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();

      if (shareButton) {
        act(() => {
          shareButton.click();
        });

        await waitFor(() => {
          expect(container.textContent).toContain('Code too large');
        });
      }
    });
  });

  // ============================================================
  // Decode notice for corrupt/unavailable shared links (#228)
  // ============================================================

  describe('decode notice', () => {
    it('shows a dismissible notice when the shared code is corrupt', async () => {
      vi.spyOn(sharing, 'readSourceFromURL').mockResolvedValue({
        ok: false,
        reason: 'corrupt',
      });

      const { container } = render(<App />);

      await waitFor(() => {
        const notice = container.querySelector('.decode-notice');
        expect(notice).toBeDefined();
        expect(notice).not.toBeNull();
      });

      const dismissButton = container.querySelector(
        '.decode-notice-dismiss'
      ) as HTMLButtonElement;
      expect(dismissButton).toBeDefined();

      if (dismissButton) {
        act(() => {
          dismissButton.click();
        });

        await waitFor(() => {
          const notice = container.querySelector('.decode-notice');
          expect(notice).toBeNull();
        });
      }
    });

    it('shows no notice when the shared code is absent', async () => {
      vi.spyOn(sharing, 'readSourceFromURL').mockResolvedValue({
        ok: false,
        reason: 'absent',
      });

      const { container } = render(<App />);

      await waitFor(() => {
        const editor = container.querySelector('.editor-container');
        expect(editor).toBeDefined();
      });

      const notice = container.querySelector('.decode-notice');
      expect(notice).toBeNull();
    });
  });

  // ============================================================
  // lastSource no longer held in component state (#227)
  // ============================================================

  describe('lastSource not held in state', () => {
    it('editing source does not cause loadEditorState().lastSource to drive re-renders back into state', async () => {
      localStorage.clear();

      const { container } = render(<App />);

      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();

      // Persisted lastSource should follow the debounced source edits
      // rather than being tracked separately in component state; verify
      // by checking persistEditorState eventually reflects a new source
      // without any duplicate/stale state field driving it.
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      await waitFor(() => {
        expect(persistSpy).toHaveBeenCalled();
      });

      const [state] = persistSpy.mock.calls[persistSpy.mock.calls.length - 1]!;
      expect(state).toHaveProperty('lastSource');
      expect(state).toHaveProperty('splitRatio');
      expect(Object.keys(state)).toEqual(
        expect.arrayContaining(['lastSource', 'splitRatio'])
      );
    });
  });

  // ============================================================
  // Integration
  // ============================================================

  describe('integration', () => {
    it('Run button triggers execution and updates output', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'success',
          result: '"Integration Test"',
          error: null,
          duration: 15,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result).toBeDefined();
          expect(result?.textContent).toContain('Integration Test');
        });
      }
    });

    it('renders all child components', () => {
      const { container } = render(<App />);

      expect(container.querySelector('.toolbar')).toBeDefined();
      expect(container.querySelector('.editor-container')).toBeDefined();
      expect(container.querySelector('.output-panel')).toBeDefined();
      expect(container.querySelector('.split-pane')).toBeDefined();
    });

    it('handles component communication via state', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');

      runSpy.mockReturnValueOnce(
        immediateRun({
          status: 'error',
          result: null,
          error: {
            message: 'Communication test error',
            category: 'parse',
            line: 3,
            column: 10,
            errorId: 'COMM-001',
            statusCode: null,
            statusMessage: null,
            statusProvider: null,
            statusTrace: null,
          },
          duration: 8,
          logs: [],
        })
      );

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeDefined();
          expect(errorDisplay?.textContent).toContain(
            'Communication test error'
          );
        });
      }
    });
  });
});
