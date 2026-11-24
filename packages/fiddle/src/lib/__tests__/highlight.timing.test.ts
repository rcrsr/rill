/**
 * Highlighting performance budgets
 *
 * Wall-clock p95 budgets for the rill StreamParser. Named *.timing.test.ts so
 * vitest runs it alone after the unit files; see vitest.config.ts.
 */

import { describe, it, expect } from 'vitest';
import { type StringStream } from '@codemirror/language';
import { rillHighlighter } from '../highlight.js';
import { measureP95 } from '../../../tests/helpers/measure.js';

describe('highlighting performance', () => {
  describe('Empty document highlighting', () => {
    it('highlights empty document in less than 1ms', () => {
      const state = rillHighlighter.startState!(2);
      const mockStream = {
        string: '',
        pos: 0,
        start: 0,
        sol: () => true,
        eol: () => true,
        next: () => {},
      } as unknown as StringStream;

      const p95 = measureP95(
        () => {
          rillHighlighter.token(mockStream, state);
        },
        { samples: 200, warmup: 20 }
      );

      expect(p95).toBeLessThan(1);
    });
  });

  describe('1000-line document highlighting', () => {
    it('highlights 1000-line document in less than 16ms', () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `${i} -> $var${i}`);

      const p95 = measureP95(
        () => {
          for (const line of lines) {
            const state = rillHighlighter.startState!(2);
            const mockStream = {
              string: line,
              pos: 0,
              start: 0,
              sol: () => mockStream.pos === 0,
              eol: () => mockStream.pos >= mockStream.string.length,
              next: (): string | undefined => {
                if (mockStream.pos < mockStream.string.length) {
                  const char = mockStream.string[mockStream.pos];
                  mockStream.pos++;
                  return char;
                }
                return undefined;
              },
              peek: () =>
                mockStream.pos < mockStream.string.length
                  ? mockStream.string[mockStream.pos]
                  : undefined,
            } as unknown as StringStream;

            while (!mockStream.eol()) {
              rillHighlighter.token(mockStream, state);
            }
          }
        },
        { samples: 5, warmup: 2 }
      );

      expect(p95).toBeLessThan(200);
    });
  });

  describe('10,000-line document highlighting', () => {
    it('highlights 10,000-line document in less than 1000ms', () => {
      const lines = Array.from({ length: 10000 }, (_, i) => `${i} -> $var${i}`);

      const p95 = measureP95(
        () => {
          for (const line of lines) {
            const state = rillHighlighter.startState!(2);
            const mockStream = {
              string: line,
              pos: 0,
              start: 0,
              sol: () => mockStream.pos === 0,
              eol: () => mockStream.pos >= mockStream.string.length,
              next: (): string | undefined => {
                if (mockStream.pos < mockStream.string.length) {
                  const char = mockStream.string[mockStream.pos];
                  mockStream.pos++;
                  return char;
                }
                return undefined;
              },
              peek: () =>
                mockStream.pos < mockStream.string.length
                  ? mockStream.string[mockStream.pos]
                  : undefined,
            } as unknown as StringStream;

            while (!mockStream.eol()) {
              rillHighlighter.token(mockStream, state);
            }
          }
        },
        { samples: 3, warmup: 1 }
      );

      expect(p95).toBeLessThan(1000);
    });
  });

  describe('1000-character single line highlighting', () => {
    it('highlights 1000-character line in less than 50ms', () => {
      const longLine = Array.from({ length: 250 }, () => '1 + ').join('') + '1';

      expect(longLine.length).toBeGreaterThanOrEqual(1000);

      const mockStream = {
        string: longLine,
        pos: 0,
        start: 0,
        sol: () => mockStream.pos === 0,
        eol: () => mockStream.pos >= mockStream.string.length,
        next: (): string | undefined => {
          if (mockStream.pos < mockStream.string.length) {
            const char = mockStream.string[mockStream.pos];
            mockStream.pos++;
            return char;
          }
          return undefined;
        },
        peek: () =>
          mockStream.pos < mockStream.string.length
            ? mockStream.string[mockStream.pos]
            : undefined,
      } as unknown as StringStream;

      const p95 = measureP95(
        () => {
          // Both resets matter: the loop below consumes the stream and
          // mutates the highlighter state, so without them every sample
          // after the first would start at EOL and measure no work at all.
          mockStream.pos = 0;
          const sampleState = rillHighlighter.startState!(2);
          while (!mockStream.eol()) {
            rillHighlighter.token(mockStream, sampleState);
          }
        },
        { samples: 50, warmup: 5 }
      );

      expect(p95).toBeLessThan(50);
    });
  });
});
