/**
 * Editor render performance budget
 *
 * Wall-clock p95 budget for mounting the Editor on a large document. Named
 * *.timing.test.tsx so vitest runs it alone after the unit files; see
 * vitest.config.ts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Editor, type EditorProps } from '../Editor.js';
import { measureP95 } from '../../../tests/helpers/measure.js';

describe('Editor performance', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps: EditorProps = {
    value: '',
    onChange: vi.fn<(value: string) => void>(),
    onRun: vi.fn<() => void>(),
  };

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
});
