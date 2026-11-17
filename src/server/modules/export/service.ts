import { createReadStream, createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { BlobStore } from '../../storage/blobStore';
import type { NoteService } from '../notes/service';
import type { LiteratureService } from '../literature/service';
import { newId } from '../../core/ids';
import { sanitizeFilename, slugify } from '../../core/text';
import { todayIn } from '../../core/time';
import { sha256 } from '../../core/crypto';
import type { AppConfig } from '../../config';

interface ExportEntry {
  name: string;
  data: Buffer;
}

interface FileEntry {
  path: string;
  sha256: string;
  size: number;
  file?: string;
}

function jsonl(rows: unknown[]): Buffer {
  return Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

export class ExportService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly storage: BlobStore,
    private readonly notes: NoteService,
    private readonly literature: LiteratureService,
  ) {}

  private projectSlug(projectId: string | null): string {
    if (!projectId) return '_global';
    const row = this.db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as
      | { name: string }
      | undefined;
    return slugify(row?.name ?? 'project', 40);
  }

  async createWorkspaceExport(userId: string, timezone: string): Promise<{ filePath: string; filename: string }> {
    const date = todayIn(timezone, this.clock);
    const root = `loom-export-${date}`;
    const projects = this.db
      .prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created_at')
      .all() as Record<string, unknown>[];
    const objects = this.db
      .prepare('SELECT * FROM objects WHERE deleted_at IS NULL ORDER BY created_at')
      .all() as Record<string, unknown>[];
    const objectIds = new Set(objects.map((object) => object.id as string));
    const idList = [...objectIds];
    const inClause = idList.length ? `(${idList.map(() => '?').join(',')})` : '(NULL)';
    const notes = objects.filter((object) => object.type === 'note');
    const users = this.db.prepare('SELECT id, username, display_name, is_admin, timezone, created_at, updated_at FROM users').all();
    const providers = this.db
      .prepare('SELECT id, name, kind, base_url, chat_model, embed_model, rerank_model, is_default, extra_json, created_at, updated_at FROM ai_providers')
      .all();
    const conversations = this.db
      .prepare('SELECT * FROM conversations WHERE user_id = ? AND deleted_at IS NULL')
      .all(userId) as Record<string, unknown>[];
    const conversationIds = conversations.map((conversation) => conversation.id as string);
    const messages = conversationIds.length
      ? this.db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id IN (${conversationIds.map(() => '?').join(',')})`,
          )
          .all(...conversationIds)
      : [];
    const attachments = this.db
      .prepare('SELECT * FROM attachments WHERE object_id IN (SELECT id FROM objects WHERE deleted_at IS NULL)')
      .all() as Record<string, unknown>[];
    const digests = this.db.prepare('SELECT * FROM daily_digests WHERE user_id = ?').all(userId);
    const revisions = this.db
      .prepare('SELECT r.* FROM digest_revisions r JOIN daily_digests d ON d.id = r.digest_id WHERE d.user_id = ?')
      .all(userId);

    const dataFiles: ExportEntry[] = [
      { name: 'data/projects.jsonl', data: jsonl(projects) },
      { name: 'data/objects.jsonl', data: jsonl(objects) },
      { name: 'data/notes.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM notes WHERE id IN ${inClause}`).all(...idList)) },
      { name: 'data/note_versions.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM note_versions WHERE note_id IN ${inClause}`).all(...idList)) },
      { name: 'data/tasks.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM tasks WHERE id IN ${inClause}`).all(...idList)) },
      { name: 'data/literature.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM literature WHERE id IN ${inClause}`).all(...idList)) },
      { name: 'data/calendar_subscriptions.jsonl', data: jsonl(this.db.prepare('SELECT s.* FROM calendar_subscriptions s JOIN projects p ON p.id = s.project_id WHERE p.deleted_at IS NULL').all()) },
      { name: 'data/calendar_items.jsonl', data: jsonl(this.db.prepare('SELECT c.* FROM calendar_items c JOIN projects p ON p.id = c.project_id WHERE p.deleted_at IS NULL').all()) },
      { name: 'data/project_repositories.jsonl', data: jsonl(this.db.prepare('SELECT r.id, r.project_id, r.provider, r.owner, r.name, r.url, r.default_branch, r.is_private, r.last_synced_at, r.last_sync_error, r.created_at, r.updated_at FROM project_repositories r JOIN projects p ON p.id = r.project_id WHERE p.deleted_at IS NULL').all()) },
      { name: 'data/repository_commits.jsonl', data: jsonl(this.db.prepare('SELECT c.* FROM repository_commits c JOIN projects p ON p.id = c.project_id WHERE p.deleted_at IS NULL').all()) },
      { name: 'data/reference_bookmarks.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM reference_bookmarks WHERE reference_id IN ${inClause}`).all(...idList)) },
      { name: 'data/pdf_annotations.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM pdf_annotations WHERE attachment_id IN (SELECT id FROM attachments WHERE object_id IN ${inClause})`).all(...idList)) },
      { name: 'data/experiments.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM experiments WHERE id IN ${inClause}`).all(...idList)) },
      { name: 'data/questions.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM questions WHERE id IN ${inClause}`).all(...idList)) },
      { name: 'data/inbox.jsonl', data: jsonl(this.db.prepare('SELECT * FROM inbox_items').all()) },
      { name: 'data/tags.jsonl', data: jsonl(this.db.prepare('SELECT * FROM tags').all()) },
      { name: 'data/object_tags.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM object_tags WHERE object_id IN ${inClause}`).all(...idList)) },
      { name: 'data/links.jsonl', data: jsonl(this.db.prepare(`SELECT * FROM links WHERE source_id IN ${inClause} AND target_id IN ${inClause}`).all(...idList, ...idList)) },
      { name: 'data/attachments.jsonl', data: jsonl(attachments) },
      { name: 'data/activity_events.jsonl', data: jsonl(this.db.prepare('SELECT * FROM activity_events ORDER BY seq').all()) },
      { name: 'data/users.jsonl', data: jsonl(users) },
      { name: 'data/ai_providers.jsonl', data: jsonl(providers) },
      { name: 'data/conversations.jsonl', data: jsonl(conversations) },
      { name: 'data/messages.jsonl', data: jsonl(messages) },
      { name: 'data/daily_digests.jsonl', data: jsonl(digests) },
      { name: 'data/digest_revisions.jsonl', data: jsonl(revisions) },
      { name: 'data/settings.json', data: Buffer.from(JSON.stringify(this.appSettings(), null, 2), 'utf8') },
      { name: 'data/user_settings.jsonl', data: jsonl(this.db.prepare('SELECT * FROM user_settings').all()) },
    ];

    const noteEntries: ExportEntry[] = [];
    for (const object of notes) {
      const id = object.id as string;
      const markdown = this.notes.markdown(id);
      const name = `notes/${this.projectSlug(object.project_id as string | null)}/${slugify(String(object.title), 60)}-${id.slice(-6)}.md`;
      noteEntries.push({ name, data: Buffer.from(markdown, 'utf8') });
    }

    const bibtex = Buffer.from(this.literature.exportBibtex(), 'utf8');
    const attachmentFiles = await this.attachmentFileEntries(attachments.map((attachment) => attachment.blob_hash as string));

    const filesForManifest: FileEntry[] = [
      ...dataFiles.map((entry) => ({
        path: entry.name,
        sha256: sha256(entry.data),
        size: entry.data.length,
      })),
      ...noteEntries.map((entry) => ({
        path: entry.name,
        sha256: sha256(entry.data),
        size: entry.data.length,
      })),
      { path: 'literature.bib', sha256: sha256(bibtex), size: bibtex.length },
      ...attachmentFiles,
    ];

    const manifest = {
      format: 'loom-export',
      formatVersion: 1,
      appVersion: this.config.appVersion,
      schemaVersion: this.schemaVersion(),
      createdAt: this.clock.iso(),
      scope: { kind: 'workspace', userId },
      counts: {
        projects: projects.length,
        objects: objects.length,
        notes: noteEntries.length,
        attachments: attachmentFiles.length,
      },
      keyFingerprint: this.config.keyFingerprint,
      files: filesForManifest,
    };

    const filename = `${root}.zip`;
    const tempPath = path.join(this.config.tmpDir, `${newId('exp')}.zip`);
    await this.writeZip(tempPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'README.md', data: Buffer.from(EXPORT_README, 'utf8') },
      ...dataFiles,
      ...noteEntries,
      { name: 'literature.bib', data: bibtex },
      { name: 'checksums.sha256', data: this.checksums(filesForManifest) },
    ], attachmentFiles, root);
    return { filePath: tempPath, filename };
  }

  async createProjectExport(projectId: string, timezone: string): Promise<{ filePath: string; filename: string }> {
    const project = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(projectId) as Record<string, unknown> | undefined;
    if (!project) throw new Error('Project not found');
    const date = todayIn(timezone, this.clock);
    const slug = slugify(String(project.name), 40);
    const root = `loom-export-${slug}-${date}`;
    const objects = this.db
      .prepare('SELECT * FROM objects WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at')
      .all(projectId) as Record<string, unknown>[];
    const ids = objects.map((object) => object.id as string);
    const idSet = new Set(ids);
    const notes = objects.filter((object) => object.type === 'note');
    const attachments = ids.length
      ? (this.db
          .prepare(`SELECT * FROM attachments WHERE object_id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids) as Record<string, unknown>[])
      : [];
    const links = this.db
      .prepare('SELECT * FROM links WHERE deleted_at IS NULL')
      .all() as { source_id: string; target_id: string }[];
    const scopedLinks = links.filter((link) => idSet.has(link.source_id) && idSet.has(link.target_id));
    const tagIds = ids.length
      ? (this.db
          .prepare(`SELECT DISTINCT tag_id FROM object_tags WHERE object_id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids) as { tag_id: string }[])
      : [];
    const tags = tagIds.length
      ? this.db
          .prepare(`SELECT * FROM tags WHERE id IN (${tagIds.map(() => '?').join(',')})`)
          .all(...tagIds.map((row) => row.tag_id))
      : [];
    const objectTags = ids.length
      ? this.db
          .prepare(`SELECT * FROM object_tags WHERE object_id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids)
      : [];

    const dataFiles: ExportEntry[] = [
      { name: 'project.json', data: Buffer.from(JSON.stringify(project, null, 2), 'utf8') },
      { name: 'data/objects.jsonl', data: jsonl(objects) },
      { name: 'data/notes.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM notes WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/note_versions.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM note_versions WHERE note_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/tasks.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/literature.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM literature WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/calendar_subscriptions.jsonl', data: jsonl(this.db.prepare('SELECT * FROM calendar_subscriptions WHERE project_id = ?').all(projectId)) },
      { name: 'data/calendar_items.jsonl', data: jsonl(this.db.prepare('SELECT * FROM calendar_items WHERE project_id = ?').all(projectId)) },
      { name: 'data/project_repositories.jsonl', data: jsonl(this.db.prepare('SELECT id, project_id, provider, owner, name, url, default_branch, is_private, last_synced_at, last_sync_error, created_at, updated_at FROM project_repositories WHERE project_id = ?').all(projectId)) },
      { name: 'data/repository_commits.jsonl', data: jsonl(this.db.prepare('SELECT * FROM repository_commits WHERE project_id = ?').all(projectId)) },
      { name: 'data/reference_bookmarks.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM reference_bookmarks WHERE reference_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/pdf_annotations.jsonl', data: jsonl(attachments.length ? this.db.prepare(`SELECT * FROM pdf_annotations WHERE attachment_id IN (${attachments.map(() => '?').join(',')})`).all(...attachments.map((attachment) => attachment.id as string)) : []) },
      { name: 'data/experiments.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM experiments WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/questions.jsonl', data: jsonl(ids.length ? this.db.prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []) },
      { name: 'data/links.jsonl', data: jsonl(scopedLinks) },
      { name: 'data/tags.jsonl', data: jsonl(tags) },
      { name: 'data/object_tags.jsonl', data: jsonl(objectTags) },
      { name: 'data/attachments.jsonl', data: jsonl(attachments) },
      { name: 'data/activity_events.jsonl', data: jsonl(this.db.prepare('SELECT * FROM activity_events WHERE project_id = ? ORDER BY seq').all(projectId)) },
    ];

    const noteEntries: ExportEntry[] = notes.map((object) => {
      const id = object.id as string;
      return {
        name: `notes/${slugify(String(object.title), 60)}-${id.slice(-6)}.md`,
        data: Buffer.from(this.notes.markdown(id), 'utf8'),
      };
    });
    const bibtex = Buffer.from(this.literature.exportBibtex(projectId), 'utf8');
    const attachmentFiles = await this.attachmentFileEntries(attachments.map((attachment) => attachment.blob_hash as string));

    const filesForManifest: FileEntry[] = [
      ...dataFiles.map((entry) => ({ path: entry.name, sha256: sha256(entry.data), size: entry.data.length })),
      ...noteEntries.map((entry) => ({ path: entry.name, sha256: sha256(entry.data), size: entry.data.length })),
      { path: 'literature.bib', sha256: sha256(bibtex), size: bibtex.length },
      ...attachmentFiles,
    ];
    const manifest = {
      format: 'loom-export',
      formatVersion: 1,
      appVersion: this.config.appVersion,
      schemaVersion: this.schemaVersion(),
      createdAt: this.clock.iso(),
      scope: { kind: 'project', projectId, projectName: project.name },
      counts: {
        objects: objects.length,
        notes: noteEntries.length,
        attachments: attachmentFiles.length,
      },
      keyFingerprint: this.config.keyFingerprint,
      files: filesForManifest,
    };
    const filename = `${root}.zip`;
    const tempPath = path.join(this.config.tmpDir, `${newId('exp')}.zip`);
    await this.writeZip(tempPath, [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'README.md', data: Buffer.from(EXPORT_README, 'utf8') },
      ...dataFiles,
      ...noteEntries,
      { name: 'literature.bib', data: bibtex },
      { name: 'checksums.sha256', data: this.checksums(filesForManifest) },
    ], attachmentFiles, root);
    return { filePath: tempPath, filename };
  }

  private appSettings(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as {
      key: string;
      value_json: string;
    }[];
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value_json);
      } catch {
        result[row.key] = row.value_json;
      }
    }
    return result;
  }

  private schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    return row.version ?? 0;
  }

  private async attachmentFileEntries(hashes: string[]): Promise<FileEntry[]> {
    const unique = [...new Set(hashes)];
    const entries: FileEntry[] = [];
    for (const hash of unique) {
      const stat = await this.storage.stat(hash);
      if (!stat) continue;
      const row = this.db
        .prepare('SELECT filename FROM attachments WHERE blob_hash = ? LIMIT 1')
        .get(hash) as { filename: string } | undefined;
      const safe = sanitizeFilename(row?.filename ?? 'file', 80);
      entries.push({
        path: `attachments/${hash}__${safe}`,
        sha256: hash,
        size: stat.size,
        file: this.storage.pathFor(hash),
      });
    }
    return entries;
  }

  private checksums(entries: FileEntry[]): Buffer {
    return Buffer.from(
      entries
        .slice()
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((entry) => `${entry.sha256}  ${entry.path}`)
        .join('\n') + '\n',
      'utf8',
    );
  }

  private writeZip(
    target: string,
    entries: ExportEntry[],
    files: FileEntry[],
    prefix: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(target);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const entry of entries) archive.append(entry.data, { name: `${prefix}/${entry.name}` });
      for (const entry of files) {
        if (entry.file) {
          archive.append(createReadStream(entry.file), { name: `${prefix}/${entry.path}`, date: this.clock.now() });
        }
      }
      void archive.finalize();
    });
  }

  async cleanup(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }
}

const EXPORT_README = `# Loom research export

This archive is a portable snapshot of a Loom research workspace.

- \`manifest.json\` — format version, schema version, counts and a SHA-256 for every file.
- \`data/*.jsonl\` — one JSON object per line, mirroring the database tables.
- \`notes/*.md\` — every note as Markdown with YAML front matter (one file per note).
- \`literature.bib\` — all references as BibTeX.
- \`attachments/\` — original files, named \`<sha256>__<original-name>\`.
- \`checksums.sha256\` — verify with \`sha256sum -c checksums.sha256\`.
- \`data/users.jsonl\` contains no password hashes and no API keys are included.

Restoring a portable export inside the app is not supported in v1. Use a full backup
(Settings → Data → Backup) for exact restoration, or read these files with standard tools.
`;
