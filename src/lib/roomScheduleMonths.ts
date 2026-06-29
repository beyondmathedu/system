/**
 * Which calendar months to expand when loading room schedules for a date range.
 * Keeps room pages from expanding the full year when a narrow range is selected.
 */
export function monthsToLoadForScheduleRange(
  startIso: string,
  endIso: string,
  fallbackMonth: number,
): number[] {
  if (!startIso || !endIso) return [fallbackMonth];
  const sm = Number(startIso.slice(5, 7));
  const em = Number(endIso.slice(5, 7));
  const sy = Number(startIso.slice(0, 4));
  const ey = Number(endIso.slice(0, 4));
  if (!Number.isFinite(sm) || !Number.isFinite(em) || !Number.isFinite(sy) || !Number.isFinite(ey)) {
    return [fallbackMonth];
  }
  const out: number[] = [];
  if (sy === ey) {
    const lo = Math.min(sm, em);
    const hi = Math.max(sm, em);
    for (let m = lo; m <= hi; m++) {
      if (m >= 1 && m <= 12) out.push(m);
    }
    return out.length ? out : [fallbackMonth];
  }
  for (let m = sm; m <= 12; m++) out.push(m);
  for (let m = 1; m <= em; m++) out.push(m);
  return out.length ? [...new Set(out)].sort((a, b) => a - b) : [fallbackMonth];
}
