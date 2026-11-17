import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { safeFetch } from '../../core/net';
import { parseIcsCalendar } from './ics';
import type { CalendarItem, CalendarSubscription } from '../../../shared/types';
import type { CalendarItemType, Palette } from '../../../shared/constants';

interface CalendarRow {
  id: string;
  project_id: string;
  project_name: string;
  project_color: Palette;
  title: string;
  type: CalendarItemType;
  description: string;
  starts_at: string;
  ends_at: string | null;
  subscription_id: string | null;
  external_uid: string | null;
  created_at: string;
  updated_at: string;
}

interface SubscriptionRow {
  id: string;
  project_id: string;
  project_name: string;
  project_color: Palette;
  name: string;
  url: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
  item_count?: number;
}

interface CalendarInput {
  projectId: string;
  title: string;
  type: CalendarItemType;
  description?: string;
  startsAt: string;
  endsAt?: string | null;
}

const SELECT = `SELECT c.*, p.name AS project_name, p.color AS project_color
  FROM calendar_items c JOIN projects p ON p.id = c.project_id`;
const SELECT_SUBSCRIPTION = `SELECT s.*, p.name AS project_name, p.color AS project_color,
    (SELECT COUNT(*) FROM calendar_items c WHERE c.subscription_id = s.id) AS item_count
  FROM calendar_subscriptions s JOIN projects p ON p.id = s.project_id`;

