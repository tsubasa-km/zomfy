// The next time a 5-field cron expression ("M H DoM Mon DoW", local time) matches, for the wake-ups
// Claude schedules (docs/specs/scheduled-wake-ups.md). Supports `*`, numbers, lists, ranges and
// steps, and the usual rule that a restricted day-of-month and day-of-week match either.

interface Field {
  values: Set<number>;
  any: boolean;
}

const RANGES: readonly [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

function parseField(text: string, [min, max]: [number, number]): Field | null {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!range || !Number.isInteger(step) || step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map(Number);
      if (a === undefined || b === undefined) return null;
      from = a;
      to = b;
    } else {
      from = Number(range);
      to = stepText === undefined ? from : max;
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) return null;
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, any: text === "*" };
}

/** The first minute at or after `from` (rounded up to a whole minute) that `expr` matches; null if none within a year or it does not parse. */
export function nextCronTime(expr: string, from: number): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const fields = parts.map((p, i) => parseField(p, RANGES[i]!));
  if (fields.some((f) => f === null)) return null;
  const [minute, hour, dom, month, dow] = fields as Field[];
  // Sunday is 0 or 7.
  if (dow!.values.has(7)) dow!.values.add(0);
  const dayMatches = (d: Date): boolean => {
    const byDom = dom!.values.has(d.getDate());
    const byDow = dow!.values.has(d.getDay());
    if (dom!.any && dow!.any) return true;
    if (dom!.any) return byDow;
    if (dow!.any) return byDom;
    return byDom || byDow;
  };
  const at = new Date(from);
  if (at.getSeconds() > 0 || at.getMilliseconds() > 0) at.setMinutes(at.getMinutes() + 1, 0, 0);
  else at.setSeconds(0, 0);
  const limit = from + 366 * 24 * 60 * 60_000;
  while (at.getTime() <= limit) {
    if (!month!.values.has(at.getMonth() + 1)) {
      at.setMonth(at.getMonth() + 1, 1);
      at.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(at)) {
      at.setDate(at.getDate() + 1);
      at.setHours(0, 0, 0, 0);
      continue;
    }
    if (!hour!.values.has(at.getHours())) {
      at.setHours(at.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!minute!.values.has(at.getMinutes())) {
      at.setMinutes(at.getMinutes() + 1, 0, 0);
      continue;
    }
    return at.getTime();
  }
  return null;
}
