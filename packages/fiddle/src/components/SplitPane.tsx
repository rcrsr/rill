/**
 * SplitPane Component
 *
 * Resizable split pane layout with persistent state.
 * - Horizontal split (side-by-side) on desktop; vertical (stacked) on narrow viewports
 * - Draggable divider with neon highlight on hover/drag
 * - Minimum panel dimension: 200px
 * - Persists split ratio via callback on drag end
 * - Keyboard accessible (arrow keys to resize)
 */

import type React from 'react';
import { type JSX, useEffect, useRef, useState } from 'react';
import {
  MIN_PANEL_SIZE,
  DEFAULT_BREAKPOINT,
} from '../lib/constants.js';

// ============================================================
// TYPE DEFINITIONS
// ============================================================

/**
 * SplitPane component props
 */
export interface SplitPaneProps {
  /** Left/top panel content */
  left: React.ReactNode;
  /** Right/bottom panel content */
  right: React.ReactNode;
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

const DEFAULT_SPLIT_RATIO = 50;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function calculateBounds(containerSize: number): { min: number; max: number } {
  // Use reasonable default size for ARIA values when container not yet measured
  const effectiveSize = containerSize || 1000;
  const minRatio = (MIN_PANEL_SIZE / effectiveSize) * 100;
  const maxRatio = 100 - minRatio;
  return { min: minRatio, max: maxRatio };
}

function clampRatio(ratio: number, containerSize: number): number {
  const { min, max } = calculateBounds(containerSize);
  return Math.max(min, Math.min(max, ratio));
}

// ============================================================
// SPLIT PANE COMPONENT
// ============================================================

export function SplitPane({
  left,
  right,
  initialSplitRatio = DEFAULT_SPLIT_RATIO,
  onSplitChange,
  breakpoint = DEFAULT_BREAKPOINT,
}: SplitPaneProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(initialSplitRatio);
  const splitRatioRef = useRef(initialSplitRatio);
  const [isDragging, setIsDragging] = useState(false);
  const [isVertical, setIsVertical] = useState(false);
  const dragStartRef = useRef<{ ratio: number; pos: number } | null>(null);

  // ============================================================
  // SYNC SPLIT RATIO REF
  // ============================================================

  useEffect(() => {
    splitRatioRef.current = splitRatio;
  }, [splitRatio]);

  // ============================================================
  // RESPONSIVE ORIENTATION
  // ============================================================

  useEffect(() => {
    function handleResize() {
      const container = containerRef.current;
      if (!container) return;
      setIsVertical(container.clientWidth < breakpoint);
    }

    handleResize();
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
      setSplitRatio(clampRatio(newRatio, containerSize));
    }

    function handleDragEnd() {
      setIsDragging(false);
      dragStartRef.current = null;
      if (onSplitChange) {
        onSplitChange(splitRatioRef.current);
      }
    }

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    document.addEventListener('touchmove', handleDragMove);
    document.addEventListener('touchend', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
      document.removeEventListener('touchmove', handleDragMove);
      document.removeEventListener('touchend', handleDragEnd);
    };
  }, [isDragging, isVertical, onSplitChange]);

  // ============================================================
  // KEYBOARD NAVIGATION
  // ============================================================

  function handleKeyDown(event: React.KeyboardEvent) {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const containerSize = isVertical ? rect.height : rect.width;
    const step = 2;
    let newRatio = splitRatio;

    if (isVertical) {
      if (event.key === 'ArrowUp') {
        newRatio = splitRatio - step;
        event.preventDefault();
      } else if (event.key === 'ArrowDown') {
        newRatio = splitRatio + step;
        event.preventDefault();
      }
    } else {
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
      if (onSplitChange) {
        onSplitChange(clampedRatio);
      }
    }
  }

  // ============================================================
  // RENDER
  // ============================================================

  const leftSize = isVertical
    ? { width: '100%', height: `${splitRatio}%` }
    : { width: `${splitRatio}%`, height: '100%' };

  const rightSize = isVertical
    ? { width: '100%', height: `${100 - splitRatio}%` }
    : { width: `${100 - splitRatio}%`, height: '100%' };

  const containerSize = containerRef.current
    ? isVertical
      ? containerRef.current.clientHeight
      : containerRef.current.clientWidth
    : 0;
  const bounds = calculateBounds(containerSize);

  return (
    <div
      ref={containerRef}
      className={`split-pane${isVertical ? ' vertical' : ''}`}
    >
      <div className="split-pane-panel" style={leftSize}>
        {left}
      </div>

      <div
        role="separator"
        aria-orientation={isVertical ? 'horizontal' : 'vertical'}
        aria-valuenow={Math.round(splitRatio)}
        aria-valuemin={Math.round(bounds.min)}
        aria-valuemax={Math.round(bounds.max)}
        tabIndex={0}
        onMouseDown={handleDragStart}
        onTouchStart={handleDragStart}
        onKeyDown={handleKeyDown}
        className={`split-pane-divider${isDragging ? ' dragging' : ''}`}
      />

      <div className="split-pane-panel" style={rightSize}>
        {right}
      </div>
    </div>
  );
}
