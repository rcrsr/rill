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
    it('renders two panels separated by a divider', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const splitPane = container.querySelector('.split-pane');
      expect(splitPane).not.toBeNull();
      expect(splitPane?.querySelectorAll('.split-pane-panel')).toHaveLength(2);
      const divider = splitPane?.querySelector('[role="separator"]');
      expect(divider?.classList.contains('split-pane-divider')).toBe(true);
    });

    it('renders left panel content in the first panel', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const panels = container.querySelectorAll('.split-pane-panel');
      expect(panels[0]?.textContent).toBe('Left Panel');
    });

    it('renders right panel content in the second panel', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const panels = container.querySelectorAll('.split-pane-panel');
      expect(panels[1]?.textContent).toBe('Right Panel');
    });

    it('renders divider with default ARIA values for an unmeasured container', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');
      // An unmeasured container is narrower than the breakpoint (stacked
      // layout), so the separator itself is horizontal; bounds use the
      // hard-coded 1000px fallback size.
      expect(divider?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(divider?.getAttribute('aria-valuenow')).toBe('50');
      expect(divider?.getAttribute('aria-valuemin')).toBe('20');
      expect(divider?.getAttribute('aria-valuemax')).toBe('80');
      expect(divider?.getAttribute('tabindex')).toBe('0');
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
  // Divider enforces 200px minimum panel size
  // ============================================================

  describe('minimum panel size enforcement', () => {
    it('reports 20/80 bounds for an unmeasured container', () => {
      const { container } = render(<SplitPane {...defaultProps} />);
      const divider = container.querySelector('[role="separator"]');
      expect(divider?.getAttribute('aria-valuemin')).toBe('20');
      expect(divider?.getAttribute('aria-valuemax')).toBe('80');
    });

    it('clamps an initial ratio below the minimum on mount', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={10}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      expect(divider.getAttribute('aria-valuenow')).toBe('20');
      expect(onSplitChange).not.toHaveBeenCalled();
    });

    it('clamps an initial ratio above the maximum on mount', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane
          {...defaultProps}
          initialSplitRatio={95}
          onSplitChange={onSplitChange}
        />
      );
      const divider = container.querySelector(
        '[role="separator"]'
      ) as HTMLElement;

      expect(divider.getAttribute('aria-valuenow')).toBe('80');
      expect(onSplitChange).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Responsive Orientation
  // ============================================================

  describe('responsive orientation', () => {
    function withContainerWidth(width: number, run: () => void): void {
      const spy = vi
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockReturnValue(width);
      try {
        run();
      } finally {
        spy.mockRestore();
      }
    }

    it('uses the side-by-side layout when the container is wider than the default breakpoint', () => {
      withContainerWidth(900, () => {
        const { container } = render(<SplitPane {...defaultProps} />);
        const divider = container.querySelector('[role="separator"]');
        expect(divider?.getAttribute('aria-orientation')).toBe('vertical');
        expect(
          container.querySelector('.split-pane')?.classList.contains('vertical')
        ).toBe(false);
      });
    });

    it('uses the stacked layout when the container is narrower than a custom breakpoint', () => {
      withContainerWidth(900, () => {
        const { container } = render(
          <SplitPane {...defaultProps} breakpoint={1024} />
        );
        const divider = container.querySelector('[role="separator"]');
        expect(divider?.getAttribute('aria-orientation')).toBe('horizontal');
        expect(
          container.querySelector('.split-pane')?.classList.contains('vertical')
        ).toBe(true);
      });
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

    it('divider has aria-valuenow for current split ratio', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={60} />
      );
      const divider = container.querySelector('[role="separator"]');

      expect(divider?.getAttribute('aria-valuenow')).toBe('60');
    });
  });

  // ============================================================
  // Panel Styling
  // ============================================================

  describe('panel styling', () => {
    it('applies split ratio to panel heights in the stacked layout', () => {
      const { container } = render(
        <SplitPane {...defaultProps} initialSplitRatio={60} />
      );

      const panels = container.querySelectorAll(
        '.split-pane-panel'
      ) as NodeListOf<HTMLElement>;

      expect(panels).toHaveLength(2);
      expect(panels[0]?.style.height).toBe('60%');
      expect(panels[1]?.style.height).toBe('40%');
      expect(panels[0]?.style.width).toBe('100%');
      expect(panels[1]?.style.width).toBe('100%');
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
      // Each press is its own update so the handler sees the latest ratio.
      for (let i = 0; i < 30; i++) {
        fireEvent.keyDown(divider, { key: 'ArrowUp' });
      }

      const calls = onSplitChange.mock.calls;
      expect(calls[calls.length - 1]![0]).toBe(20);
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
      // Each press is its own update so the handler sees the latest ratio.
      for (let i = 0; i < 30; i++) {
        fireEvent.keyDown(divider, { key: 'ArrowDown' });
      }

      const calls = onSplitChange.mock.calls;
      expect(calls[calls.length - 1]![0]).toBe(80);
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

    it('dragging the divider moves the ratio and reports it on mouse up', () => {
      const onSplitChange = vi.fn();
      const { container } = render(
        <SplitPane {...defaultProps} onSplitChange={onSplitChange} />
      );
      const splitPane = container.querySelector('.split-pane') as HTMLElement;
      const divider = container.querySelector(
        '.split-pane-divider'
      ) as HTMLElement;
      splitPane.getBoundingClientRect = () =>
        ({
          top: 0,
          left: 0,
          width: 1000,
          height: 1000,
          right: 1000,
          bottom: 1000,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;

      act(() => {
        fireEvent.mouseDown(divider, { clientX: 0, clientY: 100 });
      });
      act(() => {
        fireEvent.mouseMove(document, { clientX: 0, clientY: 300 });
      });
      act(() => {
        fireEvent.mouseUp(document);
      });

      expect(onSplitChange).toHaveBeenCalledTimes(1);
      expect(onSplitChange).toHaveBeenCalledWith(70);
      expect(divider.getAttribute('aria-valuenow')).toBe('70');
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
