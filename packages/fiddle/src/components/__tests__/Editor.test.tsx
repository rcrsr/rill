/**
 * Editor Component Tests
 *
 * Test coverage for Editor component:
 * - Component renders without errors
 * - Ctrl+Enter triggers onRun callback
 * - errorLine prop highlights gutter line
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { indentUnit } from '@codemirror/language';
import { Editor, type EditorProps } from '../Editor.js';
import { measureP95 } from '../../../tests/helpers/measure.js';

function getView(container: HTMLElement): EditorView {
  const content = container.querySelector('.cm-content');
  expect(content).not.toBeNull();
  const view = EditorView.findFromDOM(content as HTMLElement);
  expect(view).not.toBeNull();
  return view as EditorView;
}

describe('Editor', () => {
  let mockOnChange: ReturnType<typeof vi.fn<(value: string) => void>>;
  let mockOnRun: ReturnType<typeof vi.fn<() => void>>;
  let defaultProps: EditorProps;

  beforeEach(() => {
    mockOnChange = vi.fn<(value: string) => void>();
    mockOnRun = vi.fn<() => void>();
    defaultProps = {
      value: '',
      onChange: mockOnChange,
      onRun: mockOnRun,
    };
  });

  afterEach(() => {
    cleanup();
  });

  // ============================================================
  // Component renders without errors
  // ============================================================

  describe('rendering', () => {
    it('renders a CodeMirror editor with an empty document', () => {
      const { container } = render(<Editor {...defaultProps} />);
      const editor = container.querySelector('.editor-container');
      expect(editor).not.toBeNull();
      expect(editor?.querySelector('.cm-editor')).not.toBeNull();
      expect(getView(container).state.doc.toString()).toBe('');
    });

    it('renders with initial value without reporting a change', () => {
      const { container } = render(
        <Editor {...defaultProps} value="log('hello')" />
      );
      expect(getView(container).state.doc.toString()).toBe("log('hello')");
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('applies custom ARIA label', () => {
      const { container } = render(
        <Editor {...defaultProps} ariaLabel="Test editor" />
      );
      const editor = container.querySelector('.editor-container');
      expect(editor?.getAttribute('aria-label')).toBe('Test editor');
    });

    it('uses default ARIA label', () => {
      const { container } = render(<Editor {...defaultProps} />);
      const editor = container.querySelector('.editor-container');
      expect(editor?.getAttribute('aria-label')).toBe('Rill code editor');
    });

    it('renders with dark theme', () => {
      const { container } = render(<Editor {...defaultProps} />);
      expect(getView(container).state.facet(EditorView.darkTheme)).toBe(true);
    });
  });

  // ============================================================
  // Keyboard shortcut execution
  // ============================================================

  describe('keyboard shortcuts', () => {
    it('triggers onRun once when Ctrl+Enter is pressed and leaves the document unchanged', async () => {
      const inputValue = "log('hello')";
      const { container } = render(
        <Editor {...defaultProps} value={inputValue} />
      );

      const cmEditor = container.querySelector('.cm-content');
      expect(cmEditor).not.toBeNull();

      // Under happy-dom's X11 user agent, CodeMirror maps Mod to Ctrl.
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
      });
      await act(async () => {
        cmEditor!.dispatchEvent(event);
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(mockOnRun).toHaveBeenCalledTimes(1);
      expect(getView(container).state.doc.toString()).toBe(inputValue);
    });
  });

  // ============================================================
  // Error line highlighting
  // ============================================================

  describe('error line highlighting', () => {
    it('does not highlight when errorLine is null', () => {
      const { container } = render(
        <Editor {...defaultProps} value="line 1" errorLine={null} />
      );
      expect(container.querySelector('.cm-error-line')).toBeNull();
    });

    it('does not highlight when errorLine is 0', () => {
      const { container } = render(
        <Editor {...defaultProps} value="line 1" errorLine={0} />
      );
      expect(container.querySelector('.cm-error-line')).toBeNull();
    });

    it('decorates the last line when errorLine is beyond document length', () => {
      const value = 'line 1\nline 2';
      const { container } = render(
        <Editor {...defaultProps} value={value} errorLine={10} />
      );
      const decorated = container.querySelectorAll('.cm-error-line');
      expect(decorated).toHaveLength(1);
      expect(decorated[0]?.textContent).toBe('line 2');
    });

    it('moves the highlight when errorLine changes', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container, rerender } = render(
        <Editor {...defaultProps} value={value} errorLine={1} />
      );

      rerender(<Editor {...defaultProps} value={value} errorLine={2} />);

      const decorated = container.querySelectorAll('.cm-error-line');
      expect(decorated).toHaveLength(1);
      expect(decorated[0]?.textContent).toBe('line 2');
    });

    it('clears highlight when errorLine becomes null', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container, rerender } = render(
        <Editor {...defaultProps} value={value} errorLine={2} />
      );
      expect(container.querySelector('.cm-error-line')).not.toBeNull();

      rerender(<Editor {...defaultProps} value={value} errorLine={null} />);

      expect(container.querySelectorAll('.cm-error-line')).toHaveLength(0);
    });

    it('renders the cm-error-line decoration on the errorLine line', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container } = render(
        <Editor {...defaultProps} value={value} errorLine={2} />
      );

      const errorLineEl = container.querySelector('.cm-error-line');
      expect(errorLineEl).not.toBeNull();
      expect(errorLineEl?.textContent).toBe('line 2');
    });

    it('clears the cm-error-line decoration on the first local edit', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container } = render(
        <Editor {...defaultProps} value={value} errorLine={2} />
      );

      expect(container.querySelector('.cm-error-line')).not.toBeNull();

      const cmContentEl = container.querySelector('.cm-content');
      expect(cmContentEl).not.toBeNull();
      const view = EditorView.findFromDOM(cmContentEl as HTMLElement);
      expect(view).not.toBeNull();

      // Simulate a user edit to the document.
      act(() => {
        view?.dispatch({
          changes: { from: 0, to: 0, insert: 'x' },
        });
      });

      expect(container.querySelector('.cm-error-line')).toBeNull();
    });

    it('re-highlights the error line on the next failed run', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container, rerender } = render(
        <Editor {...defaultProps} value={value} errorLine={2} />
      );

      // A local edit clears the stale decoration.
      const cmContentEl = container.querySelector('.cm-content');
      const view = EditorView.findFromDOM(cmContentEl as HTMLElement);
      act(() => {
        view?.dispatch({ changes: { from: 0, to: 0, insert: 'x' } });
      });
      expect(container.querySelector('.cm-error-line')).toBeNull();

      // A subsequent failed run sets a new errorLine, which must reappear.
      rerender(<Editor {...defaultProps} value={value} errorLine={3} />);

      expect(container.querySelector('.cm-error-line')).not.toBeNull();
    });
  });

  // ============================================================
  // Value synchronization
  // ============================================================

  describe('value synchronization', () => {
    it('updates editor when value prop changes', () => {
      const { container, rerender } = render(
        <Editor {...defaultProps} value="initial" />
      );

      rerender(<Editor {...defaultProps} value="updated" />);

      expect(getView(container).state.doc.toString()).toBe('updated');
    });

    it('renders each line of a multiline value', () => {
      const value = 'line 1\nline 2\nline 3';
      const { container } = render(<Editor {...defaultProps} value={value} />);
      expect(container.querySelectorAll('.cm-line')).toHaveLength(3);
    });
  });

  // ============================================================
  // Accessibility
  // ============================================================

  describe('accessibility', () => {
    it('has CodeMirror textbox with role', () => {
      const { container } = render(<Editor {...defaultProps} />);
      const cmEditor = container.querySelector('.cm-content[role="textbox"]');
      expect(cmEditor).not.toBeNull();
    });

    it('CodeMirror textbox has aria-multiline="true"', () => {
      const { container } = render(<Editor {...defaultProps} />);
      const cmEditor = container.querySelector('.cm-content');
      expect(cmEditor?.getAttribute('aria-multiline')).toBe('true');
    });
  });

  // ============================================================
  // Performance
  // ============================================================

  describe('performance', () => {
    it('handles large documents without blocking', () => {
      const largeValue = Array.from(
        { length: 1000 },
        (_, i) => `line ${i + 1}`
      ).join('\n');

      const p95 = measureP95(
        () => {
          const { unmount } = render(
            <Editor {...defaultProps} value={largeValue} />
          );
          unmount();
        },
        { samples: 20, warmup: 3 }
      );

      // Warm p95 render of 1000 lines stays under 200ms.
      expect(p95).toBeLessThan(200);
    });

    it('updates value without blocking (< 16ms)', () => {
      const values = ['first value', 'second value'];
      const { container, rerender } = render(
        <Editor {...defaultProps} value="initial" />
      );

      let i = 0;
      const p95 = measureP95(
        () => {
          rerender(<Editor {...defaultProps} value={values[i++ % 2]!} />);
        },
        { samples: 50, warmup: 5 }
      );

      // 55 calls alternate starting at index 0, so the last value is index 54 % 2.
      expect(getView(container).state.doc.toString()).toBe(values[54 % 2]);
      // Should update in less than 16ms (60fps)
      expect(p95).toBeLessThan(16);
    });
  });

  // ============================================================
  // Indentation
  // ============================================================

  describe('indentation', () => {
    it('displays tabs with 2-space width', () => {
      const valueWithTabs = 'if true {\n\tlog("indented")\n}';
      const { container } = render(
        <Editor {...defaultProps} value={valueWithTabs} />
      );
      expect(getView(container).state.tabSize).toBe(2);
    });

    it('preserves alignment with 2-space indentation', () => {
      const valueWithSpaces = 'if true {\n  log("2-space indent")\n}';
      const { container } = render(
        <Editor {...defaultProps} value={valueWithSpaces} />
      );
      const view = getView(container);
      expect(view.state.doc.toString()).toBe(valueWithSpaces);
      expect(view.state.facet(indentUnit)).toBe('  ');
    });
  });
});
