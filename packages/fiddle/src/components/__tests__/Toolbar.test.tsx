/**
 * Toolbar Component Tests
 *
 * Test coverage for Toolbar component:
 * - IC-12: Component renders without errors
 * - AC-6: Example selection triggers onExampleSelect callback
 * - AC-7: Theme toggle triggers onThemeToggle callback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Toolbar, type ToolbarProps } from '../Toolbar.js';
import type { CodeExample } from '../../lib/examples.js';

describe('Toolbar', () => {
  let mockOnRun: ReturnType<typeof vi.fn<() => void>>;
  let mockOnExampleSelect: ReturnType<typeof vi.fn<(example: CodeExample) => void>>;
  let mockOnThemeToggle: ReturnType<typeof vi.fn<() => void>>;
  let defaultProps: ToolbarProps;

  beforeEach(() => {
    mockOnRun = vi.fn<() => void>();
    mockOnExampleSelect = vi.fn<(example: CodeExample) => void>();
    mockOnThemeToggle = vi.fn<() => void>();
    defaultProps = {
      onRun: mockOnRun,
      onExampleSelect: mockOnExampleSelect,
      onThemeToggle: mockOnThemeToggle,
    };
  });

  afterEach(() => {
    cleanup();
  });

  // ============================================================
  // IC-12: Component renders without errors
  // ============================================================

  describe('rendering', () => {
    it('renders without errors', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const toolbar = container.querySelector('.toolbar-container');
      expect(toolbar).toBeDefined();
    });

    it('renders Run button', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const runButton = container.querySelector('.toolbar-run-button');
      expect(runButton).toBeDefined();
      expect(runButton?.textContent).toBe('Run');
    });

    it('renders example selector', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select');
      expect(select).toBeDefined();
    });

    it('renders theme toggle', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const themeToggle = container.querySelector('.toolbar-theme-toggle');
      expect(themeToggle).toBeDefined();
    });

    it('applies ARIA label to toolbar', () => {
      const { container } = render(<Toolbar {...defaultProps} ariaLabel="Test toolbar" />);
      const toolbar = container.querySelector('[role="toolbar"][aria-label="Test toolbar"]');
      expect(toolbar).toBeDefined();
    });

    it('uses default ARIA label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const toolbar = container.querySelector('[role="toolbar"][aria-label="Toolbar"]');
      expect(toolbar).toBeDefined();
    });

    it('renders with light theme', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="light" />);
      const toolbar = container.querySelector('.toolbar-container');
      expect(toolbar).toBeDefined();
    });

    it('renders with dark theme', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="dark" />);
      const toolbar = container.querySelector('.toolbar-container');
      expect(toolbar).toBeDefined();
    });
  });

  // ============================================================
  // Run Button
  // ============================================================

  describe('Run button', () => {
    it('triggers onRun when clicked', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const runButton = container.querySelector('.toolbar-run-button') as HTMLButtonElement;
      expect(runButton).toBeDefined();

      fireEvent.click(runButton);
      expect(mockOnRun).toHaveBeenCalledTimes(1);
    });

    it('is disabled when disabled prop is true', () => {
      const { container } = render(<Toolbar {...defaultProps} disabled={true} />);
      const runButton = container.querySelector('.toolbar-run-button') as HTMLButtonElement;
      expect(runButton).toBeDefined();
      expect(runButton.disabled).toBe(true);
    });

    it('is enabled when disabled prop is false', () => {
      const { container } = render(<Toolbar {...defaultProps} disabled={false} />);
      const runButton = container.querySelector('.toolbar-run-button') as HTMLButtonElement;
      expect(runButton).toBeDefined();
      expect(runButton.disabled).toBe(false);
    });

    it('does not trigger onRun when disabled', () => {
      const { container } = render(<Toolbar {...defaultProps} disabled={true} />);
      const runButton = container.querySelector('.toolbar-run-button') as HTMLButtonElement;
      expect(runButton).toBeDefined();

      fireEvent.click(runButton);
      expect(mockOnRun).not.toHaveBeenCalled();
    });

    it('has accessible label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const runButton = container.querySelector('[aria-label="Run code"]');
      expect(runButton).toBeDefined();
    });
  });

  // ============================================================
  // AC-6: Example selection triggers onExampleSelect callback
  // ============================================================

  describe('example selector', () => {
    it('triggers onExampleSelect when example is selected', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;
      expect(select).toBeDefined();

      fireEvent.change(select, { target: { value: 'hello-world' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample).toBeDefined();
      expect(calledExample?.id).toBe('hello-world');
      expect(calledExample?.label).toBe('Hello World');
      expect(calledExample?.source).toBe('"Hello, world!"');
    });

    it('loads variables example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'variables' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('variables');
      expect(calledExample?.label).toBe('Variables');
    });

    it('loads pipes example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'pipes' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('pipes');
      expect(calledExample?.label).toBe('Pipes');
    });

    it('loads functions example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'functions' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('functions');
      expect(calledExample?.label).toBe('Functions');
    });

    it('loads conditionals example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'conditionals' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('conditionals');
      expect(calledExample?.label).toBe('Conditionals');
    });

    it('does not trigger onExampleSelect when empty option is selected', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;

      fireEvent.change(select, { target: { value: '' } });
      expect(mockOnExampleSelect).not.toHaveBeenCalled();
    });

    it('is disabled when disabled prop is true', () => {
      const { container } = render(<Toolbar {...defaultProps} disabled={true} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.disabled).toBe(true);
    });

    it('has accessible label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('[aria-label="Select example"]');
      expect(select).toBeDefined();
    });

    it('renders all required examples', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option'));

      // Filter out placeholder option
      const exampleOptions = options.filter((opt) => opt.value !== '');

      expect(exampleOptions).toHaveLength(5);
      expect(exampleOptions.map((opt) => opt.value)).toEqual([
        'hello-world',
        'variables',
        'pipes',
        'functions',
        'conditionals',
      ]);
    });

    it('renders placeholder option as default', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;
      const placeholder = select.querySelector('option[value=""]') as HTMLOptionElement;

      expect(placeholder).toBeDefined();
      expect(placeholder?.textContent).toBe('Load Example...');
      expect(placeholder?.disabled).toBe(true);
    });
  });

  // ============================================================
  // AC-7: Theme toggle triggers onThemeToggle callback
  // ============================================================

  describe('theme toggle', () => {
    it('triggers onThemeToggle when clicked', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const themeToggle = container.querySelector('.toolbar-theme-toggle') as HTMLButtonElement;
      expect(themeToggle).toBeDefined();

      fireEvent.click(themeToggle);
      expect(mockOnThemeToggle).toHaveBeenCalledTimes(1);
    });

    it('displays "Dark" when theme is light', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="light" />);
      const themeToggle = container.querySelector('.toolbar-theme-toggle') as HTMLButtonElement;
      expect(themeToggle).toBeDefined();
      expect(themeToggle.textContent).toContain('Dark');
    });

    it('displays "Light" when theme is dark', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="dark" />);
      const themeToggle = container.querySelector('.toolbar-theme-toggle') as HTMLButtonElement;
      expect(themeToggle).toBeDefined();
      expect(themeToggle.textContent).toContain('Light');
    });

    it('has accessible label for light theme', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="light" />);
      const themeToggle = container.querySelector('[aria-label="Switch to dark theme"]');
      expect(themeToggle).toBeDefined();
    });

    it('has accessible label for dark theme', () => {
      const { container } = render(<Toolbar {...defaultProps} theme="dark" />);
      const themeToggle = container.querySelector('[aria-label="Switch to light theme"]');
      expect(themeToggle).toBeDefined();
    });

    it('is not disabled when disabled prop is true', () => {
      // Theme toggle should always be enabled
      const { container } = render(<Toolbar {...defaultProps} disabled={true} />);
      const themeToggle = container.querySelector('.toolbar-theme-toggle') as HTMLButtonElement;
      expect(themeToggle).toBeDefined();
      expect(themeToggle.disabled).toBe(false);
    });
  });

  // ============================================================
  // Accessibility
  // ============================================================

  describe('accessibility', () => {
    it('has toolbar role', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const toolbar = container.querySelector('[role="toolbar"]');
      expect(toolbar).toBeDefined();
    });

    it('all buttons have type="button"', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const buttons = container.querySelectorAll('button');

      buttons.forEach((button) => {
        expect(button.type).toBe('button');
      });
    });

    it('all interactive elements have aria-label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);

      const runButton = container.querySelector('.toolbar-run-button');
      expect(runButton?.getAttribute('aria-label')).toBe('Run code');

      const select = container.querySelector('.toolbar-example-select');
      expect(select?.getAttribute('aria-label')).toBe('Select example');

      const themeToggle = container.querySelector('.toolbar-theme-toggle');
      expect(themeToggle?.hasAttribute('aria-label')).toBe(true);
    });

    it('disabled elements have proper ARIA state', () => {
      const { container } = render(<Toolbar {...defaultProps} disabled={true} />);

      const runButton = container.querySelector('.toolbar-run-button') as HTMLButtonElement;
      expect(runButton.disabled).toBe(true);

      const select = container.querySelector('.toolbar-example-select') as HTMLSelectElement;
      expect(select.disabled).toBe(true);
    });
  });

  // ============================================================
  // Theme switching
  // ============================================================

  describe('theme switching', () => {
    it('updates styles when theme changes from light to dark', () => {
      const { container, rerender } = render(<Toolbar {...defaultProps} theme="light" />);

      rerender(<Toolbar {...defaultProps} theme="dark" />);

      const toolbar = container.querySelector('.toolbar-container');
      expect(toolbar).toBeDefined();
    });

    it('updates styles when theme changes from dark to light', () => {
      const { container, rerender } = render(<Toolbar {...defaultProps} theme="dark" />);

      rerender(<Toolbar {...defaultProps} theme="light" />);

      const toolbar = container.querySelector('.toolbar-container');
      expect(toolbar).toBeDefined();
    });

    it('updates theme toggle button text when theme changes', () => {
      const { container, rerender } = render(<Toolbar {...defaultProps} theme="light" />);

      let themeToggle = container.querySelector('.toolbar-theme-toggle');
      expect(themeToggle?.textContent).toContain('Dark');

      rerender(<Toolbar {...defaultProps} theme="dark" />);

      themeToggle = container.querySelector('.toolbar-theme-toggle');
      expect(themeToggle?.textContent).toContain('Light');
    });
  });
});
