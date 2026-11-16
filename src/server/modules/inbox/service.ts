import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { NoteService } from '../notes/service';
import type { TaskService } from '../tasks/service';
import type { LiteratureService } from '../literature/service';
import type { ExperimentService } from '../experiments/service';
import type { QuestionService } from '../questions/service';
import type { InboxKind } from '../../../shared/constants';
import { AppError, ensureFound, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { truncate } from '../../core/text';
import type { InboxItem } from '../../../shared/types';

interface InboxRow {
  id: string;
  body: string;
  kind: InboxKind;
  status: 'new' | 'triaged' | 'archived';
  project_id: string | null;
  triaged_object_id: string | null;
  created_at: string;
  updated_at: string;
  triaged_at: string | null;
}

function mapItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    body: row.body,
    kind: row.kind,
    status: row.status,
    projectId: row.project_id,
    triagedObjectId: row.triaged_object_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    triagedAt: row.triaged_at,
  };
}

export class InboxService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly notes: NoteService,
    private readonly tasks: TaskService,
    private readonly literature: LiteratureService,
    private readonly experiments: ExperimentService,
    private readonly questions: QuestionService,
  ) {}

  capture(input: { body: string; kind?: InboxKind; projectId?: string | null }, actorId: string): InboxItem {
    const id = newId('inb');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO inbox_items (id, body, kind, status, project_id, created_at, updated_at)
         VALUES (?, ?, ?, 'new', ?, ?, ?)`,
      )
      .run(id, input.body.trim(), input.kind ?? 'idea', input.projectId ?? null, now, now);
    this.activity.record({
      actorId,
      projectId: input.projectId ?? null,
      action: 'inbox.captured',
      summary: `Captured an inbox ${input.kind ?? 'idea'}: "${truncate(input.body, 80)}"`,
    });
    return this.get(id);
  }

  private row(id: string): InboxRow {
    const row = this.db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id) as InboxRow | undefined;
    if (!row) throw notFound('Inbox item');
    return row;
  }

  get(id: string): InboxItem {
    return mapItem(this.row(id));
  }

  list(status: 'new' | 'triaged' | 'archived' = 'new', limit = 100): InboxItem[] {
    const rows = this.db
      .prepare('SELECT * FROM inbox_items WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(status, limit) as InboxRow[];
    return rows.map(mapItem);
  }

  countNew(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM inbox_items WHERE status = 'new'").get() as {
      count: number;
    }).count;
  }

  archive(id: string, actorId: string): InboxItem {
    const row = this.row(id);
    this.db
      .prepare("UPDATE inbox_items SET status = 'archived', updated_at = ? WHERE id = ?")
      .run(this.clock.iso(), id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'inbox.archived',
      summary: `Archived inbox item "${truncate(row.body, 60)}"`,
    });
    return this.get(id);
  }

  delete(id: string, actorId: string): void {
    const row = this.row(id);
    this.db.prepare('DELETE FROM inbox_items WHERE id = ?').run(id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'inbox.deleted',
      summary: `Deleted inbox item "${truncate(row.body, 60)}"`,
    });
  }

  convert(
    id: string,
    input: {
      to: 'note' | 'task' | 'reference' | 'experiment' | 'question';
      projectId?: string | null;
      title?: string;
      overrides?: Record<string, unknown>;
    },
    actorId: string,
  ): { item: InboxItem; objectId: string; type: string } {
    const row = this.row(id);
    if (row.status === 'triaged' && row.triaged_object_id) {
      return { item: this.get(id), objectId: row.triaged_object_id, type: input.to };
    }
    const projectId = input.projectId === undefined ? row.project_id : input.projectId;
    const firstLine = row.body.split(/\r?\n/)[0] ?? 'Untitled';
    const title = (input.title ?? '').trim() || truncate(firstLine, 120);
    const overrides = input.overrides ?? {};
    let objectId: string;

    switch (input.to) {
      case 'note': {
        const note = this.notes.create(
          {
            title,
            projectId: projectId ?? null,
            template: 'research',
            blocks: [
              { type: 'paragraph', text: row.body },
              ...((overrides.blocks as never) ?? []),
            ],
          },
          actorId,
        );
        objectId = note.id;
        break;
      }
      case 'task': {
        if (!projectId) throw new AppError('bad_request', 'Choose a project before converting to a task.');
        const task = this.tasks.create(
          {
            title,
            description: row.body,
            projectId,
            ...(overrides as Record<string, never>),
          },
          actorId,
        );
        objectId = task.id;
        break;
      }
      case 'reference': {
        const reference = this.literature.create(
          {
            title,
            abstract: row.body,
            projectId: projectId ?? null,
            ...(overrides as Record<string, never>),
          },
          actorId,
        );
        objectId = reference.id;
        break;
      }
      case 'experiment': {
        const experiment = this.experiments.create(
          {
            title,
            objective: row.body,
            projectId: projectId ?? null,
            ...(overrides as Record<string, never>),
          },
          actorId,
        );
        objectId = experiment.id;
        break;
      }
      case 'question': {
        const question = this.questions.create(
          {
            question: title,
            context: row.body,
            projectId: projectId ?? null,
            ...(overrides as Record<string, never>),
          },
          actorId,
        );
        objectId = question.id;
        break;
      }
      default:
        throw new AppError('bad_request', 'Unknown conversion target.');
    }

    const now = this.clock.iso();
    this.db
      .prepare(
        "UPDATE inbox_items SET status = 'triaged', triaged_object_id = ?, triaged_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(objectId, now, now, id);
    this.activity.record({
      actorId,
      projectId: projectId ?? null,
      objectId,
      objectType: input.to,
      objectTitle: title,
      action: 'inbox.triaged',
      summary: `Triaged inbox capture into ${input.to} "${title}"`,
    });
    return { item: this.get(id), objectId, type: input.to };
  }
}
