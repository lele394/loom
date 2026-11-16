import { describe, expect, it } from 'vitest';
import { addDays, dateInZone, isValidDateString, todayIn, zonedDayRange } from '../src/server/core/time';

describe('timezone helpers', () => {
  it('builds a 23-hour day across spring DST', () => {
    const { start, end } = zonedDayRange('2026-03-29', 'Europe/Paris');
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('builds a 25-hour day across autumn DST', () => {
    const { start, end } = zonedDayRange('2026-10-25', 'Europe/Paris');
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('reports the local date for an instant', () => {
    expect(dateInZone(new Date('2026-11-16T00:30:00.000Z'), 'Europe/Paris')).toBe('2026-11-16');
    expect(dateInZone(new Date('2026-11-16T23:30:00.000Z'), 'Europe/Paris')).toBe('2026-11-17');
  });

  it('validates and shifts calendar dates', () => {
    expect(isValidDateString('2026-02-28')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(todayIn('UTC', { now: () => new Date('2026-11-16T12:00:00Z') })).toBe('2026-11-16');
  });
});
