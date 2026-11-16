import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import { newId } from '../../core/ids';
import { parseJson } from '../../core/text';
import { zonedDayRange } from '../../core/time';
import type { ActivityEvent, DailyDiff, DiffItem, DiffProject } from '../../../shared/types';

export interface RecordActivityInput {
  actorId: string;
  projectId?: string | null;
  objectId?: string | null;
  objectType?: string | null;
  objectTitle?: string | null;
  action: string;
  summary: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  source?: 'ui' | 'api' | 'job' | 'ai';
  requestId?: string | null;
}

interface ActivityRow {
  seq: number;
  id: string;
  actor_id: string;
  project_id: string | null;
  object_id: string | null;
  object_type: string | null;
  object_title: string | null;
  action: string;
  summary: string;
  changes_json: string | null;
  source: 'ui' | 'api' | 'job' | 'ai';
  request_id: string | null;
  occurred_at: string;
}

function mapEvent(row: ActivityRow): ActivityEvent {
  return {
    seq: row.seq,
    id: row.id,
    actorId: row.actor_id,
    projectId: row.project_id,
    objectId: row.object_id,
    objectType: row.object_type,
    objectTitle: row.object_title,
    action: row.action,
    summary: row.summary,
    changes: parseJson(row.changes_json, null),
    source: row.source,
    occurredAt: row.occurred_at,
  };
}

export class ActivityService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
  ) {}

  record(input: RecordActivityInput): number {
    const row = this.db
      .prepare(
        `INSERT INTO activity_events
          (id, actor_id, project_id, object_id, object_type, object_title, action, summary, changes_json, source, request_id, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('evt'),
        input.actorId,
        input.projectId ?? null,
        input.objectId ?? null,
        input.objectType ?? null,
        input.objectTitle ?? null,
        input.action,
        input.summary,
        input.changes ? JSON.stringify(input.changes) : null,
        input.source ?? 'ui',
        input.requestId ?? null,
        this.clock.iso(),
      );
    return Number(row.lastInsertRowid);
  }

  latestSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS seq FROM activity_events').get() as {
      seq: number | null;
    };
    return row.seq ?? 0;
  }

  list(filters: {
    projectId?: string;
    objectId?: string;
    type?: string;
    from?: string;
    to?: string;
    before?: number;
    limit?: number;
  }): ActivityEvent[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.objectId) {
      clauses.push('object_id = ?');
      params.push(filters.objectId);
    }
    if (filters.type) {
      clauses.push('object_type = ?');
      params.push(filters.type);
    }
    if (filters.from) {
      clauses.push('occurred_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push('occurred_at <= ?');
      params.push(filters.to);
    }
    if (filters.before) {
      clauses.push('seq < ?');
      params.push(filters.before);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM activity_events ${where} ORDER BY seq DESC LIMIT ?`)
      .all(...params, filters.limit ?? 50) as ActivityRow[];
    return rows.map(mapEvent);
  }

  forObject(objectId: string, limit = 50): ActivityEvent[] {
    return this.list({ objectId, limit });
  }

  diff(date: string, timezone: string): DailyDiff {
    const { start, end } = zonedDayRange(date, timezone);
    const rows = this.db
      .prepare(
        'SELECT * FROM activity_events WHERE occurred_at >= ? AND occurred_at < ? ORDER BY seq ASC',
      )
      .all(start.toISOString(), end.toISOString()) as ActivityRow[];

    const projects = this.db.prepare('SELECT id, name FROM projects').all() as {
      id: string;
      name: string;
    }[];
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));

    interface Bucket {
      bucket: 'added' | 'updated' | 'completed' | 'removed';
      title: string;
      type: string;
      fields: Set<string>;
    }
    const byObject = new Map<string, Bucket>();
    for (const row of rows) {
      if (!row.object_id) continue;
      let bucket: Bucket['bucket'] = 'updated';
      if (row.action.endsWith('.deleted')) bucket = 'removed';
      else if (row.action.endsWith('.created')) bucket = 'added';
      else if (row.action.endsWith('.completed')) bucket = 'completed';

      const existing = byObject.get(row.object_id);
      const rank = { updated: 0, completed: 1, added: 2, removed: 3 };
      const fields = new Set<string>();
      if (row.changes_json) {
        const changes = parseJson<Record<string, unknown>>(row.changes_json, {});
        for (const key of Object.keys(changes)) fields.add(key);
      }
      if (!existing) {
        byObject.set(row.object_id, {
          bucket,
          title: row.object_title ?? '(untitled)',
          type: row.object_type ?? 'object',
          fields,
        });
      } else {
        if (rank[bucket] > rank[existing.bucket]) existing.bucket = bucket;
        for (const field of fields) existing.fields.add(field);
        if (row.object_title) existing.title = row.object_title;
      }
    }

    const groups = new Map<string | null, DiffProject>();
    const ensureGroup = (projectId: string | null): DiffProject => {
      let group = groups.get(projectId);
      if (!group) {
        group = {
          projectId,
          projectName: projectId ? projectNames.get(projectId) ?? 'Deleted project' : 'Unfiled',
          added: [],
          updated: [],
          completed: [],
          removed: [],
          eventCount: 0,
        };
        groups.set(projectId, group);
      }
      return group;
    };

    for (const row of rows) {
      ensureGroup(row.project_id).eventCount += 1;
    }

    const totals = { added: 0, updated: 0, completed: 0, removed: 0 };
    for (const [objectId, bucket] of byObject) {
      const row = rows.find((event) => event.object_id === objectId)!;
      const item: DiffItem = {
        type: bucket.type,
        id: objectId,
        title: bucket.title,
        ...(bucket.fields.size ? { fields: [...bucket.fields].sort() } : {}),
      };
      const group = ensureGroup(row.project_id);
      group[bucket.bucket].push(item);
      totals[bucket.bucket] += 1;
    }

    const byProject = [...groups.values()]
      .map((group) => ({
        ...group,
        added: group.added.sort((a, b) => a.title.localeCompare(b.title)),
        updated: group.updated.sort((a, b) => a.title.localeCompare(b.title)),
        completed: group.completed.sort((a, b) => a.title.localeCompare(b.title)),
        removed: group.removed.sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.projectName.localeCompare(b.projectName));

    return {
      date,
      timezone,
      totals,
      byProject,
      eventCount: rows.length,
      eventSeqRange: rows.length ? [rows[0]!.seq, rows[rows.length - 1]!.seq] : null,
    };
  }

  maxSeqInRange(date: string, timezone: string): number {
    const { start, end } = zonedDayRange(date, timezone);
    const row = this.db
      .prepare(
        'SELECT MAX(seq) AS seq FROM activity_events WHERE occurred_at >= ? AND occurred_at < ?',
      )
      .get(start.toISOString(), end.toISOString()) as { seq: number | null };
    return row.seq ?? 0;
  }
}
