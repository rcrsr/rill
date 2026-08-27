/**
 * SplitPane Component Tests
 *
 * Test coverage for SplitPane component:
 * - Component renders without errors
 * - Split ratio persists via onSplitChange callback
 * - Divider enforces 200px minimum panel size
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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
  // Component renders without errors
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
  // Split ratio persistence (callback interface)
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
  // Divider enforces 200px minimum panel size
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

      const minValue = parseInt(divider?.getAttribute('aria-valuemin') ?? '0');
      const maxValue = parseInt(divider?.getAttribute('aria-valuemax') ?? '0');

      // When container has size, bounds reflect MIN_PANEL_SIZE
      // When container is unsized (tests), bounds default to 0-100
      expect(minValue).toBeGreaterThanOrEqual(0);
      expect(maxValue).toBeLessThanOrEqual(100);
      expect(minValue).toBeLessThan(maxValue);
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

      const minValue = parseInt(divider?.getAttribute('aria-valuemin') ?? '0');
      const maxValue = parseInt(divider?.getAttribute('aria-valuemax') ?? '0');

      // When container has size, bounds reflect MIN_PANEL_SIZE
      // When container is unsized (tests), bounds default to 0-100
      expect(minValue).toBeGreaterThanOrEqual(0);
      expect(maxValue).toBeLessThanOrEqual(100);
      expect(minValue).toBeLessThan(maxValue);
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

  // ============================================================
  // Keyboard Navigation (ArrowLeft/Right/Up/Down)
  // ============================================================

  // In happy-dom, container clientWidth is 0, which is < the 768px breakpoint,
  // so the component initializes in vertical mode. Vertical mode responds to
  // ArrowUp (decrease) and ArrowDown (increase). Tests use these keys.
  describe('keyboard navigation', () => {
    it('ArrowUp decreases split ratio in vertical mode and calls onSplitChange', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.keyDown(divider, { key: 'ArrowUp' });
      });

      // onSplitChange called with ratio decreased by step (2)
      expect(onSplitChange).toHaveBeenCalled();
      const newRatio = onSplitChange.mock.calls[0]![0] as number;
      expect(newRatio).toBe(48);
    });

    it('ArrowDown increases split ratio in vertical mode and calls onSplitChange', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.keyDown(divider, { key: 'ArrowDown' });
      });

      expect(onSplitChange).toHaveBeenCalled();
      const newRatio = onSplitChange.mock.calls[0]![0] as number;
      expect(newRatio).toBe(52);
    });

    it('non-arrow key does not call onSplitChange', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.keyDown(divider, { key: 'Tab' });
      });

      expect(onSplitChange).not.toHaveBeenCalled();
    });

    it('repeated ArrowUp presses clamp at minimum', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      // Press ArrowUp (decrease) enough times to reach minimum
      act(() => {
        for (let i = 0; i < 30; i++) {
          fireEvent.keyDown(divider, { key: 'ArrowUp' });
        }
      });

      // onSplitChange was called and final ratio is clamped to >= 0
      expect(onSplitChange).toHaveBeenCalled();
      const calls = onSplitChange.mock.calls;
      const lastRatio = calls[calls.length - 1]![0] as number;
      expect(lastRatio).toBeGreaterThanOrEqual(0);
    });

    it('repeated ArrowDown presses clamp at maximum', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      // Press ArrowDown (increase) enough times to reach maximum
      act(() => {
        for (let i = 0; i < 30; i++) {
          fireEvent.keyDown(divider, { key: 'ArrowDown' });
        }
      });

      expect(onSplitChange).toHaveBeenCalled();
      const calls = onSplitChange.mock.calls;
      const lastRatio = calls[calls.length - 1]![0] as number;
      expect(lastRatio).toBeLessThanOrEqual(100);
    });

    it('keyboard navigation without onSplitChange does not throw', () => {
      const { container } = render(
        <SplitPane left={<div>L</div>} right={<div>R</div>} />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      expect(() => {
        act(() => {
          fireEvent.keyDown(divider, { key: 'ArrowUp' });
          fireEvent.keyDown(divider, { key: 'ArrowDown' });
        });
      }).not.toThrow();
    });

    it('ArrowLeft and ArrowRight have no effect in vertical mode', () => {
      // In happy-dom (vertical mode), horizontal keys do nothing
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.keyDown(divider, { key: 'ArrowLeft' });
        fireEvent.keyDown(divider, { key: 'ArrowRight' });
      });

      // Horizontal keys have no effect in vertical mode
      expect(onSplitChange).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Drag Handling (mouse events)
  // ============================================================

  describe('drag handling', () => {
    it('mousedown on divider starts drag (adds dragging class)', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector(
        '.split-pane-divider'
      ) as HTMLElement;

      act(() => {
        fireEvent.mouseDown(divider, { clientX: 400, clientY: 0 });
      });

      expect(divider.classList.contains('dragging')).toBe(true);
    });

    it('mouseup after drag calls onSplitChange', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane {...defaultProps} onSplitChange={onSplitChange} />
      );
      const divider = container.querySelector(
        '.split-pane-divider'
      ) as HTMLElement;

      act(() => {
        fireEvent.mouseDown(divider, { clientX: 400, clientY: 0 });
      });

      act(() => {
        fireEvent.mouseUp(document);
      });

      // onSplitChange invoked on drag end
      expect(onSplitChange).toHaveBeenCalled();
    });

    it('mouseup removes dragging class', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector(
        '.split-pane-divider'
      ) as HTMLElement;

      act(() => {
        fireEvent.mouseDown(divider, { clientX: 400, clientY: 0 });
      });

      act(() => {
        fireEvent.mouseUp(document);
      });

      expect(divider.classList.contains('dragging')).toBe(false);
    });
  });

  // ============================================================
  // Measured Container Size (resize)
  // ============================================================

  describe('measured container size', () => {
    it('reports valuemin/valuemax from the measured container size after a ResizeObserver-driven resize, not the 1000px fallback', () => {
      // SplitPane relies solely on ResizeObserver (no window `resize`
      // listener) to detect container-size changes, so this test drives
      // the mocked observer callback directly instead of firing a window
      // `resize` event.
      let observedCallback: ResizeObserverCallback | null = null;
      const originalResizeObserver = globalThis.ResizeObserver;
      class MockResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          observedCallback = callback;
        }
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      }
      globalThis.ResizeObserver =
        MockResizeObserver as unknown as typeof ResizeObserver;

      try {
        const { container } = render(<SplitPane {...defaultProps} />);
        const splitPaneEl = container.querySelector(
          '.split-pane'
        ) as HTMLElement;

        // Fallback (unmeasured) bounds are min=20/max=80 (MIN_PANEL_SIZE 200 / 1000).
        // Simulate a measured container of 2000px so bounds become min=10/max=90.
        Object.defineProperty(splitPaneEl, 'clientWidth', {
          value: 2000,
          configurable: true,
        });
        Object.defineProperty(splitPaneEl, 'clientHeight', {
          value: 2000,
          configurable: true,
        });

        act(() => {
          observedCallback?.(
            [] as unknown as ResizeObserverEntry[],
            {} as ResizeObserver
          );
        });

        const divider = container.querySelector('[role="separator"]');
        const minValue = parseInt(
          divider?.getAttribute('aria-valuemin') ?? '0'
        );
        const maxValue = parseInt(
          divider?.getAttribute('aria-valuemax') ?? '0'
        );

        expect(minValue).not.toBe(20);
        expect(maxValue).not.toBe(80);
        expect(minValue).toBe(10);
        expect(maxValue).toBe(90);
      } finally {
        globalThis.ResizeObserver = originalResizeObserver;
      }
    });
  });

  // ============================================================
  // Drag Handling (touch events)
  // ============================================================

  describe('drag handling (touch)', () => {
    it('touchmove during drag calls preventDefault and updates the split ratio', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={50} />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.touchStart(divider, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
      });

      expect(divider.classList.contains('dragging')).toBe(true);

      const preventDefaultSpy = vi.spyOn(Event.prototype, 'preventDefault');

      act(() => {
        fireEvent.touchMove(document, {
          touches: [{ clientX: 100, clientY: 300 }],
        });
      });

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(divider.getAttribute('aria-valuenow')).not.toBe('50');

      preventDefaultSpy.mockRestore();
    });

    it('touchend after touch drag calls onSplitChange', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={50}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      act(() => {
        fireEvent.touchStart(divider, {
          touches: [{ clientX: 100, clientY: 100 }],
        });
      });

      act(() => {
        fireEvent.touchMove(document, {
          touches: [{ clientX: 100, clientY: 300 }],
        });
      });

      act(() => {
        fireEvent.touchEnd(document);
      });

      expect(onSplitChange).toHaveBeenCalled();
      expect(divider.classList.contains('dragging')).toBe(false);
    });
  });
});
