import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService, ObjectRow } from '../objects/service';
import type { SearchService } from '../search/service';
import type { JobQueue } from '../../worker/jobs';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { parseJson, sanitizeFilename, truncate } from '../../core/text';
import { NOTE_TEMPLATE_BLOCKS, NOTE_TEMPLATE_LABELS, type TemplateBlock } from '../../../shared/templates';
import type { NoteTemplate } from '../../../shared/constants';
import type { Block, Note, NoteVersion } from '../../../shared/types';

interface NoteRow {
  id: string;
  blocks_json: string;
  plain_text: string;
  template: NoteTemplate;
  pinned: number;
  word_count: number;
}

interface VersionRow {
  id: string;
  note_id: string;
  version: number;
  title: string;
  blocks_json: string;
  reason: string;
  created_at: string;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n');
}

function ensureBlocks(blocks: TemplateBlock[] | Block[]): Block[] {
  const seen = new Set<string>();
  return blocks.map((block) => {
    let id = 'id' in block ? block.id : undefined;
    if (!id || seen.has(id)) id = newId('blk');
    seen.add(id);
    return {
      id,
      type: block.type,
      text: block.text ?? '',
      ...(block.meta ? { meta: block.meta } : {}),
    };
  });
}

export class NoteService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
    private readonly jobs: JobQueue,
  ) {}

  create(
    input: {
      title?: string;
      template?: NoteTemplate;
      projectId?: string | null;
      blocks?: TemplateBlock[];
      pinned?: boolean;
    },
    actorId: string,
  ): Note {
    this.objects.ensureProjectWritable(input.projectId ?? null);
    if (input.projectId && !this.objects.projectExists(input.projectId)) throw notFound('Project');
    const template = input.template ?? 'research';
    const sourceBlocks =
      input.blocks && input.blocks.length
        ? input.blocks
        : NOTE_TEMPLATE_BLOCKS[template].map((block) => ({ ...block }));
    if (sourceBlocks.length === 0) sourceBlocks.push({ type: 'paragraph', text: '' });
    if (sourceBlocks.length > 2000) throw new AppError('bad_request', 'Too many blocks.');
    const blocks = ensureBlocks(sourceBlocks);
    const plainText = blocksToPlainText(blocks);
    const title = (input.title ?? '').trim() || 'Untitled note';

    const tx = this.db.transaction(() => {
      const objectId = this.objects.insertObject({
        type: 'note',
        title,
        subtitle: truncate(plainText, 160),
        projectId: input.projectId ?? null,
        status: null,
        metadata: { template },
        actorId,
      });
      this.db
        .prepare(
          `INSERT INTO notes (id, blocks_json, plain_text, template, pinned, word_count)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(objectId, JSON.stringify(blocks), plainText, template, input.pinned ? 1 : 0, countWords(plainText));
      this.search.indexObject(objectId);
      this.syncLinks(objectId, blocks, input.projectId ?? null, actorId);
      this.activity.record({
        actorId,
        projectId: input.projectId ?? null,
        objectId,
        objectType: 'note',
        objectTitle: title,
        action: 'note.created',
        summary: `Created ${NOTE_TEMPLATE_LABELS[template].toLowerCase()} "${title}"`,
      });
      return objectId;
    });
    const objectId = tx();
    return this.get(objectId);
  }

  get(id: string): Note {
    const object = this.objects.requireRow(id);
    if (object.type !== 'note') throw new AppError('bad_request', 'Not a note.');
    const row = this.db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined;
    if (!row) throw notFound('Note');
    return {
      id,
      title: object.title,
      blocks: parseJson<Block[]>(row.blocks_json, []),
      template: row.template,
      pinned: row.pinned === 1,
      plainText: row.plain_text,
      wordCount: row.word_count,
      version: object.version,
      createdAt: object.created_at,
      updatedAt: object.updated_at,
    };
  }

  list(filters: {
    projectId?: string;
    template?: NoteTemplate;
    pinned?: boolean;
    q?: string;
    limit?: number;
    offset?: number;
  }): Note[] {
    const clauses: string[] = ["o.type = 'note'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('o.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.template) {
      clauses.push('n.template = ?');
      params.push(filters.template);
    }
    if (filters.pinned !== undefined) {
      clauses.push('n.pinned = ?');
      params.push(filters.pinned ? 1 : 0);
    }
    if (filters.q) {
      clauses.push('(o.title LIKE ? OR n.plain_text LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }
    const rows = this.db
      .prepare(
        `SELECT o.*, n.blocks_json, n.plain_text, n.template, n.pinned, n.word_count
         FROM objects o JOIN notes n ON n.id = o.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY n.pinned DESC, o.updated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 30, filters.offset ?? 0) as (ObjectRow & NoteRow)[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      blocks: [],
      template: row.template,
      pinned: row.pinned === 1,
      plainText: '',
      wordCount: row.word_count,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  save(
    id: string,
    input: {
      title?: string;
      blocks?: TemplateBlock[];
      pinned?: boolean;
      expectedVersion?: number;
      force?: boolean;
    },
    actorId: string,
  ): Note {
    const current = this.get(id);
    const object = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(object.project_id);
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version &&
      !input.force
    ) {
      throw new AppError('version_conflict', 'This note was modified elsewhere.', {
        currentVersion: current.version,
      });
    }

    const nextBlocks = input.blocks ? ensureBlocks(input.blocks) : current.blocks;
    const nextTitle = input.title?.trim() || current.title || 'Untitled note';
    const plainText = blocksToPlainText(nextBlocks);
    const docBytes = Buffer.byteLength(JSON.stringify(nextBlocks), 'utf8');
    if (docBytes > 4 * 1024 * 1024) {
      throw new AppError('payload_too_large', 'This note is too large to save.');
    }

    const tx = this.db.transaction(() => {
      if (input.force) this.snapshot(id, current, 'pre-overwrite');
      this.db
        .prepare(
          'UPDATE notes SET blocks_json = ?, plain_text = ?, pinned = ?, word_count = ? WHERE id = ?',
        )
        .run(
          JSON.stringify(nextBlocks),
          plainText,
          input.pinned === undefined ? (current.pinned ? 1 : 0) : input.pinned ? 1 : 0,
          countWords(plainText),
          id,
        );
      this.objects.touch(id, {
        title: nextTitle,
        subtitle: truncate(plainText, 160),
        actorId,
      });
      this.search.indexObject(id);
      this.syncLinks(id, nextBlocks, object.project_id, actorId);
      this.maybeSnapshot(id, {
        ...current,
        title: nextTitle,
        blocks: nextBlocks,
        plainText,
        version: current.version + 1,
      });
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'note',
        objectTitle: nextTitle,
        action: 'note.saved',
        summary: `Saved note "${nextTitle}"`,
        changes: {
          ...(nextTitle !== current.title ? { title: { from: current.title, to: nextTitle } } : {}),
          ...(JSON.stringify(nextBlocks) !== JSON.stringify(current.blocks)
            ? { blocks: { from: current.blocks.length, to: nextBlocks.length } }
            : {}),
        },
      });
    });
    tx();
    return this.get(id);
  }

  delete(id: string, actorId: string): void {
    this.objects.softDelete(id, actorId);
  }

  private syncLinks(objectId: string, blocks: Block[], projectId: string | null, actorId: string) {
    const titles = new Set<string>();
    for (const block of blocks) {
      const matches = block.text.matchAll(/\[\[([^\]\n]{1,300})\]\]/g);
      for (const match of matches) {
        const title = match[1]?.trim();
        if (title) titles.add(title);
      }
    }
    const targets: string[] = [];
    for (const title of titles) {
      const rows = this.db
        .prepare('SELECT * FROM objects WHERE title = ? COLLATE NOCASE AND deleted_at IS NULL')
        .all(title) as ObjectRow[];
      if (rows.length === 0) continue;
      const preferred =
        rows.find((row) => row.project_id === projectId) ??
        rows.find((row) => row.project_id === null) ??
        rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      if (preferred) targets.push(preferred.id);
    }
    this.objects.syncMentionLinks(objectId, targets);
  }

  private snapshot(noteId: string, note: Note, reason: string): void {
    this.db
      .prepare(
        `INSERT INTO note_versions (id, note_id, version, title, blocks_json, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId('ver'),
        noteId,
        note.version,
        note.title,
        JSON.stringify(note.blocks),
        reason,
        this.clock.iso(),
      );
    this.db
      .prepare(
        `DELETE FROM note_versions WHERE note_id = ? AND id NOT IN (
           SELECT id FROM note_versions WHERE note_id = ? ORDER BY version DESC LIMIT 50
         )`,
      )
      .run(noteId, noteId);
  }

  private maybeSnapshot(noteId: string, note: Note): void {
    const last = this.db
      .prepare('SELECT created_at FROM note_versions WHERE note_id = ? ORDER BY version DESC LIMIT 1')
      .get(noteId) as { created_at: string } | undefined;
    if (last) {
      const age = this.clock.now().getTime() - new Date(last.created_at).getTime();
      if (age < 5 * 60_000) return;
    }
    this.snapshot(noteId, note, 'autosave');
  }

  versions(noteId: string): NoteVersion[] {
    this.objects.requireRow(noteId);
    const rows = this.db
      .prepare(
        'SELECT id, note_id, version, title, reason, created_at FROM note_versions WHERE note_id = ? ORDER BY version DESC',
      )
      .all(noteId) as Omit<VersionRow, 'blocks_json'>[];
    return rows.map((row) => ({
      id: row.id,
      noteId: row.note_id,
      version: row.version,
      title: row.title,
      reason: row.reason,
      createdAt: row.created_at,
    }));
  }

  getVersion(noteId: string, version: number): { blocks: Block[]; title: string; createdAt: string } {
    const row = this.db
      .prepare('SELECT * FROM note_versions WHERE note_id = ? AND version = ?')
      .get(noteId, version) as VersionRow | undefined;
    if (!row) throw notFound('Note version');
    return { blocks: parseJson<Block[]>(row.blocks_json, []), title: row.title, createdAt: row.created_at };
  }

  restoreVersion(noteId: string, version: number, actorId: string): Note {
    const snapshot = this.getVersion(noteId, version);
    return this.save(
      noteId,
      { title: snapshot.title, blocks: snapshot.blocks, force: true },
      actorId,
    );
  }

  markdown(id: string): string {
    const note = this.get(id);
    const object = this.objects.requireRow(id);
    const project = object.project_id
      ? (this.db.prepare('SELECT name FROM projects WHERE id = ?').get(object.project_id) as { name: string } | undefined)
      : undefined;
    const tags = this.objects.getObjectTags(id).map((tag) => tag.name);
    const frontmatter = [
      '---',
      `id: ${note.id}`,
      `title: ${JSON.stringify(note.title)}`,
      `project: ${JSON.stringify(project?.name ?? 'Unfiled')}`,
      `template: ${note.template}`,
      `tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
      `created: ${note.createdAt}`,
      `updated: ${note.updatedAt}`,
      '---',
      '',
    ].join('\n');
    return frontmatter + renderBlocks(note.blocks);
  }

  filename(id: string): string {
    const note = this.get(id);
    return `${sanitizeFilename(note.title, 80)}.md`;
  }
}

export function renderBlocks(blocks: Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const text = block.text;
    switch (block.type) {
      case 'h1':
        lines.push(`# ${text}`);
        break;
      case 'h2':
        lines.push(`## ${text}`);
        break;
      case 'h3':
        lines.push(`### ${text}`);
        break;
      case 'bullet':
        lines.push(`- ${text}`);
        break;
      case 'numbered':
        lines.push(`1. ${text}`);
        break;
      case 'todo':
        lines.push(`- [${block.meta?.checked ? 'x' : ' '}] ${text}`);
        break;
      case 'quote':
        lines.push(`> ${text.replace(/\n/g, '\n> ')}`);
        break;
      case 'code':
        lines.push(`\`\`\`${block.meta?.language ?? ''}\n${text}\n\`\`\``);
        break;
      case 'callout':
        lines.push(`> [!${block.meta?.tone ?? 'info'}]\n> ${text.replace(/\n/g, '\n> ')}`);
        break;
      case 'divider':
        lines.push('---');
        break;
      case 'equation':
        lines.push(`$$\n${text}\n$$`);
        break;
      default:
        lines.push(text);
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}
