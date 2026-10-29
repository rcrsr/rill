/**
 * App Component Integration Tests
 *
 * Test coverage:
 * - Layout: toolbar above a split pane holding editor and output
 * - Initial state from first visit and persisted storage
 * - Ctrl+Enter in the editor runs the document
 * - Example selection replaces editor content without auto-executing
 * - Error display, gutter highlighting, and clearing on re-run
 * - Rapid re-execution guard and Run button disabling
 * - Re-execution clears previous output
 * - Panel resize and editor content persistence
 * - Share link and decode notices
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import {
  render,
  cleanup,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { App } from '../App.js';
import * as persistence from '../lib/persistence.js';
import * as runner from '../lib/execution-runner.js';
import * as sharing from '../lib/sharing.js';
import { loadExample } from '../lib/examples.js';
import type { ExecutionState } from '../lib/execution.js';

/** Wraps a resolved ExecutionState into the { promise, cancel } shape runInWorker returns. */
function immediateRun(state: ExecutionState): {
  promise: Promise<ExecutionState>;
  cancel: () => void;
} {
  return { promise: Promise.resolve(state), cancel: vi.fn() };
}

/** Wraps an ExecutionState into a { promise, cancel } pair that never settles. */
function pendingRun(): {
  promise: Promise<ExecutionState>;
  cancel: () => void;
} {
  return { promise: new Promise<ExecutionState>(() => {}), cancel: vi.fn() };
}

/** A { promise, cancel } pair whose promise settles when the test calls resolve. */
function deferredRun(): {
  promise: Promise<ExecutionState>;
  cancel: () => void;
  resolve: (state: ExecutionState) => void;
} {
  let resolve!: (state: ExecutionState) => void;
  const promise = new Promise<ExecutionState>((r) => {
    resolve = r;
  });
  return { promise, cancel: vi.fn(), resolve };
}

/** Builds a successful ExecutionState carrying the given result text. */
function successState(result: string, duration = 10): ExecutionState {
  return { status: 'success', result, error: null, duration, logs: [] };
}

/** Builds a failed ExecutionState with the given message and location. */
function errorState(
  message: string,
  line: number | null,
  column: number | null,
  category: 'lexer' | 'parse' | 'runtime' = 'runtime',
  errorId: string | null = 'TEST-001'
): ExecutionState {
  return {
    status: 'error',
    result: null,
    error: {
      message,
      category,
      line,
      column,
      errorId,
      statusCode: null,
      statusMessage: null,
      statusProvider: null,
      statusTrace: null,
    },
    duration: 10,
    logs: [],
  };
}

/** Returns the Run button of a rendered App. */
function getRunButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('.toolbar-run') as HTMLButtonElement;
}

/** Clicks the Run button and flushes the resulting state updates. */
async function clickRun(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click();
  });
}

/** Returns the CodeMirror view mounted inside a rendered App. */
function getEditorView(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(
    container.querySelector('.cm-content') as HTMLElement
  )!;
}

/** Returns the current editor document text of a rendered App. */
function getEditorDoc(container: HTMLElement): string {
  return getEditorView(container).state.doc.toString();
}

