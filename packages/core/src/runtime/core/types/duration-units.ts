/**
 * Duration Unit Table
 *
 * Single source of truth for duration components: names, text suffixes,
 * target fields, and factors. Constructor, decomposition properties, text
 * printer, and text parser all read this table.
 * Allowed imports: none (pure module).
 */

// ============================================================
// TYPES
// ============================================================

type DurationUnitName =
  | 'years'
  | 'months'
  | 'days'
  | 'hours'
  | 'minutes'
  | 'seconds'
  | 'ms';

export interface DurationUnit {
  readonly name: DurationUnitName;
  readonly suffix: string;
  readonly field: 'months' | 'ms';
  readonly factor: number;
  readonly integerOnly: boolean;
  /** Text form may carry a decimal count (digits, optional .digits). */
  readonly decimalText: boolean;
}

export type DurationComponents = Readonly<Record<DurationUnitName, number>>;

// ============================================================
// TABLE
// ============================================================

/** Ordered largest-first. Text grammar requires suffixes in this order. */
export const DURATION_UNITS: readonly DurationUnit[] = [
  {
    name: 'years',
    suffix: 'y',
    field: 'months',
    factor: 12,
    integerOnly: true,
    decimalText: false,
  },
  {
    name: 'months',
    suffix: 'mo',
    field: 'months',
    factor: 1,
    integerOnly: true,
    decimalText: false,
  },
  {
    name: 'days',
    suffix: 'd',
    field: 'ms',
    factor: 86_400_000,
    integerOnly: false,
    decimalText: false,
  },
  {
    name: 'hours',
    suffix: 'h',
    field: 'ms',
    factor: 3_600_000,
    integerOnly: false,
    decimalText: false,
  },
  {
    name: 'minutes',
    suffix: 'm',
    field: 'ms',
    factor: 60_000,
    integerOnly: false,
    decimalText: false,
  },
  {
    name: 'seconds',
    suffix: 's',
    field: 'ms',
    factor: 1_000,
    integerOnly: false,
    decimalText: false,
  },
  {
    name: 'ms',
    suffix: 'ms',
    field: 'ms',
    factor: 1,
    integerOnly: false,
    decimalText: true,
  },
];

/** Milliseconds per hour, read from the table. */
export const MS_PER_HOUR: number =
  DURATION_UNITS.find((u) => u.name === 'hours')?.factor ?? 3_600_000;

// ============================================================
// DECOMPOSE / FORMAT
// ============================================================

/**
 * Split a duration into per-unit components, largest unit first within each
 * field. The smallest unit of each field takes the remainder.
 */
export function decomposeDuration(d: {
  readonly months: number;
  readonly ms: number;
}): DurationComponents {
  const remaining = { months: d.months, ms: d.ms };
  const out: Record<DurationUnitName, number> = {
    years: 0,
    months: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    ms: 0,
  };
  const lastOfField = new Map<string, DurationUnitName>();
  for (const unit of DURATION_UNITS) lastOfField.set(unit.field, unit.name);
  for (const unit of DURATION_UNITS) {
    if (lastOfField.get(unit.field) === unit.name) {
      out[unit.name] = remaining[unit.field];
    } else {
      const count = Math.floor(remaining[unit.field] / unit.factor);
      out[unit.name] = count;
      remaining[unit.field] -= count * unit.factor;
    }
  }
  return out;
}

/**
 * Count text that parses back exactly: shortest round-trip digits, with any
 * exponent form expanded to plain decimal (the grammar has no exponent).
 */
function formatCount(count: number): string {
  const text = String(count);
  const match = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (match === null) return text;
  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  const exp = Number(match[3]);
  const digits = intPart + fracPart;
  const pointAt = intPart.length + exp;
  if (pointAt <= 0) return `0.${'0'.repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length)
    return digits + '0'.repeat(pointAt - digits.length);
  return `${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

/** Compact text: nonzero components concatenated, zero duration is "0ms". */
export function formatDurationText(d: {
  readonly months: number;
  readonly ms: number;
}): string {
  const parts = decomposeDuration(d);
  let text = '';
  for (const unit of DURATION_UNITS) {
    const count = parts[unit.name];
    if (count > 0) text += `${formatCount(count)}${unit.suffix}`;
  }
  return text === '' ? '0ms' : text;
}

// ============================================================
// PARSE
// ============================================================

const SUFFIXES_LONGEST_FIRST: readonly DurationUnit[] = [
  ...DURATION_UNITS,
].sort((a, b) => b.suffix.length - a.suffix.length);

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/**
 * Parse duration text: one or more digit+suffix runs (the ms count may carry
 * a decimal part), suffixes in table order,
 * each at most once, longest suffix first. Returns undefined when malformed.
 * Pure: never halts.
 */
export function parseDurationText(
  text: string
): { months: number; ms: number } | undefined {
  if (text.length === 0) return undefined;
  const totals = { months: 0, ms: 0 };
  let pos = 0;
  let nextIndex = 0;
  while (pos < text.length) {
    const start = pos;
    while (pos < text.length && isDigit(text.charCodeAt(pos))) pos++;
    if (pos === start) return undefined;
    let hasFraction = false;
    if (text.charCodeAt(pos) === 46) {
      const fractionStart = pos + 1;
      pos = fractionStart;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) pos++;
      if (pos === fractionStart) return undefined;
      hasFraction = true;
    }
    const count = Number(text.slice(start, pos));
    if (!(count <= Number.MAX_SAFE_INTEGER)) return undefined;
    const rest = text.slice(pos);
    const unit = SUFFIXES_LONGEST_FIRST.find((u) => rest.startsWith(u.suffix));
    if (unit === undefined) return undefined;
    if (hasFraction && !unit.decimalText) return undefined;
    const index = DURATION_UNITS.indexOf(unit);
    if (index < nextIndex) return undefined;
    nextIndex = index + 1;
    pos += unit.suffix.length;
    totals[unit.field] += count * unit.factor;
  }
  if (!Number.isFinite(totals.months) || !Number.isFinite(totals.ms)) {
    return undefined;
  }
  return totals;
}
