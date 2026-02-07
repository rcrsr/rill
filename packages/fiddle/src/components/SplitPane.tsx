/**
 * SplitPane Component
 *
 * Resizable split pane layout with persistent state.
 * - Horizontal split (side-by-side) on desktop; vertical (stacked) on narrow viewports
 * - Draggable divider with mouse; keyboard accessible
 * - Minimum panel dimension: 200px
 * - Persists split ratio via persistEditorState on drag end
 * - Loads initial ratio from loadEditorState
 */

import type React from 'react';
import { type JSX, useEffect, useRef, useState } from 'react';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * Theme variant for split pane styling
 */
export type SplitPaneTheme = 'light' | 'dark';

/**
 * SplitPane component props
 */
export interface SplitPaneProps {
  /** Left/top panel content */
  left: React.ReactNode;
  /** Right/bottom panel content */
  right: React.ReactNode;
  /** Theme variant */
  theme?: SplitPaneTheme;
  /** Initial split ratio (0-100 percentage) */
  initialSplitRatio?: number;
  /** Callback when split ratio changes (for persistence) */
  onSplitChange?: ((ratio: number) => void) | undefined;
  /** Viewport width threshold for orientation switch (default: 768px) */
  breakpoint?: number;
}

// ============================================================
// CONSTANTS
// ============================================================

const MIN_PANEL_SIZE = 200; // Minimum panel dimension in pixels (AC-20)
const DEFAULT_SPLIT_RATIO = 50; // Default split ratio percentage
const DEFAULT_BREAKPOINT = 768; // Default breakpoint for vertical layout

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Calculate valid split ratio bounds based on container size
 */
function calculateBounds(containerSize: number): { min: number; max: number } {
  const minRatio = (MIN_PANEL_SIZE / containerSize) * 100;
  const maxRatio = 100 - minRatio;
  return { min: minRatio, max: maxRatio };
}

/**
 * Clamp split ratio to valid bounds
 */
function clampRatio(ratio: number, containerSize: number): number {
  const { min, max } = calculateBounds(containerSize);
  return Math.max(min, Math.min(max, ratio));
}

// ============================================================
// SPLIT PANE COMPONENT
// ============================================================

/**
 * SplitPane component with resizable divider
 *
 * Features:
 * - Responsive orientation (horizontal on desktop, vertical on mobile)
 * - Draggable divider with minimum panel size enforcement
 * - Keyboard accessibility (arrow keys to resize)
 * - Persistent split ratio via callback
 * - Dark/light theme support
 */
export function SplitPane({
  left,
  right,
  theme = 'light',
  initialSplitRatio = DEFAULT_SPLIT_RATIO,
  onSplitChange,
  breakpoint = DEFAULT_BREAKPOINT,
}: SplitPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(initialSplitRatio);
  const [isDragging, setIsDragging] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const dragStartRef = useRef<{ ratio: number; pos: number } | null>(null);

  // ============================================================
  // RESPONSIVE ORIENTATION
  // ============================================================

  useEffect(() => {
    function handleResize() {
      const container = containerRef.current;
      if (!container) return;

      const width = container.clientWidth;
      setIsVertical(width < breakpoint);
    }

    // Initial check
    handleResize();

    // Listen for resize
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);

  // ============================================================
  // DRAG HANDLING
  // ============================================================

  function handleDragStart(event: React.MouseEvent | React.TouchEvent) {
    event.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const pos =
      'touches' in event
        ? isVertical
          ? event.touches[0]!.clientY - rect.top
          : event.touches[0]!.clientX - rect.left
        : isVertical
          ? event.clientY - rect.top
          : event.clientX - rect.left;

    dragStartRef.current = { ratio: splitRatio, pos };
    setIsDragging(true);
  }

  useEffect(() => {
    if (!isDragging) return;

    function handleDragMove(event: MouseEvent | TouchEvent) {
      const container = containerRef.current;
      if (!container || !dragStartRef.current) return;

      const rect = container.getBoundingClientRect();
      const containerSize = isVertical ? rect.height : rect.width;
      const currentPos =
        event instanceof MouseEvent
          ? isVertical
            ? event.clientY - rect.top
            : event.clientX - rect.left
          : isVertical
            ? event.touches[0]!.clientY - rect.top
            : event.touches[0]!.clientX - rect.left;

      const delta = currentPos - dragStartRef.current.pos;
      const deltaRatio = (delta / containerSize) * 100;
      const newRatio = dragStartRef.current.ratio + deltaRatio;

      // Clamp to valid bounds
      const clampedRatio = clampRatio(newRatio, containerSize);
      setSplitRatio(clampedRatio);
    }

    function handleDragEnd() {
      setIsDragging(false);
      dragStartRef.current = null;

      // Persist split ratio on drag end (AC-8)
      if (onSplitChange) {
        onSplitChange(splitRatio);
      }
    }

    // Mouse events
    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    // Touch events
    document.addEventListener('touchmove', handleDragMove);
    document.addEventListener('touchend', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, splitRatio, isVertical, onSplitChange]);

  // ============================================================
  // KEYBOARD NAVIGATION
  // ============================================================

  function handleKeyDown(event: React.KeyboardEvent) {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerSize = isVertical ? rect.height : rect.width;
    const step = 2; // 2% adjustment per key press

    let newRatio = splitRatio;

    if (isVertical) {
      // Vertical layout: Up/Down arrows
      if (event.key === 'ArrowUp') {
        newRatio = splitRatio - step;
        event.preventDefault();
      } else if (event.key === 'ArrowDown') {
        newRatio = splitRatio + step;
        event.preventDefault();
      }
    } else {
      // Horizontal layout: Left/Right arrows
      if (event.key === 'ArrowLeft') {
        newRatio = splitRatio - step;
        event.preventDefault();
      } else if (event.key === 'ArrowRight') {
        newRatio = splitRatio + step;
        event.preventDefault();
      }
    }

    if (newRatio !== splitRatio) {
      const clampedRatio = clampRatio(newRatio, containerSize);
      setSplitRatio(clampedRatio);

      // Persist on keyboard adjustment
      if (onSplitChange) {
        onSplitChange(clampedRatio);
      }
    }
  }

  // ============================================================
  // STYLES
  // ============================================================

  const dividerStyle: React.CSSProperties = {
    position: 'relative',
    backgroundColor: theme === 'light' ? '#e5e7eb' : '#374151',
    cursor: isVertical ? 'ns-resize' : 'ew-resize',
    flexShrink: 0,
    ...(isVertical
      ? { width: '100%', height: '8px' }
      : { width: '8px', height: '100%' }),
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isVertical ? 'column' : 'row',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  };

  const leftPanelStyle: React.CSSProperties = {
    overflow: 'auto',
    ...(isVertical
      ? { width: '100%', height: `${splitRatio}%` }
      : { width: `${splitRatio}%`, height: '100%' }),
  };

  const rightPanelStyle: React.CSSProperties = {
    overflow: 'auto',
    ...(isVertical
      ? { width: '100%', height: `${100 - splitRatio}%` }
      : { width: `${100 - splitRatio}%`, height: '100%' }),
  };

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div ref={containerRef} style={containerStyle} className="split-pane-container">
      <div style={leftPanelStyle} className="split-pane-left">
        {left}
      </div>

      <div
        role="separator"
        aria-orientation={isVertical ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(splitRatio)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onKeyDown={handleKeyDown}
        style={dividerStyle}
        className={`split-pane-divider ${isDragging ? 'dragging' : ''}`}
      />

      <div style={rightPanelStyle} className="split-pane-right">
        {right}
      </div>
    </div>
  );
}