/** Selects an example in the toolbar dropdown. */
function selectExample(container: HTMLElement, exampleId: string): void {
  const select = container.querySelector(
    '.toolbar-select'
  ) as HTMLSelectElement;
  select.value = exampleId;
  act(() => {
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('App', () => {
  beforeEach(() => {
    // Mock localStorage. happy-dom exposes window.localStorage as a getter-only
    // property, so it must be stubbed rather than assigned.
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      get length() {
        return storage.size;
      },
    } as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
    vi.restoreAllMocks();
  });

  // ============================================================
  // Layout
  // ============================================================

  describe('rendering', () => {
    it('places the toolbar before a split pane holding the editor and the output', () => {
      const { container } = render(<App />);

      const toolbar = container.querySelector('.toolbar')!;
      const splitPane = container.querySelector('.split-pane')!;
      expect(toolbar).not.toBeNull();
      expect(splitPane).not.toBeNull();
      expect(
        toolbar.compareDocumentPosition(splitPane) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      const panels = splitPane.querySelectorAll('.split-pane-panel');
      expect(panels[0]!.querySelector('.editor-container')).not.toBeNull();
      expect(panels[1]!.querySelector('.output-panel')).not.toBeNull();
    });
  });

  // ============================================================
  // Initial state
  // ============================================================

  describe('initial state', () => {
    it('shows Hello World at a 50 percent split on first visit', () => {
      const { container } = render(<App />);

      expect(getEditorDoc(container)).toContain('Hello, World!');
      expect(
        container
          .querySelector('[role="separator"]')!
          .getAttribute('aria-valuenow')
      ).toBe('50');
    });

    it('restores the persisted source and split ratio on subsequent visits', () => {
      persistence.persistEditorState({
        splitRatio: 60,
        lastSource: 'log("test")',
      });

      const { container } = render(<App />);

      expect(getEditorDoc(container)).toBe('log("test")');
      expect(
        container
          .querySelector('[role="separator"]')!
          .getAttribute('aria-valuenow')
      ).toBe('60');
    });
  });

  // ============================================================
  // Keyboard shortcut execution
  // ============================================================

  describe('keyboard shortcuts', () => {
    it('runs the editor source and shows the result when Ctrl+Enter is pressed', async () => {
      const source = 'log("keyboard")';
      persistence.persistEditorState({ splitRatio: 50, lastSource: source });
      const runSpy = vi
        .spyOn(runner, 'runInWorker')
        .mockReturnValue(immediateRun(successState('"Keyboard Result"')));

      const { container } = render(<App />);

      await act(async () => {
        container.querySelector('.cm-content')!.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            ctrlKey: true,
            bubbles: true,
          })
        );
      });

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(source);
      await waitFor(() => {
        expect(
          container.querySelector('.output-result')?.textContent
        ).toContain('Keyboard Result');
      });
    });
  });

  // ============================================================
  // Example selection replaces editor content
  // ============================================================

  describe('example loading', () => {
    it('replaces the editor content with the selected example source', async () => {
      const { container } = render(<App />);

      selectExample(container, 'variables');

      await waitFor(() => {
        expect(getEditorDoc(container)).toBe(loadExample('variables')!.source);
      });
    });

    it('does not execute the selected example', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValue(pendingRun());

      const { container } = render(<App />);
      const initialDoc = getEditorDoc(container);

      selectExample(container, 'variables');

      await waitFor(() => {
        expect(getEditorDoc(container)).toBe(loadExample('variables')!.source);
      });
      expect(getEditorDoc(container)).not.toBe(initialDoc);
      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('highlights the failing editor line and shows its line and column', async () => {
      const lines = ['"one" => $a', '"two" => $b', '"three" => $c'];
      persistence.persistEditorState({
        splitRatio: 50,
        lastSource: lines.join('\n'),
      });
      vi.spyOn(runner, 'runInWorker').mockReturnValueOnce(
        immediateRun(errorState('Variable not defined', 3, 5))
      );

      const { container } = render(<App />);
      await clickRun(getRunButton(container));

      await waitFor(() => {
        expect(container.querySelector('.cm-error-line')?.textContent).toBe(
          lines[2]
        );
      });
      expect(
        container.querySelector('.output-error-location')?.textContent
      ).toContain('line 3, col 5');
    });

    it('clears the error display when a re-run succeeds', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValueOnce(immediateRun(errorState('Test error', 1, 5)));

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.output-error')).not.toBeNull();
      });

      runSpy.mockReturnValueOnce(immediateRun(successState('"Hello"')));
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.output-error')).toBeNull();
      });
      expect(runSpy).toHaveBeenCalledTimes(2);
    });

    it('removes the error line highlight when a re-run succeeds', async () => {
      persistence.persistEditorState({
        splitRatio: 50,
        lastSource: '"one" => $a\n"two" => $b',
      });
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValueOnce(immediateRun(errorState('Test error', 2, 1)));

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.cm-error-line')).not.toBeNull();
      });

      runSpy.mockReturnValueOnce(immediateRun(successState('"OK"')));
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.cm-error-line')).toBeNull();
      });
      expect(container.querySelector('.output-result')?.textContent).toContain(
        'OK'
      );
    });

    it('renders an idle result as the idle placeholder', async () => {
      persistence.persistEditorState({ splitRatio: 50, lastSource: '' });
      const runSpy = vi.spyOn(runner, 'runInWorker').mockReturnValueOnce(
        immediateRun({
          status: 'idle',
          result: null,
          error: null,
          duration: null,
          logs: [],
        })
      );

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(runSpy).toHaveBeenCalledWith('');
        expect(runButton.disabled).toBe(false);
      });
      expect(container.querySelector('.output-idle')?.textContent).toContain(
        'Run code to see output'
      );
      expect(container.querySelector('.output-error')).toBeNull();
      expect(container.querySelector('.output-result')).toBeNull();
    });

    it('renders a resolved timeout ExecutionState as an error', async () => {
      vi.spyOn(runner, 'runInWorker').mockReturnValueOnce(
        immediateRun(
          errorState(
            'Execution exceeded the 5000ms time limit',
            null,
            null,
            'runtime',
            null
          )
        )
      );

      const { container } = render(<App />);
      await clickRun(getRunButton(container));

      await waitFor(() => {
        expect(container.querySelector('.output-error')?.textContent).toContain(
          'time limit'
        );
      });
    });
  });

  // ============================================================
  // Rapid re-execution guard
  // ============================================================

  describe('rapid re-execution', () => {
    it('clicking Run multiple times does not produce duplicate outputs', async () => {
      const deferred = deferredRun();
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockImplementation(() => deferred);

      const { container } = render(<App />);
      const runButton = getRunButton(container);

      act(() => {
        runButton.click();
        runButton.click();
        runButton.click();
      });

      expect(runSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferred.resolve(successState('"Test"'));
      });

      const results = container.querySelectorAll('.output-result');
      expect(results).toHaveLength(1);
      expect(results[0]!.textContent).toContain('Test');
      expect(runSpy).toHaveBeenCalledTimes(1);
    });

    it('disables the Run button while a run is in progress and re-enables it after', async () => {
      const deferred = deferredRun();
      vi.spyOn(runner, 'runInWorker').mockImplementation(() => deferred);

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      expect(runButton.disabled).toBe(false);

      act(() => {
        runButton.click();
      });
      expect(runButton.disabled).toBe(true);

      await act(async () => {});
      expect(runButton.disabled).toBe(true);

      await act(async () => {
        deferred.resolve(successState('"Test"'));
      });
      expect(runButton.disabled).toBe(false);
    });

    it('keeps the Run button disabled while a worker run is in flight', async () => {
      vi.spyOn(runner, 'runInWorker').mockReturnValue(pendingRun());

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      expect(runButton.disabled).toBe(false);

      act(() => {
        runButton.click();
      });

      await waitFor(() => {
        expect(runButton.disabled).toBe(true);
      });
    });
  });

  // ============================================================
  // Panel resize persists across reload
  // ============================================================

  describe('panel resize persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('restores a keyboard-resized split ratio after remounting', async () => {
      persistence.persistEditorState({ splitRatio: 65, lastSource: 'test' });

      const first = render(<App />);
      const separator = first.container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;
      expect(separator.getAttribute('aria-valuenow')).toBe('65');

      // happy-dom measures no container width, so the pane is vertical and
      // ArrowDown grows the first panel by one 2-point step.
      act(() => {
        fireEvent.keyDown(separator, { key: 'ArrowDown' });
      });

      // Unmounting cancels the pending debounced write, so flush it first.
      expect(persistence.loadEditorState().splitRatio).toBe(65);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(persistence.loadEditorState().splitRatio).toBe(67);
      first.unmount();

      const second = render(<App />);
      expect(
        second.container
          .querySelector('[role="separator"]')!
          .getAttribute('aria-valuenow')
      ).toBe('67');
    });
  });

  // ============================================================
  // Re-execution clears previous output
  // ============================================================

  describe('re-execution output clearing', () => {
    it('replaces the previous result with the new result', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValueOnce(immediateRun(successState('"First Result"')));

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(
          container.querySelector('.output-result')?.textContent
        ).toContain('First Result');
      });

      runSpy.mockReturnValueOnce(
        immediateRun(successState('"Second Result"', 12))
      );
      await clickRun(runButton);

      await waitFor(() => {
        const text = container.querySelector('.output-result')?.textContent;
        expect(text).toContain('Second Result');
        expect(text).not.toContain('First Result');
      });
    });

    it('replaces the previous error with the new result', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValueOnce(
        immediateRun(errorState('Previous Error', 1, 1, 'runtime', 'ERR-001'))
      );

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.output-error')?.textContent).toContain(
          'Previous Error'
        );
      });

      runSpy.mockReturnValueOnce(immediateRun(successState('"New Result"', 8)));
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.output-error')).toBeNull();
        expect(
          container.querySelector('.output-result')?.textContent
        ).toContain('New Result');
      });
    });

    it('shows the running state instead of the previous result during a re-run', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValueOnce(immediateRun(successState('"First"', 5)));

      const { container } = render(<App />);
      const runButton = getRunButton(container);
      await clickRun(runButton);

      await waitFor(() => {
        expect(container.querySelector('.output-result')).not.toBeNull();
      });

      const deferred = deferredRun();
      runSpy.mockImplementation(() => deferred);
      act(() => {
        runButton.click();
      });

      expect(container.querySelector('.output-running')).not.toBeNull();
      expect(container.querySelector('.output-result')).toBeNull();

      await act(async () => {
        deferred.resolve(successState('"Second"', 50));
      });

      expect(container.querySelector('.output-result')?.textContent).toContain(
        'Second'
      );
    });
  });

  // ============================================================
  // Pure setExecutionState updater / concurrent-run guard
  // ============================================================

  describe('pure execution updater', () => {
    it('under StrictMode, a single Run click calls runInWorker exactly once', async () => {
      const runSpy = vi.spyOn(runner, 'runInWorker');
      runSpy.mockReturnValue(immediateRun(successState('"Test"')));

      const { container } = render(
        <StrictMode>
          <App />
        </StrictMode>
      );

      const runButton = getRunButton(container);
      expect(runButton).not.toBeNull();

      act(() => {
        runButton.click();
      });

      await waitFor(() => {
        expect(runSpy).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ============================================================
  // Debounced persistence
  // ============================================================

  describe('debounced persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('persists edited editor content after the debounce', async () => {
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      const { container } = render(<App />);

      // Discard the initial mount's debounced persist call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      persistSpy.mockClear();

      const marker = '# edited-marker';
      act(() => {
        getEditorView(container).dispatch({
          changes: { from: 0, insert: marker },
        });
      });

      const hasMarker = expect.objectContaining({
        lastSource: expect.stringContaining(marker),
      });
      expect(persistSpy).not.toHaveBeenCalledWith(hasMarker);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(persistSpy).toHaveBeenCalledWith(hasMarker);
    });

    it('coalesces rapid source changes into a single persistEditorState call', async () => {
      const persistSpy = vi.spyOn(persistence, 'persistEditorState');

      const { container } = render(<App />);

      // Discard the initial mount's debounced persist call.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      persistSpy.mockClear();

      expect(container.querySelector('.toolbar-select')).not.toBeNull();

      // Rapid-fire several source changes before the debounce window
      // elapses; each subsequent change cancels the previous pending write.
      for (const exampleId of ['variables', 'hello-world', 'variables']) {
        selectExample(container, exampleId);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      }

      // Advance past the debounce window to flush the coalesced write.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(persistSpy).toHaveBeenCalledTimes(1);
      expect(persistSpy.mock.calls[0]![0].lastSource).toBe(
        loadExample('variables')!.source
      );
    });
  });

  // ============================================================
  // Copy link too-large handling
  // ============================================================

  describe('copy link too-large state', () => {
    it('shows the too-large notice and an Error share button when the code is too large to share', async () => {
      vi.spyOn(sharing, 'copyLinkToClipboard').mockResolvedValue({
        status: 'too-large',
        message: 'Code too large to share',
      });

      const { container } = render(<App />);
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;

      await act(async () => {
        shareButton.click();
      });

      await waitFor(() => {
        expect(container.querySelector('.copy-link-notice')?.textContent).toBe(
          'Code too large to share'
        );
      });
      expect(shareButton.textContent).toBe('Error');
    });
  });

  // ============================================================
  // Decode notice for corrupt/unavailable shared links
  // ============================================================

  describe('decode notice', () => {
    it('shows a dismissible notice when the shared code is corrupt', async () => {
      vi.spyOn(sharing, 'readSourceFromURL').mockResolvedValue({
        ok: false,
        reason: 'corrupt',
      });

      const { container } = render(<App />);

      await waitFor(() => {
        expect(
          container.querySelector('.decode-notice span')?.textContent
        ).toBe(
          'Shared link could not be read: the code parameter is corrupted.'
        );
      });

      const dismissButton = container.querySelector(
        '.decode-notice-dismiss'
      ) as HTMLButtonElement;
      expect(dismissButton).not.toBeNull();

      act(() => {
        dismissButton.click();
      });

      await waitFor(() => {
        expect(container.querySelector('.decode-notice')).toBeNull();
      });
    });

    it('shows no notice when the shared code is absent', async () => {
      const readSpy = vi.spyOn(sharing, 'readSourceFromURL').mockResolvedValue({
        ok: false,
        reason: 'absent',
      });

      const { container } = render(<App />);

      await act(async () => {
        await readSpy.mock.results[0]!.value;
      });

      expect(container.querySelector('.decode-notice')).toBeNull();
    });
  });

  // ============================================================
  // Integration
  // ============================================================

  describe('integration', () => {
    it('Run button triggers execution and updates output', async () => {
      vi.spyOn(runner, 'runInWorker').mockReturnValueOnce(
        immediateRun(successState('"Integration Test"', 15))
      );

      const { container } = render(<App />);
      await clickRun(getRunButton(container));

      await waitFor(() => {
        expect(
          container.querySelector('.output-result')?.textContent
        ).toContain('Integration Test');
      });
    });

    it('shows a parse error from a failed run with its category badge', async () => {
      vi.spyOn(runner, 'runInWorker').mockReturnValueOnce(
        immediateRun(
          errorState('Communication test error', 3, 10, 'parse', 'COMM-001')
        )
      );

      const { container } = render(<App />);
      await clickRun(getRunButton(container));

      await waitFor(() => {
        expect(container.querySelector('.output-error')?.textContent).toContain(
          'Communication test error'
        );
      });
      expect(container.querySelector('.output-error-badge')?.textContent).toBe(
        'Parse'
      );
    });
  });
});
