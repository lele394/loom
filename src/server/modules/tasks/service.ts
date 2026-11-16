import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import type { SearchService } from '../search/service';
import type { ProjectService } from '../projects/service';
import { AppError, notFound } from '../../core/errors';
import { parseJson, truncate } from '../../core/text';
import { addDays, todayIn } from '../../core/time';
import type { BoardColumn, Task } from '../../../shared/types';
import type { Priority } from '../../../shared/constants';

interface TaskRow {
  id: string;
  column_id: string;
  description: string;
  priority: Priority;
  due_date: string | null;
  start_date: string | null;
  completed_at: string | null;
  position: number;
  checklist_json: string;
  estimate_minutes: number | null;
  metrics_json: string;
}

type Checklist = { id: string; text: string; done: boolean }[];
type Metrics = { name: string; value: number; unit?: string }[];

export interface TaskWithVersion extends Task {
  columnName?: string;
}

export class TaskService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
    private readonly projects: ProjectService,
  ) {}

  private row(id: string): TaskRow {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) throw notFound('Task');
    return row;
  }

  private map(id: string, row?: TaskRow): Task {
    const task = row ?? this.row(id);
    const object = this.objects.requireRow(id);
    const column = this.db
      .prepare('SELECT name FROM board_columns WHERE id = ?')
      .get(task.column_id) as { name: string } | undefined;
    return {
      id,
      title: object.title,
      description: task.description,
      projectId: object.project_id ?? '',
      columnId: task.column_id,
      priority: task.priority,
      dueDate: task.due_date,
      startDate: task.start_date,
      completedAt: task.completed_at,
      position: task.position,
      checklist: parseJson<Checklist>(task.checklist_json, []),
      estimateMinutes: task.estimate_minutes,
      metrics: parseJson<Metrics>(task.metrics_json, []),
      version: object.version,
      createdAt: object.created_at,
      updatedAt: object.updated_at,
    };
  }

  create(
    input: {
      title: string;
      description?: string;
      projectId: string;
      columnId?: string;
      priority?: Priority;
      dueDate?: string | null;
      startDate?: string | null;
      checklist?: Checklist;
      estimateMinutes?: number | null;
      metrics?: Metrics;
    },
    actorId: string,
  ): Task {
    this.objects.ensureProjectWritable(input.projectId);
    if (!this.objects.projectExists(input.projectId)) throw notFound('Project');
    const columnId = input.columnId ?? this.projects.defaultColumnId(input.projectId);
    const column = this.projects.requireColumn(columnId);
    if (column.project_id !== input.projectId) {
      throw new AppError('bad_request', 'The column belongs to another project.');
    }
    const max = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM tasks WHERE column_id = ?')
      .get(columnId) as { max: number };
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      const id = this.objects.insertObject({
        type: 'task',
        title: input.title,
        subtitle: `${column.name}${input.dueDate ? ` · due ${input.dueDate}` : ''}`,
        projectId: input.projectId,
        status: column.is_done === 1 ? 'done' : 'open',
        metadata: { priority: input.priority ?? 'normal' },
        actorId,
      });
      this.db
        .prepare(
          `INSERT INTO tasks (id, column_id, description, priority, due_date, start_date, completed_at, position, checklist_json, estimate_minutes, metrics_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          columnId,
          input.description ?? '',
          input.priority ?? 'normal',
          input.dueDate ?? null,
          input.startDate ?? null,
          column.is_done === 1 ? now : null,
          max.max + 1,
          JSON.stringify(input.checklist ?? []),
          input.estimateMinutes ?? null,
          JSON.stringify(input.metrics ?? []),
        );
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: input.projectId,
        objectId: id,
        objectType: 'task',
        objectTitle: input.title,
        action: 'task.created',
        summary: `Created task "${input.title}"`,
      });
      return id;
    });
    const id = tx();
    return this.map(id);
  }

  get(id: string): Task {
    return this.map(id);
  }

  list(filters: {
    projectId?: string;
    columnId?: string;
    priority?: Priority;
    due?: 'overdue' | 'today' | 'week';
    q?: string;
    limit?: number;
    offset?: number;
    timezone?: string;
  }): Task[] {
    const clauses: string[] = ["o.type = 'task'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('o.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.columnId) {
      clauses.push('t.column_id = ?');
      params.push(filters.columnId);
    }
    if (filters.priority) {
      clauses.push('t.priority = ?');
      params.push(filters.priority);
    }
    if (filters.q) {
      clauses.push('(o.title LIKE ? OR t.description LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    if (filters.due) {
      const today = todayIn(filters.timezone ?? 'UTC', this.clock);
      if (filters.due === 'overdue') {
        clauses.push('t.due_date < ? AND t.completed_at IS NULL');
        params.push(today);
      } else if (filters.due === 'today') {
        clauses.push('t.due_date = ?');
        params.push(today);
      } else {
        clauses.push('t.due_date >= ? AND t.due_date <= ?');
        params.push(today, addDays(today, 7));
      }
    }
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t JOIN objects o ON o.id = t.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date ASC, o.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 50, filters.offset ?? 0) as TaskRow[];
    return rows.map((row) => this.map(row.id, row));
  }

  update(
    id: string,
    input: {
      title?: string;
      description?: string;
      projectId?: string;
      columnId?: string;
      priority?: Priority;
      dueDate?: string | null;
      startDate?: string | null;
      checklist?: Checklist;
      estimateMinutes?: number | null;
      metrics?: Metrics;
    },
    actorId: string,
  ): Task {
    const originalTask = this.row(id);
    const originalObject = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(originalObject.project_id);
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    if (input.projectId && input.projectId !== originalObject.project_id) {
      this.objects.moveToProject(id, input.projectId, actorId);
    }

    const object = this.objects.requireRow(id);
    const task = this.row(id);
    let columnId = task.column_id;
    if (input.columnId && input.columnId !== task.column_id) {
      const column = this.projects.requireColumn(input.columnId);
      if (column.project_id !== object.project_id) {
        throw new AppError('bad_request', 'The column belongs to another project.');
      }
      columnId = input.columnId;
    }
    const columnChanged = columnId !== task.column_id;
    const column = this.projects.requireColumn(columnId);
    const nextTitle = input.title?.trim() || object.title;
    const checklist = input.checklist ?? parseJson<Checklist>(task.checklist_json, []);
    const metrics = input.metrics ?? parseJson<Metrics>(task.metrics_json, []);
    const wasDone = Boolean(task.completed_at);
    const isDone = column.is_done === 1;
    const completedAt = isDone ? task.completed_at ?? this.clock.iso() : null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE tasks SET description = ?, priority = ?, due_date = ?, start_date = ?, checklist_json = ?,
             estimate_minutes = ?, metrics_json = ?, column_id = ?, completed_at = ?
           WHERE id = ?`,
        )
        .run(
          input.description ?? task.description,
          input.priority ?? task.priority,
          input.dueDate === undefined ? task.due_date : input.dueDate,
          input.startDate === undefined ? task.start_date : input.startDate,
          JSON.stringify(checklist),
          input.estimateMinutes === undefined ? task.estimate_minutes : input.estimateMinutes,
          JSON.stringify(metrics),
          columnId,
          completedAt,
          id,
        );
      if (columnChanged) {
        this.reorderForMove(id, task.column_id, columnId, Number.MAX_SAFE_INTEGER);
      }
      const dueDate = input.dueDate === undefined ? task.due_date : input.dueDate;
      this.objects.touch(id, {
        title: nextTitle,
        subtitle: `${column.name}${dueDate ? ` · due ${dueDate}` : ''}`,
        status: completedAt ? 'done' : 'open',
        actorId,
      });
      this.search.indexObject(id);

      if (nextTitle !== originalObject.title) changes.title = { from: originalObject.title, to: nextTitle };
      if (input.priority && input.priority !== originalTask.priority) {
        changes.priority = { from: originalTask.priority, to: input.priority };
      }
      if (columnChanged) changes.column = { from: task.column_id, to: columnId };
      if (input.dueDate !== undefined && input.dueDate !== originalTask.due_date) {
        changes.dueDate = { from: originalTask.due_date, to: input.dueDate };
      }
      if (input.description !== undefined && input.description !== originalTask.description) {
        changes.description = { from: 'changed', to: 'updated' };
      }

      const action = !wasDone && isDone
        ? 'task.completed'
        : wasDone && !isDone
          ? 'task.reopened'
          : columnChanged
            ? 'task.moved'
            : 'task.updated';
      const summary = !wasDone && isDone
        ? `Completed task "${nextTitle}"`
        : wasDone && !isDone
          ? `Reopened task "${nextTitle}"`
          : columnChanged
            ? `Moved task "${nextTitle}" to ${column.name}`
            : `Updated task "${nextTitle}"`;
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'task',
        objectTitle: nextTitle,
        action,
        summary,
        changes: Object.keys(changes).length ? changes : null,
      });
    });
    tx();
    return this.map(id);
  }

  move(id: string, columnId: string, position: number, actorId: string): Task {
    const task = this.row(id);
    const object = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(object.project_id);
    const column = this.projects.requireColumn(columnId);
    if (column.project_id !== object.project_id) {
      throw new AppError('bad_request', 'The column belongs to another project.');
    }
    const tx = this.db.transaction(() => {
      this.reorderForMove(id, task.column_id, columnId, position);
      const completedAt = column.is_done === 1 ? task.completed_at ?? this.clock.iso() : null;
      this.db
        .prepare('UPDATE tasks SET column_id = ?, completed_at = ? WHERE id = ?')
        .run(columnId, completedAt, id);
      this.objects.touch(id, {
        subtitle: `${column.name}${task.due_date ? ` · due ${task.due_date}` : ''}`,
        status: completedAt ? 'done' : 'open',
        actorId,
      });
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'task',
        objectTitle: object.title,
        action: column.is_done === 1 ? 'task.completed' : 'task.moved',
        summary:
          column.is_done === 1
            ? `Completed task "${object.title}"`
            : `Moved task "${object.title}" to ${column.name}`,
        changes: { column: { from: task.column_id, to: columnId } },
      });
    });
    tx();
    return this.map(id);
  }

  private reorderForMove(id: string, fromColumn: string, toColumn: string, position: number): void {
    const fromRows = this.db
      .prepare('SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position ASC, id ASC')
      .all(fromColumn, id) as { id: string }[];
    const renumber = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    fromRows.forEach((row, index) => renumber.run(index, row.id));

    const target = this.db
      .prepare('SELECT id FROM tasks WHERE column_id = ? AND id != ? ORDER BY position ASC, id ASC')
      .all(toColumn, id) as { id: string }[];
    const index = Math.max(0, Math.min(Number.isFinite(position) ? position : target.length, target.length));
    target.splice(index, 0, { id });
    target.forEach((row, positionIndex) => renumber.run(positionIndex, row.id));
  }

  complete(id: string, done: boolean, actorId: string): Task {
    const task = this.row(id);
    const object = this.objects.requireRow(id);
    const projectId = object.project_id;
    if (!projectId) throw new AppError('bad_request', 'Task has no project.');
    if (done) {
      const doneColumn = this.projects.doneColumnId(projectId);
      if (!doneColumn) throw new AppError('bad_request', 'This project has no done column.');
      if (task.completed_at && task.column_id === doneColumn) return this.map(id);
      return this.move(id, doneColumn, Number.MAX_SAFE_INTEGER, actorId);
    }
    if (!task.completed_at) return this.map(id);
    const openColumn = this.projects.defaultColumnId(projectId, true);
    const result = this.move(id, openColumn, Number.MAX_SAFE_INTEGER, actorId);
    this.activity.record({
      actorId,
      projectId,
      objectId: id,
      objectType: 'task',
      objectTitle: object.title,
      action: 'task.reopened',
      summary: `Reopened task "${object.title}"`,
    });
    return result;
  }

  board(projectId: string): { columns: (BoardColumn & { tasks: Task[] })[]; projectId: string } {
    const columns = this.projects.columns(projectId);
    const taskRows = this.db
      .prepare(
        `SELECT t.* FROM tasks t JOIN objects o ON o.id = t.id
         WHERE o.project_id = ? AND o.deleted_at IS NULL
         ORDER BY t.column_id, t.position ASC`,
      )
      .all(projectId) as TaskRow[];
    const byColumn = new Map<string, Task[]>();
    for (const row of taskRows) {
      const list = byColumn.get(row.column_id) ?? [];
      list.push(this.map(row.id, row));
      byColumn.set(row.column_id, list);
    }
    return {
      projectId,
      columns: columns.map((column) => ({
        ...column,
        tasks: byColumn.get(column.id) ?? [],
      })),
    };
  }

  delete(id: string, actorId: string): void {
    this.objects.softDelete(id, actorId);
  }
}
