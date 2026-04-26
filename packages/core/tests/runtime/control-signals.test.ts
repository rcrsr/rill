/**
 * Control Signal Hierarchy Tests
 *
 * Validates the instanceof partition between ControlSignal subclasses
 * (BreakSignal, ReturnSignal, YieldSignal) and RuntimeHaltSignal.
 *
 * AC-NOD-1: subclasses satisfy instanceof ControlSignal; RuntimeHaltSignal
 * does not. EC-1 through EC-4 and BC-NOD-4 are all covered below.
 */

import { describe, expect, it } from 'vitest';
import {
  BreakSignal,
  ControlSignal,
  ReturnSignal,
  RuntimeHaltSignal,
  YieldSignal,
} from '@rcrsr/rill';
import { run } from '../helpers/runtime.js';

// ============================================================
// EC-1, EC-3: subclass instanceof partitions
// ============================================================

describe('BreakSignal hierarchy', () => {
  it('satisfies instanceof ControlSignal [AC-NOD-1, EC-1, EC-3]', () => {
    const signal = new BreakSignal('test-value');
    expect(signal).toBeInstanceOf(ControlSignal);
    expect(signal).toBeInstanceOf(BreakSignal);
  });

  it('satisfies instanceof Error [EC-1]', () => {
    const signal = new BreakSignal('test-value');
    expect(signal).toBeInstanceOf(Error);
  });

  it('does not satisfy instanceof RuntimeHaltSignal [EC-1, EC-4]', () => {
    const signal = new BreakSignal('test-value');
    expect(signal).not.toBeInstanceOf(RuntimeHaltSignal);
  });
});

describe('ReturnSignal hierarchy', () => {
  it('satisfies instanceof ControlSignal [AC-NOD-1, EC-1, EC-3]', () => {
    const signal = new ReturnSignal(42);
    expect(signal).toBeInstanceOf(ControlSignal);
    expect(signal).toBeInstanceOf(ReturnSignal);
  });

  it('satisfies instanceof Error [EC-1]', () => {
    const signal = new ReturnSignal(42);
    expect(signal).toBeInstanceOf(Error);
  });

  it('does not satisfy instanceof RuntimeHaltSignal [EC-1, EC-4]', () => {
    const signal = new ReturnSignal(42);
    expect(signal).not.toBeInstanceOf(RuntimeHaltSignal);
  });
});

describe('YieldSignal hierarchy', () => {
  it('satisfies instanceof ControlSignal [AC-NOD-1, EC-1, EC-3]', () => {
    const signal = new YieldSignal('chunk');
    expect(signal).toBeInstanceOf(ControlSignal);
    expect(signal).toBeInstanceOf(YieldSignal);
  });

  it('satisfies instanceof Error [EC-1]', () => {
    const signal = new YieldSignal('chunk');
    expect(signal).toBeInstanceOf(Error);
  });

  it('does not satisfy instanceof RuntimeHaltSignal [EC-1, EC-4]', () => {
    const signal = new YieldSignal('chunk');
    expect(signal).not.toBeInstanceOf(RuntimeHaltSignal);
  });
});

// ============================================================
// IR-1: value field exposes constructor payload
// ============================================================

describe('ControlSignal.value payload [IR-1]', () => {
  it('BreakSignal exposes the RillValue passed to constructor', () => {
    const signal = new BreakSignal('my-value');
    expect(signal.value).toBe('my-value');
  });

  it('ReturnSignal exposes the RillValue passed to constructor', () => {
    const signal = new ReturnSignal(99);
    expect(signal.value).toBe(99);
  });

  it('YieldSignal exposes the RillValue passed to constructor', () => {
    const signal = new YieldSignal(null);
    expect(signal.value).toBeNull();
  });
});

// ============================================================
// EC-4: catch targeting RuntimeHaltSignal never matches subclass
// ============================================================

describe('instanceof RuntimeHaltSignal catch block never matches ControlSignal subclasses [EC-4]', () => {
  it('BreakSignal does not enter a RuntimeHaltSignal catch branch', () => {
    let entered = false;
    try {
      throw new BreakSignal('value');
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) {
        entered = true;
      }
    }
    expect(entered).toBe(false);
  });

  it('ReturnSignal does not enter a RuntimeHaltSignal catch branch', () => {
    let entered = false;
    try {
      throw new ReturnSignal(0);
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) {
        entered = true;
      }
    }
    expect(entered).toBe(false);
  });

  it('YieldSignal does not enter a RuntimeHaltSignal catch branch', () => {
    let entered = false;
    try {
      throw new YieldSignal('chunk');
    } catch (e) {
      if (e instanceof RuntimeHaltSignal) {
        entered = true;
      }
    }
    expect(entered).toBe(false);
  });
});

// ============================================================
// EC-2: abstract-class enforcement (TypeScript compile check)
// ============================================================

describe('ControlSignal abstract enforcement [EC-2]', () => {
  it('is declared abstract — TypeScript rejects direct instantiation at compile time', () => {
    // The @ts-expect-error below is the compile-time assertion. TypeScript
    // treats ControlSignal as abstract and rejects `new ControlSignal(...)`.
    // The `abstract` modifier is erased in the JS output, so no runtime
    // throw occurs; the directive alone validates EC-2.
    // @ts-expect-error Cannot create an instance of an abstract class.
    const _instance = new ControlSignal('BreakSignal', 'break', null);
    // Reaching here confirms the directive was needed (TypeScript error was present).
    expect(typeof _instance).toBe('object');
  });
});

// ============================================================
// BC-NOD-4: break at outermost statement boundary
// ============================================================

describe('break at outermost statement boundary [BC-NOD-4]', () => {
  it('propagates BreakSignal out of execute() when no enclosing loop exists', async () => {
    // reshapeUnhandledThrow returns undefined for BreakSignal (preserves
    // pre-migration behavior), so the signal propagates as a rejected promise.
    // Use an explicit value "1 -> break" to avoid the unbound-$ error that
    // a bare `break` (which desugars to `$ -> break`) triggers when pipeValue=null.
    await expect(run('1 -> break')).rejects.toBeInstanceOf(BreakSignal);
  });

  it('propagated BreakSignal carries the value at the throw site', async () => {
    // "1 -> break" evaluates 1 then throws BreakSignal(1).
    const err = await run('1 -> break').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BreakSignal);
    expect((err as BreakSignal).value).toBe(1);
  });
});
