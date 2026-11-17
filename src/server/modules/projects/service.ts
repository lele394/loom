import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import { AppError, ensureFound, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import type { BoardColumn, Project, ProjectCounts } from '../../../shared/types';
import type { Palette } from '../../../shared/constants';

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  color: Palette;
  status: 'active' | 'archived';
  settings_json: string;
  is_system: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ColumnRow {
  id: string;
  project_id: string;
  name: string;
  is_done: number;
  position: number;
  created_at: string;
  updated_at: string;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    status: row.status,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapColumn(row: ColumnRow): BoardColumn {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    isDone: row.is_done === 1,
    position: row.position,
  };
}

const DEFAULT_COLUMNS: { name: string; isDone: boolean }[] = [
  { name: 'Backlog', isDone: false },
  { name: 'Todo', isDone: false },
  { name: 'Doing', isDone: false },
  { name: 'Done', isDone: true },
];

export class ProjectService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
  ) {}

  /** The Personal project is part of the workspace and must always be available. */
  ensureSystemProject(): void {
    const existing = this.db
      .prepare('SELECT * FROM projects WHERE is_system = 1 ORDER BY created_at ASC LIMIT 1')
      .get() as ProjectRow | undefined;
    const now = this.clock.iso();
    if (existing) {
      if (existing.deleted_at || existing.status !== 'active') {
        this.db
          .prepare("UPDATE projects SET deleted_at = NULL, status = 'active', updated_at = ? WHERE id = ?")
          .run(now, existing.id);
      }
      const columns = this.db
        .prepare('SELECT COUNT(*) AS count FROM board_columns WHERE project_id = ?')
        .get(existing.id) as { count: number };
      if (columns.count === 0) {
        const insertColumn = this.db.prepare(
          `INSERT INTO board_columns (id, project_id, name, is_done, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        DEFAULT_COLUMNS.forEach((column, index) => {
          insertColumn.run(newId('col'), existing.id, column.name, column.isDone ? 1 : 0, index, now, now);
        });
      }
      return;
    }

    const id = newId('prj');
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, description, color, status, settings_json, is_system, created_at, updated_at)
           VALUES (?, 'Personal', ?, 'sage', 'active', '{}', 1, ?, ?)`,
        )
        .run(id, 'A place for anything that does not belong to another project.', now, now);
      const insertColumn = this.db.prepare(
        `INSERT INTO board_columns (id, project_id, name, is_done, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      DEFAULT_COLUMNS.forEach((column, index) => {
        insertColumn.run(newId('col'), id, column.name, column.isDone ? 1 : 0, index, now, now);
      });
    });
    tx();
  }

  create(input: { name: string; description?: string; color?: string }, actorId: string): Project {
    const id = newId('prj');
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO projects (id, name, description, color, status, settings_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', '{}', ?, ?)`,
        )
        .run(id, input.name.trim(), input.description ?? '', input.color ?? 'lavender', now, now);
      const insertColumn = this.db.prepare(
        `INSERT INTO board_columns (id, project_id, name, is_done, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      DEFAULT_COLUMNS.forEach((column, index) => {
        insertColumn.run(newId('col'), id, column.name, column.isDone ? 1 : 0, index, now, now);
      });
      this.activity.record({
        actorId,
        projectId: id,
        action: 'project.created',
        summary: `Created project "${input.name.trim()}"`,
      });
    });
    tx();
    return mapProject(this.requireRow(id));
  }

  private requireRow(id: string, includeDeleted = false): ProjectRow {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    if (!row || (!includeDeleted && row.deleted_at)) throw notFound('Project');
    return row;
  }

  get(id: string): Project | null {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  }

  countsFor(projectId: string): ProjectCounts {
    const rows = this.db
      .prepare(
        "SELECT type, COUNT(*) AS count FROM objects WHERE project_id = ? AND deleted_at IS NULL GROUP BY type",
      )
      .all(projectId) as { type: string; count: number }[];
    const counts: ProjectCounts = {
      notes: 0,
      tasks: 0,
      openTasks: 0,
      references: 0,
      experiments: 0,
      questions: 0,
    };
    for (const row of rows) {
      if (row.type === 'note') counts.notes = row.count;
      if (row.type === 'task') counts.tasks = row.count;
      if (row.type === 'reference') counts.references = row.count;
      if (row.type === 'experiment') counts.experiments = row.count;
      if (row.type === 'question') counts.questions = row.count;
    }
    const open = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM tasks t JOIN objects o ON o.id = t.id
         WHERE o.project_id = ? AND o.deleted_at IS NULL AND t.completed_at IS NULL`,
      )
      .get(projectId) as { count: number };
    counts.openTasks = open.count;
    return counts;
  }

  list(includeArchived = false): Project[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM projects WHERE deleted_at IS NULL ${includeArchived ? '' : "AND status = 'active'"}
         ORDER BY is_system DESC, created_at ASC`,
      )
      .all() as ProjectRow[];
    return rows.map((row) => ({ ...mapProject(row), counts: this.countsFor(row.id) }));
  }

  listDeleted(): Project[] {
    const rows = this.db
      .prepare('SELECT * FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
      .all() as ProjectRow[];
    return rows.map(mapProject);
  }

  update(
    id: string,
    patch: { name?: string; description?: string; color?: string },
    actorId: string,
  ): Project {
    const row = this.requireRow(id);
    if (row.is_system === 1 && patch.name !== undefined && patch.name.trim() !== row.name) {
      throw new AppError('bad_request', 'The Personal project cannot be renamed.');
    }
    this.db
      .prepare('UPDATE projects SET name = ?, description = ?, color = ?, updated_at = ? WHERE id = ?')
      .run(
        row.is_system === 1 ? row.name : patch.name?.trim() || row.name,
        patch.description ?? row.description,
        patch.color ?? row.color,
        this.clock.iso(),
        id,
      );
    this.activity.record({
      actorId,
      projectId: id,
      action: 'project.updated',
      summary: `Updated project "${patch.name?.trim() || row.name}"`,
    });
    return mapProject(this.requireRow(id));
  }

  setArchived(id: string, archived: boolean, actorId: string): Project {
    const row = this.requireRow(id);
    if (row.is_system === 1) {
      throw new AppError('bad_request', 'The Personal project cannot be archived.');
    }
    this.db
      .prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 'archived' : 'active', this.clock.iso(), id);
    this.activity.record({
      actorId,
      projectId: id,
      action: archived ? 'project.archived' : 'project.unarchived',
      summary: `${archived ? 'Archived' : 'Unarchived'} project "${row.name}"`,
    });
    return mapProject(this.requireRow(id));
  }

  softDelete(id: string, actorId: string): void {
    const row = this.requireRow(id);
    if (row.is_system === 1) {
      throw new AppError('bad_request', 'The Personal project cannot be deleted.');
    }
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      const objects = this.db
        .prepare('SELECT * FROM objects WHERE project_id = ? AND deleted_at IS NULL')
        .all(id) as { id: string; type: string; title: string }[];
      const mark = this.db.prepare(
        'UPDATE objects SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
      );
      for (const object of objects) {
        mark.run(now, now, actorId, object.id);
        this.activity.record({
          actorId,
          projectId: id,
          objectId: object.id,
          objectType: object.type,
          objectTitle: object.title,
          action: `${object.type}.deleted`,
          summary: `Moved ${object.type} "${object.title}" to trash (project deleted)`,
          source: 'api',
        });
      }
      this.db
        .prepare('UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(now, now, id);
      this.activity.record({
        actorId,
        projectId: id,
        action: 'project.deleted',
        summary: `Moved project "${row.name}" to trash`,
        source: 'api',
      });
    });
    tx();
  }

  restore(id: string, actorId: string): Project {
    const row = this.requireRow(id, true);
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE projects SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(now, id);
      const result = this.db
        .prepare(
          'UPDATE objects SET deleted_at = NULL, updated_at = ?, updated_by = ? WHERE project_id = ? AND deleted_at IS NOT NULL',
        )
        .run(now, actorId, id);
      this.activity.record({
        actorId,
        projectId: id,
        action: 'project.restored',
        summary: `Restored project "${row.name}" and ${result.changes} object(s)`,
      });
    });
    tx();
    return mapProject(this.requireRow(id));
  }

  purge(id: string, actorId: string): void {
    const row = this.requireRow(id, true);
    if (row.is_system === 1) {
      throw new AppError('bad_request', 'The Personal project cannot be deleted.');
    }
    const objects = this.db
      .prepare('SELECT id FROM objects WHERE project_id = ?')
      .all(id) as { id: string }[];
    const tx = this.db.transaction(() => {
      for (const object of objects) this.objects.purge(object.id, actorId);
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      this.activity.record({
        actorId,
        projectId: id,
        action: 'project.purged',
        summary: `Permanently deleted project "${row.name}"`,
        source: 'api',
      });
    });
    tx();
  }

  // ── Board ──────────────────────────────────────────────────────────────
  columns(projectId: string): BoardColumn[] {
    this.requireRow(projectId);
    const rows = this.db
      .prepare('SELECT * FROM board_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC')
      .all(projectId) as ColumnRow[];
    return rows.map((row) => {
      const count = this.db
        .prepare(
          'SELECT COUNT(*) AS count FROM tasks t JOIN objects o ON o.id = t.id WHERE t.column_id = ? AND o.deleted_at IS NULL',
        )
        .get(row.id) as { count: number };
      return { ...mapColumn(row), taskCount: count.count };
    });
  }

  createColumn(projectId: string, input: { name: string; isDone?: boolean; position?: number }, actorId: string): BoardColumn {
    this.requireRow(projectId);
    const now = this.clock.iso();
    const max = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM board_columns WHERE project_id = ?')
      .get(projectId) as { max: number };
    const position = input.position ?? max.max + 1;
    const id = newId('col');
    this.db
      .prepare(
        'INSERT INTO board_columns (id, project_id, name, is_done, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, projectId, input.name.trim(), input.isDone ? 1 : 0, position, now, now);
    this.normalizeColumns(projectId);
    this.activity.record({
      actorId,
      projectId,
      action: 'project.updated',
      summary: `Added board column "${input.name.trim()}"`,
    });
    return mapColumn(
      this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(id) as ColumnRow,
    );
  }

  updateColumn(
    columnId: string,
    patch: { name?: string; isDone?: boolean; position?: number },
    actorId: string,
  ): BoardColumn {
    const row = this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as
      | ColumnRow
      | undefined;
    if (!row) throw notFound('Column');
    this.db
      .prepare('UPDATE board_columns SET name = ?, is_done = ?, position = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name?.trim() || row.name,
        patch.isDone === undefined ? row.is_done : patch.isDone ? 1 : 0,
        patch.position ?? row.position,
        this.clock.iso(),
        columnId,
      );
    this.normalizeColumns(row.project_id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'project.updated',
      summary: `Updated board column "${patch.name?.trim() || row.name}"`,
    });
    return mapColumn(
      this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as ColumnRow,
    );
  }

  deleteColumn(columnId: string, actorId: string): void {
    const row = this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as
      | ColumnRow
      | undefined;
    if (!row) throw notFound('Column');
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM tasks WHERE column_id = ?')
      .get(columnId) as { count: number };
    if (count.count > 0) {
      throw new AppError('bad_request', 'Move or delete the tasks in this column first.');
    }
    this.db.prepare('DELETE FROM board_columns WHERE id = ?').run(columnId);
    this.normalizeColumns(row.project_id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'project.updated',
      summary: `Deleted board column "${row.name}"`,
    });
  }

  private normalizeColumns(projectId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM board_columns WHERE project_id = ? ORDER BY position ASC, created_at ASC')
      .all(projectId) as { id: string }[];
    const update = this.db.prepare('UPDATE board_columns SET position = ? WHERE id = ?');
    rows.forEach((row, index) => update.run(index, row.id));
  }

  defaultColumnId(projectId: string, preferOpen = true): string {
    const row = this.db
      .prepare(
        `SELECT id FROM board_columns WHERE project_id = ?
         ORDER BY ${preferOpen ? 'is_done ASC, ' : ''}position ASC LIMIT 1`,
      )
      .get(projectId) as { id: string } | undefined;
    if (!row) throw new AppError('bad_request', 'This project has no board columns.');
    return row.id;
  }

  doneColumnId(projectId: string): string | null {
    const row = this.db
      .prepare('SELECT id FROM board_columns WHERE project_id = ? AND is_done = 1 ORDER BY position ASC LIMIT 1')
      .get(projectId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  requireColumn(columnId: string): ColumnRow {
    const row = this.db.prepare('SELECT * FROM board_columns WHERE id = ?').get(columnId) as
      | ColumnRow
      | undefined;
    if (!row) throw notFound('Column');
    return row;
  }

  isDoneColumn(columnId: string): boolean {
    return this.requireColumn(columnId).is_done === 1;
  }
}

export type { ProjectRow, ColumnRow };
