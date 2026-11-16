import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import type { SearchService } from '../search/service';
import type { NoteService } from '../notes/service';
import type { LinkKind, QuestionStatus } from '../../../shared/constants';
import { ensureFound, notFound } from '../../core/errors';
import { truncate } from '../../core/text';
import type { Question } from '../../../shared/types';

interface QuestionRow {
  id: string;
  context: string;
  status: QuestionStatus;
  answer_note_id: string | null;
  answered_at: string | null;
}

export class QuestionService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
    private readonly notes: NoteService,
  ) {}

  private row(id: string): QuestionRow {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as
      | QuestionRow
      | undefined;
    if (!row) throw notFound('Question');
    return row;
  }

  private map(id: string, row?: QuestionRow): Question {
    const question = row ?? this.row(id);
    const object = this.objects.requireRow(id);
    return {
      id,
      title: object.title,
      projectId: object.project_id,
      context: question.context,
      status: question.status,
      answerNoteId: question.answer_note_id,
      answeredAt: question.answered_at,
      version: object.version,
    };
  }

  create(
    input: { question: string; projectId?: string | null; context?: string; status?: QuestionStatus },
    actorId: string,
  ): Question {
    this.objects.ensureProjectWritable(input.projectId ?? null);
    if (input.projectId && !this.objects.projectExists(input.projectId)) throw notFound('Project');
    const status = input.status ?? 'open';
    const tx = this.db.transaction(() => {
      const id = this.objects.insertObject({
        type: 'question',
        title: input.question.trim(),
        subtitle: truncate(input.context ?? '', 160) || `Question · ${status}`,
        projectId: input.projectId ?? null,
        status,
        actorId,
      });
      this.db
        .prepare('INSERT INTO questions (id, context, status) VALUES (?, ?, ?)')
        .run(id, input.context ?? '', status);
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: input.projectId ?? null,
        objectId: id,
        objectType: 'question',
        objectTitle: input.question,
        action: 'question.created',
        summary: `Opened research question "${input.question}"`,
      });
      return id;
    });
    return this.map(tx());
  }

  get(id: string): Question {
    return this.map(id);
  }

  list(filters: { projectId?: string; status?: QuestionStatus; limit?: number; offset?: number }): Question[] {
    const clauses: string[] = ["o.type = 'question'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('o.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.status) {
      clauses.push('q.status = ?');
      params.push(filters.status);
    }
    const rows = this.db
      .prepare(
        `SELECT q.* FROM questions q JOIN objects o ON o.id = q.id
         WHERE ${clauses.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 50, filters.offset ?? 0) as QuestionRow[];
    return rows.map((row) => this.map(row.id, row));
  }

  update(
    id: string,
    input: { question?: string; projectId?: string | null; context?: string; status?: QuestionStatus },
    actorId: string,
  ): Question {
    const current = this.map(id);
    const object = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(object.project_id);
    if (input.projectId !== undefined && input.projectId !== object.project_id) {
      this.objects.moveToProject(id, input.projectId, actorId);
    }
    const title = input.question?.trim() || object.title;
    const status = input.status ?? current.status;
    const context = input.context ?? current.context;
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE questions SET context = ?, status = ? WHERE id = ?').run(context, status, id);
      this.objects.touch(id, {
        title,
        subtitle: truncate(context, 160) || `Question · ${status}`,
        status,
        actorId,
      });
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'question',
        objectTitle: title,
        action: status !== current.status ? 'question.status_changed' : 'question.updated',
        summary:
          status !== current.status ? `Question "${title}" is now ${status}` : `Updated question "${title}"`,
        changes: status !== current.status ? { status: { from: current.status, to: status } } : null,
      });
    });
    tx();
    return this.map(id);
  }

  answer(id: string, input: { noteId?: string; text?: string }, actorId: string): Question {
    const current = this.map(id);
    if (current.status === 'answered' && current.answerNoteId) return current;
    let noteId = input.noteId;
    if (noteId) {
      const note = this.objects.getRow(noteId);
      if (!note || note.type !== 'note') throw notFound('Note');
    } else {
      const note = this.notes.create(
        {
          title: `Answer: ${truncate(current.title, 220)}`,
          projectId: current.projectId,
          template: 'research',
          blocks: [
            { type: 'h2', text: 'Question' },
            { type: 'quote', text: current.title },
            { type: 'h2', text: 'Answer' },
            { type: 'paragraph', text: input.text ?? '' },
          ],
        },
        actorId,
      );
      noteId = note.id;
    }
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE questions SET answer_note_id = ?, status = 'answered', answered_at = ? WHERE id = ?")
        .run(noteId, this.clock.iso(), id);
      this.objects.touch(id, {
        status: 'answered',
        subtitle: `Answered · ${truncate(current.title, 120)}`,
        actorId,
      });
      this.objects.createLink(noteId, id, 'answers' as LinkKind, actorId);
      this.activity.record({
        actorId,
        projectId: current.projectId,
        objectId: id,
        objectType: 'question',
        objectTitle: current.title,
        action: 'question.answered',
        summary: `Answered question "${current.title}"`,
      });
    });
    tx();
    return this.map(id);
  }

  delete(id: string, actorId: string): void {
    this.objects.softDelete(id, actorId);
  }
}
