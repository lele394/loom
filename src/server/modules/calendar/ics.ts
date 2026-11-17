import ICAL from 'ical.js';
import { AppError } from '../../core/errors';
import type { CalendarItemType } from '../../../shared/constants';

export interface ParsedIcsEvent {
  externalUid: string;
  title: string;
  type: CalendarItemType;
  description: string;
  startsAt: string;
  endsAt: string | null;
}

export interface ParsedIcsCalendar {
  name: string | null;
  events: ParsedIcsEvent[];
  truncated: boolean;
}

function mapType(summary: string, categories: string): CalendarItemType {
  const text = `${summary} ${categories}`.toLowerCase();
  if (/\b(deadline|due|exam|tentamen|submission|submit)\b/.test(text)) return 'deadline';
  if (/\b(meeting|möte|mote|standup|stand-up)\b/.test(text)) return 'meeting';
  if (/\b(milestone)\b/.test(text)) return 'milestone';
  if (/\b(focus|deep work|study block)\b/.test(text)) return 'focus';
  return 'event';
}

function categoriesOf(component: ICAL.Component): string {
  const value = component.getFirstPropertyValue('categories');
  if (Array.isArray(value)) return value.join(' ');
  return value == null ? '' : String(value);
}

function descriptionOf(event: ICAL.Event): string {
  const parts: string[] = [];
  if (event.description) parts.push(event.description.trim());
  if (event.location) parts.push(`Location: ${event.location.trim()}`);
  return parts.filter(Boolean).join('\n\n').slice(0, 20_000);
}

function eventUid(event: ICAL.Event, start: ICAL.Time, summary: string): string {
  const uid = event.uid || summary || 'event';
  return `${uid}:${start.toUnixTime()}`;
}

/**
 * Parse a standard iCalendar feed and expand recurrences inside a bounded
 * window. Everything is metadata; no file content is involved.
 */
export function parseIcsCalendar(
  text: string,
  options: { from: Date; to: Date; maxOccurrences?: number },
): ParsedIcsCalendar {
  let jcal: any;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new AppError('bad_request', 'This URL did not return a valid iCalendar (.ics) feed.');
  }

  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(jcal);
  } catch {
    throw new AppError('bad_request', 'This URL did not return a valid iCalendar (.ics) feed.');
  }

  const nameValue = calendar.getFirstPropertyValue('x-wr-calname');
  const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : null;
  const events: ParsedIcsEvent[] = [];
  const maxOccurrences = options.maxOccurrences ?? 5000;
  let truncated = false;

  const push = (event: ICAL.Event, start: Date, end: Date, component: ICAL.Component) => {
    if (end.getTime() < options.from.getTime() || start.getTime() > options.to.getTime()) return;
    const summary = (event.summary || 'Untitled event').trim();
    const title = summary || 'Untitled event';
    const endsAt = end.getTime() > start.getTime() ? end.toISOString() : null;
    const uid = eventUid(event, ICAL.Time.fromJSDate(start, true), summary);
    events.push({
      externalUid: uid,
      title: title.slice(0, 200),
      type: mapType(summary, categoriesOf(component)),
      description: descriptionOf(event),
      startsAt: start.toISOString(),
      endsAt,
    });
  };

  for (const component of calendar.getAllSubcomponents('vevent')) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(component);
    } catch {
      continue;
    }
    if (event.isRecurrenceException()) continue;
    const status = String(component.getFirstPropertyValue('status') ?? '').toUpperCase();
    if (status === 'CANCELLED') continue;

    if (!event.isRecurring()) {
      const start = event.startDate.toJSDate();
      const end = event.endDate?.toJSDate() ?? start;
      push(event, start, end, component);
      continue;
    }

    let iterator: ICAL.RecurExpansion;
    try {
      iterator = event.iterator();
    } catch {
      continue;
    }
    for (let count = 0; count < maxOccurrences; count++) {
      let next: ICAL.Time | null = null;
      try {
        next = iterator.next();
      } catch {
        break;
      }
      if (!next) break;
      let details: ReturnType<ICAL.Event['getOccurrenceDetails']>;
      try {
        details = event.getOccurrenceDetails(next);
      } catch {
        continue;
      }
      const start = details.startDate.toJSDate();
      if (start.getTime() > options.to.getTime()) break;
      if (start.getTime() < options.from.getTime()) continue;
      const occurrence = details.item ?? event;
      const occurrenceStatus = String(
        occurrence.component.getFirstPropertyValue('status') ?? '',
      ).toUpperCase();
      if (occurrenceStatus === 'CANCELLED') continue;
      const end = details.endDate?.toJSDate() ?? start;
      push(occurrence, start, end, occurrence.component ?? component);
      if (count === maxOccurrences - 1) truncated = true;
    }
  }

  events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { name, events, truncated };
}
