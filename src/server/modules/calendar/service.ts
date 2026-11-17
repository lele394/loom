import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import type { CalendarItem } from '../../../shared/types';
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
  created_at: string;
  updated_at: string;
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
