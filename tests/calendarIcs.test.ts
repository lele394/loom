import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';
import { parseIcsCalendar } from '../src/server/modules/calendar/ics';

const net = vi.hoisted(() => ({ safeFetch: vi.fn() }));
vi.mock('../src/server/core/net', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/server/core/net')>()),
  safeFetch: net.safeFetch,
}));

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Loom Test//EN
X-WR-CALNAME:University schedule
BEGIN:VTIMEZONE
TZID:Europe/Stockholm
BEGIN:STANDARD
DTSTART:19701025T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700329T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
END:VTIMEZONE
BEGIN:VEVENT
UID:course-1
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/Stockholm:20260115T100000
DTEND;TZID=Europe/Stockholm:20260115T120000
SUMMARY:Lecture 1
DESCRIPTION:Room 2
LOCATION:Building 1
RRULE:FREQ=WEEKLY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:exam-1
DTSTART;TZID=Europe/Stockholm:20260301T090000
DTEND;TZID=Europe/Stockholm:20260301T120000
SUMMARY:Written exam
END:VEVENT
BEGIN:VEVENT
UID:cancelled-1
DTSTART:20260302T090000Z
DTEND:20260302T100000Z
SUMMARY:Cancelled lecture
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

let harness: TestHarness;

beforeEach(async () => {
  net.safeFetch.mockReset();
  harness = await createTestHarness();
});

afterEach(async () => {
  await harness.cleanup();
});

function icsDate(hoursFromNow: number): string {
  const date = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}00Z`;
}

describe('iCalendar parsing and subscriptions', () => {
  it('expands recurring events, handles timezones and maps types', () => {
    const parsed = parseIcsCalendar(SAMPLE_ICS, {
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(parsed.name).toBe('University schedule');
    expect(parsed.events).toHaveLength(4);
    expect(parsed.events[0]!.title).toBe('Lecture 1');
    expect(parsed.events[0]!.startsAt).toBe('2026-01-15T09:00:00.000Z');
    expect(parsed.events[0]!.description).toContain('Location: Building 1');
    expect(parsed.events[0]!.type).toBe('event');
    expect(parsed.events[3]!.type).toBe('deadline');
    expect(new Set(parsed.events.map((event) => event.externalUid)).size).toBe(4);
  });

  it('syncs a subscribed feed, deduplicates and removes imported items with the subscription', async () => {
    const feed = `BEGIN:VCALENDAR
VERSION:2.0
X-WR-CALNAME:Course timetable
BEGIN:VEVENT
UID:future-meeting
DTSTART:${icsDate(24)}
DTEND:${icsDate(25)}
SUMMARY:Project meeting
DESCRIPTION:Agenda in the course page
END:VEVENT
BEGIN:VEVENT
UID:future-deadline
DTSTART:${icsDate(72)}
DTEND:${icsDate(73)}
SUMMARY:Submission deadline
END:VEVENT
END:VCALENDAR`;
    net.safeFetch.mockResolvedValue({
      finalUrl: 'https://example.com/calendar.ics',
      contentType: 'text/calendar; charset=utf-8',
      body: feed,
    });

    const added = await harness.request('POST', '/calendar/subscriptions', {
      projectId: harness.projectId,
      url: 'https://example.com/calendar.ics',
      name: '',
    });
    expect(added.status).toBe(201);
    expect(added.body.lastSyncError).toBeNull();
    expect(added.body.itemCount).toBe(2);
    expect(added.body.name).toBe('Course timetable');

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const listed = await harness.request(
      'GET',
      `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.items[0].subscriptionId).toBe(added.body.id);
    expect(listed.body.items[0].type).toBe('meeting');
    expect(listed.body.items[1].type).toBe('deadline');

    const resynced = await harness.request(
      'POST',
      `/calendar/subscriptions/${added.body.id}/sync`,
      {},
    );
    expect(resynced.status).toBe(200);
    expect(resynced.body.created).toBe(0);
    expect(resynced.body.imported).toBe(2);

    const subscriptions = await harness.request(
      'GET',
      `/calendar/subscriptions?projectId=${harness.projectId}`,
    );
    expect(subscriptions.body.subscriptions).toHaveLength(1);
    expect(subscriptions.body.subscriptions[0].lastSyncedAt).toBeTruthy();

    await harness.request('DELETE', `/calendar/subscriptions/${added.body.id}`);
    const after = await harness.request(
      'GET',
      `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    );
    expect(after.body.items).toHaveLength(0);
  });
});