function mapItem(row: CalendarRow): CalendarItem {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: row.project_color,
    title: row.title,
    type: row.type,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    subscriptionId: row.subscription_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubscription(row: SubscriptionRow): CalendarSubscription {
  let fallback = row.url;
  try {
    fallback = new URL(row.url).hostname;
  } catch {
    // Keep the raw URL as a last resort.
  }
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: row.project_color,
    name: row.name || fallback,
    url: row.url,
    itemCount: row.item_count ?? 0,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateFeedUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('bad_request', 'Enter a valid calendar URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('bad_request', 'Calendar subscriptions must use http(s).');
  }
  return url.toString();
}

function validateTimes(startsAt: string, endsAt: string | null | undefined): void {
  const start = new Date(startsAt).getTime();
  if (!Number.isFinite(start)) throw new AppError('bad_request', 'The start date is invalid.');
  if (endsAt) {
    const end = new Date(endsAt).getTime();
    if (!Number.isFinite(end)) throw new AppError('bad_request', 'The end date is invalid.');
    if (end < start) throw new AppError('bad_request', 'The end time must be after the start time.');
  }
}

export class CalendarService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
  ) {}

  private requireProject(projectId: string, write = false): { id: string; name: string; status: string } {
    const row = this.db
      .prepare('SELECT id, name, status FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(projectId) as { id: string; name: string; status: string } | undefined;
    if (!row) throw notFound('Project');
    if (write && row.status === 'archived') {
      throw new AppError('project_archived', 'This project is archived and cannot be changed.');
    }
    return row;
  }

  private requireRow(id: string): CalendarRow {
    const row = this.db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CalendarRow | undefined;
    if (!row) throw notFound('Calendar item');
    return row;
  }

  list(options: { projectId?: string; from?: string; to?: string } = {}): CalendarItem[] {
    if (options.projectId) this.requireProject(options.projectId);
    const clauses = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (options.projectId) {
      clauses.push('c.project_id = ?');
      params.push(options.projectId);
    }
    if (options.from) {
      clauses.push('COALESCE(c.ends_at, c.starts_at) >= ?');
      params.push(options.from);
    }
    if (options.to) {
      clauses.push('c.starts_at <= ?');
      params.push(options.to);
    }
    const rows = this.db
      .prepare(`${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY c.starts_at ASC`)
      .all(...params) as CalendarRow[];
    return rows.map(mapItem);
  }

  upcoming(options: { projectId?: string; limit?: number } = {}): CalendarItem[] {
    if (options.projectId) this.requireProject(options.projectId);
    const clauses = ['p.deleted_at IS NULL', 'COALESCE(c.ends_at, c.starts_at) >= ?'];
    const params: unknown[] = [this.clock.iso()];
    if (options.projectId) {
      clauses.push('c.project_id = ?');
      params.push(options.projectId);
    }
    const rows = this.db
      .prepare(`${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY c.starts_at ASC LIMIT ?`)
      .all(...params, Math.min(100, Math.max(1, options.limit ?? 8))) as CalendarRow[];
    return rows.map(mapItem);
  }

  private requireSubscription(id: string): SubscriptionRow {
    const row = this.db.prepare(`${SELECT_SUBSCRIPTION} WHERE s.id = ?`).get(id) as
      | SubscriptionRow
      | undefined;
    if (!row) throw notFound('Calendar subscription');
    return row;
  }

  listSubscriptions(options: { projectId?: string } = {}): CalendarSubscription[] {
    if (options.projectId) this.requireProject(options.projectId);
    const clauses = ['p.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (options.projectId) {
      clauses.push('s.project_id = ?');
      params.push(options.projectId);
    }
    const rows = this.db
      .prepare(`${SELECT_SUBSCRIPTION} WHERE ${clauses.join(' AND ')} ORDER BY s.created_at ASC`)
      .all(...params) as SubscriptionRow[];
    return rows.map(mapSubscription);
  }

  async addSubscription(
    input: { projectId: string; url: string; name?: string },
    actorId: string,
  ): Promise<CalendarSubscription> {
    this.requireProject(input.projectId, true);
    const url = validateFeedUrl(input.url);
    const id = newId('sub');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO calendar_subscriptions
           (id, project_id, name, url, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.projectId, input.name?.trim() ?? '', url, actorId, now, now);
    this.activity.record({
      actorId,
      projectId: input.projectId,
      action: 'calendar.subscription_added',
      summary: `Linked external calendar${input.name ? ` "${input.name}"` : ''}`,
      source: 'api',
    });
    try {
      await this.syncSubscription(id, actorId);
    } catch {
      // The subscription is kept with last_sync_error so the user can fix it.
    }
    return mapSubscription(this.requireSubscription(id));
  }

  removeSubscription(id: string, actorId: string): void {
    const row = this.requireSubscription(id);
    this.requireProject(row.project_id, true);
    this.db.prepare('DELETE FROM calendar_subscriptions WHERE id = ?').run(id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'calendar.subscription_removed',
      summary: `Removed external calendar ${row.name || row.url}`,
      source: 'api',
    });
  }

  async syncSubscription(
    id: string,
    actorId: string,
  ): Promise<{
    subscription: CalendarSubscription;
    imported: number;
    created: number;
    updated: number;
    removed: number;
    truncated: boolean;
  }> {
    const row = this.requireSubscription(id);
    this.requireProject(row.project_id, true);
    const nowMs = this.clock.now().getTime();
    const from = new Date(nowMs - 60 * 24 * 60 * 60 * 1000);
    const to = new Date(nowMs + 365 * 24 * 60 * 60 * 1000);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    try {
      const fetched = await safeFetch(row.url, {
        accept: 'text/calendar,text/plain;q=0.9,*/*;q=0.5',
        allowedContentTypes: ['text/calendar', 'text/plain', 'application/octet-stream'],
        maxBytes: 5 * 1024 * 1024,
        timeoutMs: 20_000,
      });
      const parsed = parseIcsCalendar(fetched.body, { from, to });
      const existing = this.db
        .prepare(
          `SELECT id, external_uid, title, type, description, starts_at, ends_at
           FROM calendar_items WHERE subscription_id = ?`,
        )
        .all(id) as {
        id: string;
        external_uid: string | null;
        title: string;
        type: CalendarItemType;
        description: string;
        starts_at: string;
        ends_at: string | null;
      }[];
      const byUid = new Map(
        existing
          .filter((item) => Boolean(item.external_uid))
          .map((item) => [item.external_uid!, item]),
      );
      const seen = new Set<string>();
      const now = this.clock.iso();
      let created = 0;
      let updated = 0;
      let removed = 0;
      const insert = this.db.prepare(
        `INSERT INTO calendar_items
           (id, project_id, title, type, description, starts_at, ends_at, created_by, created_at, updated_at,
            subscription_id, external_uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const update = this.db.prepare(
        `UPDATE calendar_items
         SET title = ?, type = ?, description = ?, starts_at = ?, ends_at = ?, updated_at = ?
         WHERE id = ?`,
      );
      const remove = this.db.prepare('DELETE FROM calendar_items WHERE id = ?');
      const tx = this.db.transaction(() => {
        for (const event of parsed.events) {
          if (seen.has(event.externalUid)) continue;
          seen.add(event.externalUid);
          const found = byUid.get(event.externalUid);
          if (found) {
            const changed =
              found.title !== event.title ||
              found.type !== event.type ||
              found.description !== event.description ||
              found.starts_at !== event.startsAt ||
              found.ends_at !== event.endsAt;
            if (changed) {
              update.run(
                event.title,
                event.type,
                event.description,
                event.startsAt,
                event.endsAt,
                now,
                found.id,
              );
              updated += 1;
            }
            continue;
          }
          insert.run(
            newId('cal'),
            row.project_id,
            event.title,
            event.type,
            event.description,
            event.startsAt,
            event.endsAt,
            actorId,
            now,
            now,
            id,
            event.externalUid,
          );
          created += 1;
        }

        if (!parsed.truncated) {
          for (const item of existing) {
            if (
              item.external_uid &&
              item.starts_at >= fromIso &&
              item.starts_at <= toIso &&
              !seen.has(item.external_uid)
            ) {
              remove.run(item.id);
              removed += 1;
            }
          }
        }

        this.db
          .prepare(
            `UPDATE calendar_subscriptions
             SET name = ?, last_synced_at = ?, last_sync_error = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(row.name || parsed.name || '', now, now, id);
      });
      tx();

      if (created || updated || removed) {
        this.activity.record({
          actorId,
          projectId: row.project_id,
          action: 'calendar.synced',
          summary: `Synced external calendar ${row.name || parsed.name || row.url}: +${created} ~${updated} -${removed}`,
          source: 'api',
        });
      }
      return {
        subscription: mapSubscription(this.requireSubscription(id)),
        imported: parsed.events.length,
        created,
        updated,
        removed,
        truncated: parsed.truncated,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db
        .prepare('UPDATE calendar_subscriptions SET last_sync_error = ?, updated_at = ? WHERE id = ?')
        .run(message.slice(0, 1000), this.clock.iso(), id);
      throw error instanceof AppError
        ? error
        : new AppError('provider_error', `Calendar sync failed: ${message}`);
    }
  }

  create(input: CalendarInput, actorId: string): CalendarItem {
    this.requireProject(input.projectId, true);
    validateTimes(input.startsAt, input.endsAt);
    const id = newId('cal');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO calendar_items
           (id, project_id, title, type, description, starts_at, ends_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title.trim(),
        input.type,
        input.description ?? '',
        input.startsAt,
        input.endsAt ?? null,
        actorId,
        now,
        now,
      );
    this.activity.record({
      actorId,
      projectId: input.projectId,
      action: 'calendar.created',
      summary: `Created ${input.type} "${input.title.trim()}"`,
      source: 'api',
    });
    return mapItem(this.requireRow(id));
  }

  update(
    id: string,
    input: Partial<Omit<CalendarInput, 'projectId'>> & { projectId?: string },
    actorId: string,
  ): CalendarItem {
    const row = this.requireRow(id);
    this.requireProject(row.project_id, true);
    const projectId = input.projectId ?? row.project_id;
    if (projectId !== row.project_id) this.requireProject(projectId, true);
    const startsAt = input.startsAt ?? row.starts_at;
    const endsAt = input.endsAt === undefined ? row.ends_at : input.endsAt;
    validateTimes(startsAt, endsAt);
    this.db
      .prepare(
        `UPDATE calendar_items
         SET project_id = ?, title = ?, type = ?, description = ?, starts_at = ?, ends_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        projectId,
        input.title?.trim() || row.title,
        input.type ?? row.type,
        input.description ?? row.description,
        startsAt,
        endsAt,
        this.clock.iso(),
        id,
      );
    this.activity.record({
      actorId,
      projectId,
      action: 'calendar.updated',
      summary: `Updated ${input.type ?? row.type} "${input.title?.trim() || row.title}"`,
      source: 'api',
    });
    return mapItem(this.requireRow(id));
  }

  remove(id: string, actorId: string): void {
    const row = this.requireRow(id);
    this.requireProject(row.project_id, true);
    this.db.prepare('DELETE FROM calendar_items WHERE id = ?').run(id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'calendar.deleted',
      summary: `Deleted ${row.type} "${row.title}"`,
      source: 'api',
    });
  }
}
