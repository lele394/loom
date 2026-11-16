const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function partsInZone(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock date/time in a zone to a UTC instant, resolving DST gaps deterministically. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = wall;
  for (let i = 0; i < 4; i++) {
    const offset = offsetMs(new Date(guess), timeZone);
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function zonedDayRange(date: string, timeZone: string): { start: Date; end: Date } {
  if (!isValidDateString(date)) throw new Error(`Invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const start = zonedTimeToUtc(y, m, d, timeZone);
  const nextDay = new Date(Date.UTC(y, m - 1, d + 1));
  const end = zonedTimeToUtc(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
    timeZone,
  );
  return { start, end };
}

export function dateInZone(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function todayIn(timeZone: string, clock: { now(): Date } = { now: () => new Date() }): string {
  return dateInZone(clock.now(), timeZone);
}

export function addDays(date: string, days: number): string {
  if (!isValidDateString(date)) throw new Error(`Invalid date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}

export function timeInZone(iso: string, timeZone: string): string {
  const p = partsInZone(new Date(iso), timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function isIanaTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
