import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import { AppError, ensureFound, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { parseJson } from '../../core/text';
import { objectTypes, typeDefinition } from '../../core/registry';
import type { LinkKind, ObjectType } from '../../../shared/constants';
import type {
  Attachment,
  LinkWithObject,
  ObjectEnvelope,
  ObjectSummary,
  Tag,
} from '../../../shared/types';

export interface ObjectRow {
  id: string;
  type: ObjectType;
  title: string;
  subtitle: string;
  project_id: string | null;
  status: string | null;
  version: number;
  favorite: number;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  deleted_at: string | null;
}

interface LinkRow {
  id: string;
  source_id: string;
  target_id: string;
  kind: LinkKind;
  anchor: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface TagRow {
  id: string;
  name: string;
  color: string;
  count?: number;
}

export interface InsertObjectInput {
  type: ObjectType;
  title: string;
  subtitle?: string;
  projectId?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown>;
  actorId: string;
}

export function mapObject(row: ObjectRow): ObjectSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    subtitle: row.subtitle,
    projectId: row.project_id,
    status: row.status,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTag(row: TagRow): Tag {
  return { id: row.id, name: row.name, color: row.color, ...(row.count !== undefined ? { count: row.count } : {}) };
}

export class ObjectService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
  ) {}

  // ── Object rows ────────────────────────────────────────────────────────
  insertObject(input: InsertObjectInput): string {
    const id = newId('obj');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO objects (id, type, title, subtitle, project_id, status, version, favorite, metadata_json, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.type,
        input.title,
        input.subtitle ?? '',
        input.projectId ?? null,
        input.status ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
        input.actorId,
        input.actorId,
      );
    return id;
  }

  getRow(id: string, includeDeleted = false): ObjectRow | null {
    const row = this.db.prepare('SELECT * FROM objects WHERE id = ?').get(id) as ObjectRow | undefined;
    if (!row) return null;
    if (!includeDeleted && row.deleted_at) return null;
    return row;
  }

  requireRow(id: string, includeDeleted = false): ObjectRow {
    return ensureFound(this.getRow(id, includeDeleted), 'Object');
  }

  summary(id: string): ObjectSummary {
    return mapObject(this.requireRow(id));
  }

  /** Refresh the mirrored fields on the supertype row and bump the concurrency version. */
  touch(
    id: string,
    patch: {
      title?: string;
      subtitle?: string;
      status?: string | null;
      metadata?: Record<string, unknown>;
      projectId?: string | null;
      actorId: string;
    },
  ): ObjectRow {
    const current = this.requireRow(id);
    const now = this.clock.iso();
    this.db
      .prepare(
        `UPDATE objects SET title = ?, subtitle = ?, status = ?, metadata_json = ?, project_id = ?,
           version = version + 1, updated_at = ?, updated_by = ?
         WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.subtitle ?? current.subtitle,
        patch.status === undefined ? current.status : patch.status,
        JSON.stringify(patch.metadata ?? parseJson(current.metadata_json, {})),
        patch.projectId === undefined ? current.project_id : patch.projectId,
        now,
        patch.actorId,
        id,
      );
    return this.requireRow(id);
  }

  bumpVersion(id: string, actorId: string): number {
    this.db
      .prepare('UPDATE objects SET version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(this.clock.iso(), actorId, id);
    return (this.db.prepare('SELECT version FROM objects WHERE id = ?').get(id) as { version: number }).version;
  }

  refreshSubtitle(id: string): void {
    const row = this.getRow(id);
    if (!row) return;
    const body = typeDefinition(row.type)?.body(this.db, id);
    if (body) {
      this.db.prepare('UPDATE objects SET subtitle = ? WHERE id = ?').run(body.subtitle, id);
    }
  }

  ensureProjectWritable(projectId: string | null | undefined): void {
    if (!projectId) return;
    const project = this.db
      .prepare('SELECT status, deleted_at FROM projects WHERE id = ?')
      .get(projectId) as { status: string; deleted_at: string | null } | undefined;
    if (!project || project.deleted_at) throw notFound('Project');
    if (project.status === 'archived') throw new AppError('project_archived');
  }

  projectExists(projectId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(projectId);
    return Boolean(row);
  }

  setFavorite(id: string, favorite: boolean, actorId: string): ObjectSummary {
    const row = this.requireRow(id);
    this.db
      .prepare('UPDATE objects SET favorite = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(favorite ? 1 : 0, this.clock.iso(), actorId, id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      objectId: id,
      objectType: row.type,
      objectTitle: row.title,
      action: 'object.favorited',
      summary: `${favorite ? 'Starred' : 'Unstarred'} ${row.type} "${row.title}"`,
      changes: { favorite: { from: !favorite, to: favorite } },
    });
    return this.summary(id);
  }

  moveToProject(id: string, projectId: string | null, actorId: string): ObjectSummary {
    const row = this.requireRow(id);
    if (projectId) {
      this.ensureProjectWritable(projectId);
      if (!this.projectExists(projectId)) throw notFound('Project');
    }
    if (row.type === 'task' && !projectId) {
      throw new AppError('bad_request', 'Tasks must belong to a project.');
    }
    const targetName = projectId
      ? (
          this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as {
            name: string;
          }
        ).name
      : 'Unfiled';
    this.db
      .prepare('UPDATE objects SET project_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?')
      .run(projectId, this.clock.iso(), actorId, id);
    if (row.type === 'task' && projectId) {
      const column = this.db
        .prepare(
          'SELECT id FROM board_columns WHERE project_id = ? ORDER BY is_done ASC, position ASC LIMIT 1',
        )
        .get(projectId) as { id: string } | undefined;
      if (!column) throw new AppError('bad_request', 'The target project has no board columns.');
      const max = this.db
        .prepare('SELECT COALESCE(MAX(position), -1) AS max FROM tasks WHERE column_id = ?')
        .get(column.id) as { max: number };
      this.db
        .prepare('UPDATE tasks SET column_id = ?, position = ?, completed_at = NULL WHERE id = ?')
        .run(column.id, max.max + 1, id);
    }
    this.activity.record({
      actorId,
      projectId,
      objectId: id,
      objectType: row.type,
      objectTitle: row.title,
      action: 'object.moved',
      summary: `Moved ${row.type} "${row.title}" to ${targetName}`,
      changes: { project: { from: row.project_id, to: projectId } },
    });
    return this.summary(id);
  }

  softDelete(id: string, actorId: string, source: 'ui' | 'api' | 'job' | 'ai' = 'ui'): void {
    const row = this.requireRow(id);
    const now = this.clock.iso();
    this.db
      .prepare('UPDATE objects SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ?')
      .run(now, now, actorId, id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      objectId: id,
      objectType: row.type,
      objectTitle: row.title,
      action: `${row.type}.deleted`,
      summary: `Moved ${row.type} "${row.title}" to trash`,
      source,
    });
  }

  restore(id: string, actorId: string): ObjectSummary {
    const row = this.requireRow(id, true);
    if (!row.deleted_at) return mapObject(row);
    let projectId = row.project_id;
    if (projectId) {
      const project = this.db
        .prepare('SELECT deleted_at FROM projects WHERE id = ?')
        .get(projectId) as { deleted_at: string | null } | undefined;
      if (!project || project.deleted_at) projectId = null;
    }
    const now = this.clock.iso();
    this.db
      .prepare(
        'UPDATE objects SET deleted_at = NULL, project_id = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?',
      )
      .run(projectId, now, actorId, id);
    this.activity.record({
      actorId,
      projectId,
      objectId: id,
      objectType: row.type,
      objectTitle: row.title,
      action: `${row.type}.restored`,
      summary: `Restored ${row.type} "${row.title}" from trash`,
    });
    return this.summary(id);
  }

  /** Hard delete. Activity is retained; FTS rows are removed explicitly. */
  purge(id: string, actorId: string): void {
    const row = this.requireRow(id, true);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      objectId: id,
      objectType: row.type,
      objectTitle: row.title,
      action: 'object.purged',
      summary: `Permanently deleted ${row.type} "${row.title}"`,
      source: 'api',
    });
    this.db.prepare('DELETE FROM search_fts WHERE object_id = ?').run(id);
    this.db.prepare('DELETE FROM chunks_fts WHERE object_id = ?').run(id);
    this.db.prepare('DELETE FROM objects WHERE id = ?').run(id);
  }

  purgeExpired(actorId: string, days = 30): number {
    const cutoff = new Date(this.clock.now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const rows = this.db
      .prepare('SELECT id FROM objects WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 500')
      .all(cutoff) as { id: string }[];
    for (const row of rows) this.purge(row.id, actorId);
    return rows.length;
  }

  listDeleted(limit = 200): ObjectSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM objects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?')
      .all(limit) as ObjectRow[];
    return rows.map(mapObject);
  }

  list(filters: {
    type?: ObjectType;
    projectId?: string | null;
    tag?: string;
    favorite?: boolean;
    status?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }): ObjectSummary[] {
    const clauses: string[] = ['o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.type) {
      clauses.push('o.type = ?');
      params.push(filters.type);
    }
    if (filters.projectId !== undefined) {
      if (filters.projectId === null) clauses.push('o.project_id IS NULL');
      else {
        clauses.push('o.project_id = ?');
        params.push(filters.projectId);
      }
    }
    if (filters.status) {
      clauses.push('o.status = ?');
      params.push(filters.status);
    }
    if (filters.favorite) clauses.push('o.favorite = 1');
    if (filters.q) {
      clauses.push('o.title LIKE ?');
      params.push(`%${filters.q}%`);
    }
    if (filters.tag) {
      clauses.push(
        'EXISTS (SELECT 1 FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = o.id AND t.name = ? COLLATE NOCASE)',
      );
      params.push(filters.tag);
    }
    const rows = this.db
      .prepare(
        `SELECT o.* FROM objects o WHERE ${clauses.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 50, filters.offset ?? 0) as ObjectRow[];
    return rows.map(mapObject);
  }

  // ── Tags ───────────────────────────────────────────────────────────────
  listTags(withCounts = true): Tag[] {
    if (!withCounts) {
      return (this.db.prepare('SELECT * FROM tags ORDER BY name').all() as TagRow[]).map(mapTag);
    }
    const rows = this.db
      .prepare(
        `SELECT t.*, COUNT(ot.object_id) AS count FROM tags t
         LEFT JOIN object_tags ot ON ot.tag_id = t.id
         GROUP BY t.id ORDER BY t.name`,
      )
      .all() as TagRow[];
    return rows.map(mapTag);
  }

  getObjectTags(objectId: string): Tag[] {
    const rows = this.db
      .prepare(
        'SELECT t.* FROM tags t JOIN object_tags ot ON ot.tag_id = t.id WHERE ot.object_id = ? ORDER BY t.name',
      )
      .all(objectId) as TagRow[];
    return rows.map(mapTag);
  }

  createTag(name: string, color: string, actorId: string): Tag {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError('bad_request', 'Tag name is required.');
    const existing = this.db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as
      | TagRow
      | undefined;
    if (existing) return mapTag(existing);
    const id = newId('tag');
    try {
      this.db
        .prepare('INSERT INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)')
        .run(id, trimmed, color, this.clock.iso());
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) {
        return mapTag(
          this.db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE').get(trimmed) as TagRow,
        );
      }
      throw error;
    }
    this.activity.record({
      actorId,
      action: 'tag.created',
      summary: `Created tag "${trimmed}"`,
    });
    return { id, name: trimmed, color, count: 0 };
  }

  updateTag(id: string, patch: { name?: string; color?: string }, actorId: string): Tag {
    const row = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
    if (!row) throw notFound('Tag');
    try {
      this.db
        .prepare('UPDATE tags SET name = ?, color = ? WHERE id = ?')
        .run(patch.name ?? row.name, patch.color ?? row.color, id);
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) throw new AppError('duplicate', 'A tag with that name exists.');
      throw error;
    }
    this.activity.record({
      actorId,
      action: 'tag.updated',
      summary: `Renamed/recoloured tag "${patch.name ?? row.name}"`,
    });
    const updated = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow;
    return mapTag(updated);
  }

  deleteTag(id: string, actorId: string): void {
    const row = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRow | undefined;
    if (!row) throw notFound('Tag');
    this.db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    this.activity.record({
      actorId,
      action: 'tag.deleted',
      summary: `Deleted tag "${row.name}"`,
    });
  }

  setTags(objectId: string, tagIds: string[], actorId: string): Tag[] {
    const object = this.requireRow(objectId);
    if (tagIds.length > 30) throw new AppError('bad_request', 'Maximum 30 tags per object.');
    if (tagIds.length) {
      const placeholders = tagIds.map(() => '?').join(',');
      const found = this.db
        .prepare(`SELECT id FROM tags WHERE id IN (${placeholders})`)
        .all(...tagIds) as { id: string }[];
      if (found.length !== new Set(tagIds).size) throw new AppError('bad_request', 'Unknown tag id.');
    }
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM object_tags WHERE object_id = ?').run(objectId);
      const insert = this.db.prepare('INSERT INTO object_tags (object_id, tag_id) VALUES (?, ?)');
      for (const tagId of new Set(tagIds)) insert.run(objectId, tagId);
      this.db
        .prepare('UPDATE objects SET updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?')
        .run(this.clock.iso(), actorId, objectId);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId,
        objectType: object.type,
        objectTitle: object.title,
        action: 'object.tagged',
        summary: `Updated tags on ${object.type} "${object.title}"`,
      });
    });
    tx();
    return this.getObjectTags(objectId);
  }

  // ── Links ──────────────────────────────────────────────────────────────
  private linkRow(id: string): LinkRow | undefined {
    return this.db.prepare('SELECT * FROM links WHERE id = ?').get(id) as LinkRow | undefined;
  }

  private mapLink(row: LinkRow, other: ObjectRow): LinkWithObject {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      kind: row.kind,
      anchor: row.anchor,
      createdAt: row.created_at,
      object: mapObject(other),
    };
  }

  linksFor(objectId: string): LinkWithObject[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM links WHERE source_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(objectId) as LinkRow[];
    return rows.flatMap((row) => {
      const target = this.getRow(row.target_id);
      return target ? [this.mapLink(row, target)] : [];
    });
  }

  backlinksFor(objectId: string): LinkWithObject[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM links WHERE target_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(objectId) as LinkRow[];
    return rows.flatMap((row) => {
      const source = this.getRow(row.source_id);
      return source ? [this.mapLink(row, source)] : [];
    });
  }

  createLink(
    sourceId: string,
    targetId: string,
    kind: LinkKind,
    actorId: string,
    anchor?: string,
  ): LinkWithObject {
    if (sourceId === targetId) throw new AppError('bad_request', 'An object cannot link to itself.');
    const source = this.requireRow(sourceId);
    const target = this.requireRow(targetId);
    const existing = this.db
      .prepare('SELECT * FROM links WHERE source_id = ? AND target_id = ? AND kind = ?')
      .get(sourceId, targetId, kind) as LinkRow | undefined;
    let linkId: string;
    if (existing) {
      if (existing.deleted_at) {
        this.db.prepare('UPDATE links SET deleted_at = NULL WHERE id = ?').run(existing.id);
      }
      linkId = existing.id;
    } else {
      linkId = newId('lnk');
      this.db
        .prepare(
          'INSERT INTO links (id, source_id, target_id, kind, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(linkId, sourceId, targetId, kind, anchor ?? null, this.clock.iso());
    }
    this.activity.record({
      actorId,
      projectId: source.project_id,
      objectId: sourceId,
      objectType: source.type,
      objectTitle: source.title,
      action: 'link.created',
      summary: `Linked ${source.type} "${source.title}" to ${target.type} "${target.title}"`,
    });
    return this.mapLink(this.linkRow(linkId)!, target);
  }

  removeLink(linkId: string, actorId: string): void {
    const row = this.linkRow(linkId);
    if (!row || row.deleted_at) throw notFound('Link');
    this.db.prepare('UPDATE links SET deleted_at = ? WHERE id = ?').run(this.clock.iso(), linkId);
    const source = this.getRow(row.source_id, true);
    this.activity.record({
      actorId,
      projectId: source?.project_id ?? null,
      objectId: row.source_id,
      objectType: source?.type ?? null,
      objectTitle: source?.title ?? null,
      action: 'link.removed',
      summary: `Removed a ${row.kind} link`,
    });
  }

  /** Replace wikilink-derived mention edges for a note without emitting activity per edge. */
  syncMentionLinks(sourceId: string, targetIds: string[]): void {
    const now = this.clock.iso();
    this.db
      .prepare("UPDATE links SET deleted_at = ? WHERE source_id = ? AND kind = 'mentions' AND deleted_at IS NULL")
      .run(now, sourceId);
    for (const targetId of new Set(targetIds)) {
      if (targetId === sourceId) continue;
      const existing = this.db
        .prepare("SELECT id FROM links WHERE source_id = ? AND target_id = ? AND kind = 'mentions'")
        .get(sourceId, targetId) as { id: string } | undefined;
      if (existing) {
        this.db.prepare('UPDATE links SET deleted_at = NULL WHERE id = ?').run(existing.id);
      } else {
        this.db
          .prepare(
            "INSERT INTO links (id, source_id, target_id, kind, created_at) VALUES (?, ?, ?, 'mentions', ?)",
          )
          .run(newId('lnk'), sourceId, targetId, now);
      }
    }
  }

  resolveTitle(title: string, preferredProjectId: string | null): ObjectRow | null {
    const rows = this.db
      .prepare('SELECT * FROM objects WHERE title = ? COLLATE NOCASE AND deleted_at IS NULL')
      .all(title.trim()) as ObjectRow[];
    if (rows.length === 0) return null;
    const preferred = rows.find((row) => row.project_id === preferredProjectId);
    if (preferred) return preferred;
    const global = rows.find((row) => row.project_id === null);
    if (global) return global;
    return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  }

  // ── Envelope ───────────────────────────────────────────────────────────
  envelope(id: string): ObjectEnvelope {
    const row = this.requireRow(id);
    const data = this.db.prepare(`SELECT * FROM ${this.tableFor(row.type)} WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return {
      object: mapObject(row),
      data: data ?? {},
      tags: this.getObjectTags(id),
      links: this.linksFor(id),
      backlinks: this.backlinksFor(id),
      attachments: this.attachments(id),
    };
  }

  attachments(objectId: string): Attachment[] {
    const rows = this.db
      .prepare('SELECT * FROM attachments WHERE object_id = ? ORDER BY created_at DESC')
      .all(objectId) as {
      id: string;
      object_id: string;
      kind: Attachment['kind'];
      filename: string;
      mime: string;
      size: number;
      page_count: number | null;
      text_status: Attachment['textStatus'];
      text_error: string | null;
      meta_json: string;
      created_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      objectId: row.object_id,
      kind: row.kind,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      pageCount: row.page_count,
      textStatus: row.text_status,
      textError: row.text_error,
      meta: parseJson(row.meta_json, {}),
      createdAt: row.created_at,
    }));
  }

  private tableFor(type: ObjectType): string {
    return type === 'reference' ? 'literature' : `${type}s`;
  }

  typeBody(type: ObjectType, id: string) {
    return objectTypes[type].body(this.db, id);
  }
}
