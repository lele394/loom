import type { Db } from '../db/index';
import { parseJson } from '../core/text';
import type { ObjectType } from '../../shared/constants';

export interface TypeBody {
  subtitle: string;
  text: string;
  status: string | null;
}

export interface ObjectTypeDefinition {
  type: ObjectType;
  label: string;
  plural: string;
  icon: string;
  route: (id: string) => string;
  body: (db: Db, objectId: string) => TypeBody;
}

function firstLine(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export const objectTypes: Record<ObjectType, ObjectTypeDefinition> = {
  note: {
    type: 'note',
    label: 'Note',
    plural: 'Notes',
    icon: 'note',
    route: (id) => `/notes/${id}`,
    body(db, id) {
      const row = db.prepare('SELECT plain_text, template FROM notes WHERE id = ?').get(id) as
        | { plain_text: string; template: string }
        | undefined;
      if (!row) return { subtitle: '', text: '', status: null };
      return {
        subtitle: firstLine(row.plain_text) || `Note · ${row.template}`,
        text: row.plain_text,
        status: null,
      };
    },
  },
  task: {
    type: 'task',
    label: 'Task',
    plural: 'Tasks',
    icon: 'task',
    route: (id) => `/objects/${id}`,
    body(db, id) {
      const row = db
        .prepare(
          `SELECT t.description, t.priority, t.due_date, t.completed_at, t.checklist_json, c.name AS column_name
           FROM tasks t JOIN board_columns c ON c.id = t.column_id WHERE t.id = ?`,
        )
        .get(id) as
        | {
            description: string;
            priority: string;
            due_date: string | null;
            completed_at: string | null;
            checklist_json: string;
            column_name: string;
          }
        | undefined;
      if (!row) return { subtitle: '', text: '', status: null };
      const checklist = parseJson<{ text: string }[]>(row.checklist_json, []);
      const text = [
        row.description,
        row.column_name,
        row.priority,
        row.due_date ?? '',
        checklist.map((item) => item.text).join(' '),
      ].join(' ');
      return {
        subtitle: `${row.column_name}${row.due_date ? ` · due ${row.due_date}` : ''}`,
        text,
        status: row.completed_at ? 'done' : 'open',
      };
    },
  },
  reference: {
    type: 'reference',
    label: 'Reference',
    plural: 'Literature',
    icon: 'book',
    route: (id) => `/literature/${id}`,
    body(db, id) {
      const row = db
        .prepare(
          `SELECT l.authors_json, l.venue, l.year, l.abstract, l.notes, l.reading_status, l.doi,
                  l.extra_json, l.ai_summary, o.title
           FROM literature l JOIN objects o ON o.id = l.id WHERE l.id = ?`,
        )
        .get(id) as
        | {
            authors_json: string;
            venue: string;
            year: number | null;
            abstract: string;
            notes: string;
            reading_status: string;
            doi: string | null;
            extra_json: string;
            ai_summary: string;
            title: string;
          }
        | undefined;
      if (!row) return { subtitle: '', text: '', status: null };
      const authors = parseJson<string[]>(row.authors_json, []);
      const extra = parseJson<Record<string, unknown>>(row.extra_json, {});
      const extraText = Object.values(extra)
        .filter((value) => typeof value === 'string')
        .join(' ');
      return {
        subtitle: [authors.slice(0, 3).join(', '), row.year, row.venue].filter(Boolean).join(' · '),
        text: [
          authors.join(', '),
          row.venue,
          row.year ?? '',
          row.doi ?? '',
          row.abstract,
          row.notes,
          row.ai_summary,
          extraText,
        ].join(' '),
        status: row.reading_status,
      };
    },
  },
  experiment: {
    type: 'experiment',
    label: 'Experiment',
    plural: 'Experiments',
    icon: 'flask',
    route: (id) => `/experiments/${id}`,
    body(db, id) {
      const row = db
        .prepare(
          'SELECT objective, hypothesis, method, results, environment_json, metrics_json, status FROM experiments WHERE id = ?',
        )
        .get(id) as
        | {
            objective: string;
            hypothesis: string;
            method: string;
            results: string;
            environment_json: string;
            metrics_json: string;
            status: string;
          }
        | undefined;
      if (!row) return { subtitle: '', text: '', status: null };
      const environment = parseJson<Record<string, string>>(row.environment_json, {});
      const metrics = parseJson<{ name: string; value: number; unit?: string }[]>(row.metrics_json, []);
      return {
        subtitle: firstLine(row.objective) || `Experiment · ${row.status}`,
        text: [
          row.objective,
          row.hypothesis,
          row.method,
          row.results,
          Object.entries(environment).map(([k, v]) => `${k} ${v}`).join(' '),
          metrics.map((m) => `${m.name} ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join(' '),
          row.status,
        ].join(' '),
        status: row.status,
      };
    },
  },
  question: {
    type: 'question',
    label: 'Question',
    plural: 'Questions',
    icon: 'help',
    route: (id) => `/objects/${id}`,
    body(db, id) {
      const row = db
        .prepare('SELECT context, status FROM questions WHERE id = ?')
        .get(id) as { context: string; status: string } | undefined;
      if (!row) return { subtitle: '', text: '', status: null };
      return {
        subtitle: firstLine(row.context) || `Question · ${row.status}`,
        text: `${row.context} ${row.status}`,
        status: row.status,
      };
    },
  },
};

export function typeDefinition(type: string): ObjectTypeDefinition | undefined {
  return objectTypes[type as ObjectType];
}

export function isObjectType(type: string): type is ObjectType {
  return type in objectTypes;
}
