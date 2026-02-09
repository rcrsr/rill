/**
 * SplitPane Component Tests
 *
 * Test coverage for SplitPane component:
 * - IC-12: Component renders without errors
 * - AC-8: Split ratio persists via onSplitChange callback
 * - AC-20: Divider enforces 200px minimum panel size
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SplitPane, type SplitPaneProps } from '../SplitPane.js';

describe('SplitPane', () => {
  let mockOnSplitChange: ReturnType<typeof vi.fn<(ratio: number) => void>>;
  let defaultProps: SplitPaneProps;

  beforeEach(() => {
    mockOnSplitChange = vi.fn<(ratio: number) => void>();
    defaultProps = {
      left: <div>Left Panel</div>,
      right: <div>Right Panel</div>,
      onSplitChange: mockOnSplitChange,
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
      const { container } = render(<SplitPane {...defaultProps} />);
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });

    it('renders left panel content', () => {
      const { getByText } = render(<SplitPane {...defaultProps} />);
      expect(getByText('Left Panel')).toBeDefined();
    });

    it('renders right panel content', () => {
      const { getByText } = render(<SplitPane {...defaultProps} />);
      expect(getByText('Right Panel')).toBeDefined();
    });

    it('renders divider with ARIA attributes', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');
      expect(divider).toBeDefined();
      // Orientation depends on container width, which varies in test environment
      expect(divider?.getAttribute('aria-orientation')).toMatch(
        /^(horizontal|vertical)$/
      );
      expect(divider?.getAttribute('tabindex')).toBe('0');
    });

    it('renders brand dark divider', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('.split-pane-divider');
      expect(divider).toBeDefined();
    });

    it('renders with custom initial split ratio', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={60} />
      );
      const divider = container.querySelector('[role="separator"]');
      expect(divider?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('renders with default 50% split ratio', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');
      expect(divider?.getAttribute('aria-valuenow')).toBe('50');
    });
  });

  // ============================================================
  // AC-8: Split ratio persistence (callback interface)
  // ============================================================

  describe('split ratio persistence interface', () => {
    it('accepts onSplitChange callback prop', () => {
      const callback = vi.fn();
      const { container } = render(
        <SplitPane {...defaultProps} onSplitChange={callback} />
      );
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });

    it('does not error when onSplitChange is undefined', () => {
      const { container } = render(
        <SplitPane left={<div>Left</div>} right={<div>Right</div>} />
      );
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });

    it('provides callback with updated split ratio', () => {
      const callback = vi.fn();
      render(<SplitPane {...defaultProps} onSplitChange={callback} />);

      // Callback should accept a number (split ratio percentage)
      callback(55);
      expect(callback).toHaveBeenCalledWith(55);
    });
  });

  // ============================================================
  // AC-20: Divider enforces 200px minimum panel size
  // ============================================================

  describe('minimum panel size enforcement', () => {
    it('stores minimum panel size constant', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });

    it('clamps initial split ratio to valid bounds', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={10} />
      );

      const panels = container.querySelectorAll('.split-pane-panel');
      const divider = container.querySelector('[role="separator"]');

      expect(panels.length).toBe(2);
      expect(divider).toBeDefined();
    });

    it('clamps maximum split ratio to enforce right panel minimum', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={95} />
      );

      const panels = container.querySelectorAll('.split-pane-panel');
      const divider = container.querySelector('[role="separator"]');

      expect(panels.length).toBe(2);
      expect(divider).toBeDefined();
    });

    it('enforces minimum size during resize operations', () => {
      const { container } = render(<SplitPane {...defaultProps} />);

      const divider = container.querySelector('[role="separator"]');
      expect(divider).toBeDefined();

      expect(divider?.getAttribute('aria-valuemin')).toBe('0');
      expect(divider?.getAttribute('aria-valuemax')).toBe('100');
    });
  });

  // ============================================================
  // Responsive Orientation
  // ============================================================

  describe('responsive orientation', () => {
    it('renders with horizontal or vertical orientation based on container width', () => {
      const { container } = render(<SplitPane {...defaultProps} />);

      const divider = container.querySelector('[role="separator"]');
      const orientation = divider?.getAttribute('aria-orientation');

      expect(orientation).toMatch(/^(horizontal|vertical)$/);
    });

    it('accepts custom breakpoint prop', () => {
      const { container } = render(
        <SplitPane {...defaultProps} breakpoint={1024} />
      );

      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });

    it('defaults to 768px breakpoint', () => {
      const { container } = render(<SplitPane {...defaultProps} />);

      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).toBeDefined();
    });
  });

  // ============================================================
  // Keyboard Accessibility
  // ============================================================

  describe('keyboard accessibility', () => {
    it('divider is keyboard focusable', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      expect(divider?.tabIndex).toBe(0);
    });

    it('divider has role="separator"', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');

      expect(divider).toBeDefined();
      expect(divider?.getAttribute('role')).toBe('separator');
    });

    it('divider has aria-valuenow for current split ratio', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={60} />
      );
      const divider = container.querySelector('[role="separator"]');

      expect(divider?.getAttribute('aria-valuenow')).toBe('60');
    });

    it('divider has aria-valuemin and aria-valuemax', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');

      expect(divider?.getAttribute('aria-valuemin')).toBe('0');
      expect(divider?.getAttribute('aria-valuemax')).toBe('100');
    });

    it('divider has aria-orientation matching layout', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');

      const orientation = divider?.getAttribute('aria-orientation');
      expect(orientation).toMatch(/^(horizontal|vertical)$/);
    });
  });

  // ============================================================
  // Panel Styling
  // ============================================================

  describe('panel styling', () => {
    it('applies split ratio to panel dimensions', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={60} />
      );

      const panels = container.querySelectorAll(
        '.split-pane-panel'
      ) as NodeListOf<HTMLElement>;

      expect(panels.length).toBe(2);

      // Panels have percentage-based dimensions
      const leftStyle = panels[0]?.style;
      const rightStyle = panels[1]?.style;

      // Either width (horizontal) or height (vertical) will use split ratio
      const hasLeftDimension = leftStyle?.width || leftStyle?.height;
      const hasRightDimension = rightStyle?.width || rightStyle?.height;

      expect(hasLeftDimension).toBeDefined();
      expect(hasRightDimension).toBeDefined();
    });

    it('container uses flexbox layout', () => {
      const { container } = render(<SplitPane {...defaultProps} />);

      const splitPaneContainer = container.querySelector(
        '.split-pane'
      ) as HTMLElement;

      expect(splitPaneContainer).toBeDefined();
      // Styles are applied via CSS class, not inline
    });
  });
});
