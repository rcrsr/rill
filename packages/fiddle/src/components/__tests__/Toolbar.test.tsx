/**
 * Toolbar Component Tests
 *
 * Test coverage for Toolbar component:
 * - IC-12: Component renders without errors
 * - AC-6: Example selection triggers onExampleSelect callback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Toolbar, type ToolbarProps } from '../Toolbar.js';
import type { CodeExample } from '../../lib/examples.js';

describe('Toolbar', () => {
  let mockOnRun: ReturnType<typeof vi.fn<() => void>>;
  let mockOnExampleSelect: ReturnType<
    typeof vi.fn<(example: CodeExample) => void>
  >;
  let defaultProps: ToolbarProps;

  beforeEach(() => {
    mockOnRun = vi.fn<() => void>();
    mockOnExampleSelect = vi.fn<(example: CodeExample) => void>();
    defaultProps = {
      onRun: mockOnRun,
      onExampleSelect: mockOnExampleSelect,
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
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar).toBeDefined();
    });

    it('renders Run button', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const runButton = container.querySelector('.toolbar-run');
      expect(runButton).toBeDefined();
      expect(runButton?.textContent).toContain('Run');
    });

    it('renders example selector', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('.toolbar-select');
      expect(select).toBeDefined();
    });

    it('applies ARIA label to toolbar', () => {
      const { container } = render(
        <Toolbar {...defaultProps} ariaLabel="Test toolbar" />
      );
      const toolbar = container.querySelector(
        '[role="toolbar"][aria-label="Test toolbar"]'
      );
      expect(toolbar).toBeDefined();
    });

    it('uses default ARIA label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const toolbar = container.querySelector(
        '[role="toolbar"][aria-label="Toolbar"]'
      );
      expect(toolbar).toBeDefined();
    });

    it('renders with dark brand theme', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const toolbar = container.querySelector('.toolbar');
      expect(toolbar).toBeDefined();
    });

    it('logo is wrapped in an anchor tag with default href "/"', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const logoLink = container.querySelector(
        '.toolbar-logo-link'
      ) as HTMLAnchorElement;
      expect(logoLink).toBeDefined();
      expect(logoLink.href).toContain('/');

      const logo = logoLink.querySelector('.toolbar-logo');
      expect(logo).toBeDefined();
    });

    it('logoHref prop overrides the link destination', () => {
      const { container } = render(
        <Toolbar {...defaultProps} logoHref="/custom-path" />
      );
      const logoLink = container.querySelector(
        '.toolbar-logo-link'
      ) as HTMLAnchorElement;
      expect(logoLink).toBeDefined();
      expect(logoLink.href).toContain('/custom-path');
    });
  });

  // ============================================================
  // Run Button
  // ============================================================

  describe('Run button', () => {
    it('triggers onRun when clicked', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();

      fireEvent.click(runButton);
      expect(mockOnRun).toHaveBeenCalledTimes(1);
    });

    it('is disabled when disabled prop is true', () => {
      const { container } = render(
        <Toolbar {...defaultProps} disabled={true} />
      );
      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();
      expect(runButton.disabled).toBe(true);
    });

    it('is enabled when disabled prop is false', () => {
      const { container } = render(
        <Toolbar {...defaultProps} disabled={false} />
      );
      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton).toBeDefined();
      expect(runButton.disabled).toBe(false);
    });

    it('does not trigger onRun when disabled', () => {
      const { container } = render(
        <Toolbar {...defaultProps} disabled={true} />
      );
      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
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
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
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
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'variables' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('variables');
      expect(calledExample?.label).toBe('Variables');
    });

    it('loads pipes example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'pipes' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('pipes');
      expect(calledExample?.label).toBe('Pipes');
    });

    it('loads functions example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'functions' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('functions');
      expect(calledExample?.label).toBe('Functions');
    });

    it('loads conditionals example', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      fireEvent.change(select, { target: { value: 'conditionals' } });
      expect(mockOnExampleSelect).toHaveBeenCalledTimes(1);

      const calledExample = mockOnExampleSelect.mock.calls[0]?.[0];
      expect(calledExample?.id).toBe('conditionals');
      expect(calledExample?.label).toBe('Conditionals');
    });

    it('does not trigger onExampleSelect when empty option is selected', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;

      fireEvent.change(select, { target: { value: '' } });
      expect(mockOnExampleSelect).not.toHaveBeenCalled();
    });

    it('is disabled when disabled prop is true', () => {
      const { container } = render(
        <Toolbar {...defaultProps} disabled={true} />
      );
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      expect(select).toBeDefined();
      expect(select.disabled).toBe(true);
    });

    it('has accessible label', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector('[aria-label="Select code example"]');
      expect(select).toBeDefined();
    });

    it('renders all required examples', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      const options = Array.from(select.querySelectorAll('option'));

      // Filter out placeholder option
      const exampleOptions = options.filter((opt) => opt.value !== '');

      expect(exampleOptions).toHaveLength(17);
      expect(exampleOptions.map((opt) => opt.value)).toEqual([
        'hello-world',
        'variables',
        'pipes',
        'functions',
        'conditionals',
        'fold',
        'fizzbuzz',
        'dispatch',
        'closures',
        'collection-pipeline',
        'destructuring',
        'slicing',
        'type-checking',
        'string-processing',
        'dict-methods',
        'state-machine',
        'spread',
      ]);
    });

    it('renders placeholder option as default', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      const placeholder = select.querySelector(
        'option[value=""]'
      ) as HTMLOptionElement;

      expect(placeholder).toBeDefined();
      expect(placeholder?.textContent).toBe('Examples');
      expect(placeholder?.disabled).toBe(true);
    });
  });

  // ============================================================
  // Copy Link Button
  // ============================================================

  describe('Copy Link button', () => {
    it('not rendered when onCopyLink undefined', () => {
      const { container } = render(<Toolbar {...defaultProps} />);
      const shareButton = container.querySelector('.toolbar-share');
      expect(shareButton).toBeNull();
    });

    it('rendered when onCopyLink provided', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar {...defaultProps} onCopyLink={mockOnCopyLink} />
      );
      const shareButton = container.querySelector('.toolbar-share');
      expect(shareButton).toBeDefined();
    });

    it('triggers onCopyLink on click', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar {...defaultProps} onCopyLink={mockOnCopyLink} />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();

      fireEvent.click(shareButton);
      expect(mockOnCopyLink).toHaveBeenCalledTimes(1);
    });

    it('shows "Copied!" text when copyLinkState is copied', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar
          {...defaultProps}
          onCopyLink={mockOnCopyLink}
          copyLinkState="copied"
        />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();
      expect(shareButton.textContent).toContain('Copied!');
    });

    it('shows "Error" text when copyLinkState is error', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar
          {...defaultProps}
          onCopyLink={mockOnCopyLink}
          copyLinkState="error"
        />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();
      expect(shareButton.textContent).toContain('Error');
    });

    it('shows "Share" text when copyLinkState is idle', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar
          {...defaultProps}
          onCopyLink={mockOnCopyLink}
          copyLinkState="idle"
        />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();
      expect(shareButton.textContent).toContain('Share');
    });

    it('disabled when disabled prop is true', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar
          {...defaultProps}
          onCopyLink={mockOnCopyLink}
          disabled={true}
        />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();
      expect(shareButton.disabled).toBe(true);
    });

    it('has accessible ARIA label', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar {...defaultProps} onCopyLink={mockOnCopyLink} />
      );
      const shareButton = container.querySelector(
        '[aria-label="Copy shareable link"]'
      );
      expect(shareButton).toBeDefined();
    });

    it('does not trigger callback when disabled', () => {
      const mockOnCopyLink = vi.fn();
      const { container } = render(
        <Toolbar
          {...defaultProps}
          onCopyLink={mockOnCopyLink}
          disabled={true}
        />
      );
      const shareButton = container.querySelector(
        '.toolbar-share'
      ) as HTMLButtonElement;
      expect(shareButton).toBeDefined();

      fireEvent.click(shareButton);
      expect(mockOnCopyLink).not.toHaveBeenCalled();
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

      const runButton = container.querySelector('.toolbar-run');
      expect(runButton?.getAttribute('aria-label')).toBe('Run code');

      const select = container.querySelector('.toolbar-select');
      expect(select?.getAttribute('aria-label')).toBe('Select code example');
    });

    it('disabled elements have proper ARIA state', () => {
      const { container } = render(
        <Toolbar {...defaultProps} disabled={true} />
      );

      const runButton = container.querySelector(
        '.toolbar-run'
      ) as HTMLButtonElement;
      expect(runButton.disabled).toBe(true);

      const select = container.querySelector(
        '.toolbar-select'
      ) as HTMLSelectElement;
      expect(select.disabled).toBe(true);
    });
  });
});
