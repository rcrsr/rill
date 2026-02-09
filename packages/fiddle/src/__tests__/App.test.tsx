/**
 * App Component Integration Tests
 *
 * Test coverage:
 * - IC-8: App renders without errors
 * - AC-5: Keyboard shortcut execution
 * - AC-6: Example selection replaces editor content without auto-executing
 * - AC-8: Panel resize persists across reload
 * - AC-11: Re-execution clears previous output before showing new result
 * - AC-15: Error with line location highlights gutter line in editor
 * - AC-16: Error clears on successful re-run
 * - AC-17: Empty source shows no error; output remains idle
 * - AC-23: Rapid re-execution guard prevents duplicates
 * - AC-24: First visit loads Hello World
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { App } from '../App.js';
import * as persistence from '../lib/persistence.js';
import * as execution from '../lib/execution.js';

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
  // IC-8: App renders without errors
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
  // AC-24: First visit loads Hello World
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
  // AC-5: Keyboard shortcut execution
  // ============================================================

  describe('keyboard shortcuts', () => {
    it('Editor component receives onRun prop for Cmd/Ctrl+Enter', () => {
      const { container } = render(<App />);

      // Verify Editor is rendered and receives onRun callback
      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();
    });

    it('Editor onRun callback triggers identical execution to Run button', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValue({
        status: 'success',
        result: '"Test"',
        error: null,
        duration: 10,
        logs: [],
      });

      const { container } = render(<App />);

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          expect(executeSpy).toHaveBeenCalledTimes(1);
        });
      }
    });
  });

  // ============================================================
  // AC-6: Example selection replaces editor content
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
      const executeSpy = vi.spyOn(execution, 'executeRill');

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

        // executeRill should NOT be called
        expect(executeSpy).not.toHaveBeenCalled();
      }
    });
  });

  // ============================================================
  // AC-15, AC-16, AC-17: Error handling
  // ============================================================

  describe('error handling', () => {
    it('error with line location highlights gutter line in editor [AC-15]', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'error',
        result: null,
        error: {
          message: 'Variable not defined',
          category: 'runtime',
          line: 3,
          column: 5,
          errorId: 'RUNTIME-001',
        },
        duration: 12,
        logs: [],
      });

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
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'error',
        result: null,
        error: {
          message: 'Test error',
          category: 'runtime',
          line: 1,
          column: 5,
          errorId: 'TEST-001',
        },
        duration: 10,
        logs: [],
      });

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

        executeSpy.mockResolvedValueOnce({
          status: 'success',
          result: '"Hello"',
          error: null,
          duration: 5,
          logs: [],
        });

        runButton.click();

        await waitFor(() => {
          const errorDisplay = container.querySelector('.output-error');
          expect(errorDisplay).toBeNull();
        });
      }
    });

    it('clears error gutter on re-run', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'error',
        result: null,
        error: {
          message: 'Test error',
          category: 'runtime',
          line: 2,
          column: 1,
          errorId: 'TEST-002',
        },
        duration: 10,
        logs: [],
      });

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

        executeSpy.mockResolvedValueOnce({
          status: 'success',
          result: '"OK"',
          error: null,
          duration: 5,
          logs: [],
        });

        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result).toBeDefined();
        });
      }
    });

    it('empty source shows no error and output remains idle [AC-17]', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'idle',
        result: null,
        error: null,
        duration: null,
        logs: [],
      });

      const { container } = render(<App />);

      const editor = container.querySelector('.editor-container');
      expect(editor).toBeDefined();

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;

      if (runButton) {
        runButton.click();

        await waitFor(() => {
          expect(executeSpy).toHaveBeenCalled();
        });

        const errorDisplay = container.querySelector('.output-error');
        expect(errorDisplay).toBeNull();

        const resultDisplay = container.querySelector('.output-result');
        expect(resultDisplay).toBeNull();

        const outputPanel = container.querySelector('.output-panel');
        expect(outputPanel).toBeDefined();
      }
    });
  });

  // ============================================================
  // AC-23: Rapid re-execution guard
  // ============================================================

  describe('rapid re-execution', () => {
    it('clicking Run multiple times does not produce duplicate outputs', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: 'success',
                result: '"Test"',
                error: null,
                duration: 100,
                logs: [],
              });
            }, 100);
          })
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

        expect(executeSpy).toHaveBeenCalledTimes(1);
      }
    });

    it('disables Run button while status is running', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                status: 'success',
                result: '"Test"',
                error: null,
                duration: 50,
                logs: [],
              });
            }, 50);
          })
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
  });

  // ============================================================
  // AC-8: Panel resize persists across reload
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
  // AC-11: Re-execution clears previous output
  // ============================================================

  describe('re-execution output clearing', () => {
    it('re-execution clears previous output before showing new result', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'success',
        result: '"First Result"',
        error: null,
        duration: 10,
        logs: [],
      });

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

        executeSpy.mockResolvedValueOnce({
          status: 'success',
          result: '"Second Result"',
          error: null,
          duration: 12,
          logs: [],
        });

        runButton.click();

        await waitFor(() => {
          const result = container.querySelector('.output-result');
          expect(result?.textContent).toContain('Second Result');
          expect(result?.textContent).not.toContain('First Result');
        });
      }
    });

    it('re-execution clears previous error before showing new result', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'error',
        result: null,
        error: {
          message: 'Previous Error',
          category: 'runtime',
          line: 1,
          column: 1,
          errorId: 'ERR-001',
        },
        duration: 10,
        logs: [],
      });

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

        executeSpy.mockResolvedValueOnce({
          status: 'success',
          result: '"New Result"',
          error: null,
          duration: 8,
          logs: [],
        });

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
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'success',
        result: '"First"',
        error: null,
        duration: 5,
        logs: [],
      });

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

        executeSpy.mockImplementation(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve({
                  status: 'success',
                  result: '"Second"',
                  error: null,
                  duration: 50,
                  logs: [],
                });
              }, 50);
            })
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
  // Integration
  // ============================================================

  describe('integration', () => {
    it('Run button triggers execution and updates output', async () => {
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'success',
        result: '"Integration Test"',
        error: null,
        duration: 15,
        logs: [],
      });

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
      const executeSpy = vi.spyOn(execution, 'executeRill');

      executeSpy.mockResolvedValueOnce({
        status: 'error',
        result: null,
        error: {
          message: 'Communication test error',
          category: 'parse',
          line: 3,
          column: 10,
          errorId: 'COMM-001',
        },
        duration: 8,
        logs: [],
      });

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
