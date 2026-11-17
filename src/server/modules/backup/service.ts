import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import Database from 'better-sqlite3';
import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { BlobStore } from '../../storage/blobStore';
import type { ActivityService } from '../activity/service';
import type { SettingsService } from '../settings/service';
import type { JobQueue } from '../../worker/jobs';
import type { AppConfig } from '../../config';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { hashFile } from '../../storage/blobStore';
import { sha256 } from '../../core/crypto';
import { extractZip } from '../../storage/zip';
import { todayIn } from '../../core/time';
import type pino from 'pino';

interface BackupRow {
  id: string;
  filename: string;
  kind: string;
  size: number;
  checksum: string;
  status: 'ready' | 'failed' | 'missing';
  created_at: string;
}

interface Manifest {
  format: string;
  formatVersion: number;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  kind: string;
  keyFingerprint: string;
  counts: { objects: number; attachments: number; events: number };
  files: { path: string; sha256: string; size: number }[];
}

const RESTORE_TABLES = [
  'users',
  'github_credentials',
  'projects',
  'calendar_subscriptions',
  'calendar_items',
  'project_repositories',
  'repository_commits',
  'board_columns',
  'objects',
  'notes',
  'note_versions',
  'tasks',
  'literature',
  'reference_bookmarks',
  'experiments',
  'questions',
  'inbox_items',
  'tags',
  'object_tags',
  'links',
  'attachments',
  'attachment_text',
  'pdf_annotations',
  'chunks',
  'activity_events',
  'daily_digests',
  'digest_revisions',
  'ai_providers',
  'conversations',
  'messages',
  'settings',
  'user_settings',
] as const;

export class BackupService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AppConfig,
    private readonly storage: BlobStore,
    private readonly activity: ActivityService,
    private readonly settings: SettingsService,
    private readonly jobs: JobQueue,
    private readonly log: pino.Logger,
  ) {}

  list(): BackupRow[] {
    return this.db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all() as BackupRow[];
  }

  row(id: string): BackupRow {
    const row = this.db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as BackupRow | undefined;
    if (!row) throw notFound('Backup');
    return row;
  }

  filePath(row: BackupRow): string {
    return path.join(this.config.backupDir, row.filename);
  }

  async create(
    kind: 'manual' | 'auto' | 'pre_migration' | 'pre_restore',
    actorId: string,
  ): Promise<BackupRow> {
    const id = newId('bkp');
    const snapshot = path.join(this.config.tmpDir, `${id}.db`);
    const tempZip = path.join(this.config.tmpDir, `${id}.zip`);
    const date = todayIn('UTC', this.clock);
    const filename = `loom-backup-${date}-${kind}-${id.slice(-6)}.zip`;
    const archiveRoot = filename.replace(/\.zip$/, '');

    try {
      await this.db.backup(snapshot);
      const check = new Database(snapshot, { readonly: true });
      try {
        const integrity = check.pragma('integrity_check') as { integrity_check: string }[];
        if (!integrity.every((row) => row.integrity_check === 'ok')) {
          throw new Error('Snapshot failed SQLite integrity_check.');
        }
      } finally {
        check.close();
      }

      const blobs = this.db.prepare('SELECT DISTINCT blob_hash FROM attachments').all() as {
        blob_hash: string;
      }[];
      const attachmentFiles: { path: string; sha256: string; size: number; file: string }[] = [];
      for (const blob of blobs) {
        const stat = await this.storage.stat(blob.blob_hash);
        if (!stat) {
          throw new Error(`Backup is incomplete: referenced blob ${blob.blob_hash} is missing from storage.`);
        }
        attachmentFiles.push({
          path: `attachments/${blob.blob_hash.slice(0, 2)}/${blob.blob_hash.slice(2, 4)}/${blob.blob_hash}`,
          sha256: blob.blob_hash,
          size: stat.size,
          file: this.storage.pathFor(blob.blob_hash),
        });
      }

      const counts = {
        objects: (this.db.prepare('SELECT COUNT(*) AS c FROM objects').get() as { c: number }).c,
        attachments: (this.db.prepare('SELECT COUNT(*) AS c FROM attachments').get() as { c: number }).c,
        events: (this.db.prepare('SELECT COUNT(*) AS c FROM activity_events').get() as { c: number }).c,
      };
      const dbHash = await hashFile(snapshot);
      const dbSize = (await fs.stat(snapshot)).size;
      const readme = Buffer.from(BACKUP_README, 'utf8');
      const files = [
        { path: 'db/loom.db', sha256: dbHash, size: dbSize },
        ...attachmentFiles.map(({ path: name, sha256: hash, size }) => ({ path: name, sha256: hash, size })),
        { path: 'README.txt', sha256: sha256(readme), size: readme.length },
      ];
      const manifest: Manifest = {
        format: 'loom-backup',
        formatVersion: 1,
        appVersion: this.config.appVersion,
        schemaVersion: this.schemaVersion(),
        createdAt: this.clock.iso(),
        kind,
        keyFingerprint: this.config.keyFingerprint,
        counts,
        files,
      };
      const checksums = Buffer.from(
        files.map((entry) => `${entry.sha256}  ${entry.path}`).join('\n') + '\n',
        'utf8',
      );

      await this.writeZip(tempZip, archiveRoot, [
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
        { name: 'README.txt', data: readme },
        { name: 'checksums.sha256', data: checksums },
        { name: 'db/loom.db', file: snapshot },
        ...attachmentFiles.map((entry) => ({ name: entry.path, file: entry.file })),
      ]);

      const finalPath = path.join(this.config.backupDir, filename);
      await fs.rename(tempZip, finalPath);
      const checksum = await hashFile(finalPath);
      const size = (await fs.stat(finalPath)).size;

      this.db
        .prepare(
          "INSERT INTO backups (id, filename, kind, size, checksum, status, created_at) VALUES (?, ?, ?, ?, ?, 'ready', ?)",
        )
        .run(id, filename, kind, size, checksum, this.clock.iso());
      if (kind !== 'pre_restore') {
        this.activity.record({
          actorId,
          action: 'backup.created',
          summary: `Created ${kind} backup ${filename}`,
          source: 'job',
        });
      }
      await this.prune();
      return this.row(id);
    } catch (error) {
      this.db
        .prepare(
          "INSERT INTO backups (id, filename, kind, size, checksum, status, created_at) VALUES (?, ?, ?, 0, '', 'failed', ?)",
        )
        .run(id, filename, kind, this.clock.iso());
      throw error;
    } finally {
      await fs.rm(snapshot, { force: true });
      await fs.rm(tempZip, { force: true });
    }
  }

  private schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    return row.version ?? 0;
  }

  private writeZip(
    target: string,
    prefix: string,
    entries: { name: string; data?: Buffer; file?: string }[],
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(target);
      const archive = new ZipArchive({ zlib: { level: 6 } });
      output.on('close', () => resolve());
      output.on('error', reject);
      archive.on('error', reject);
      archive.pipe(output);
      for (const entry of entries) {
        if (entry.data) archive.append(entry.data, { name: `${prefix}/${entry.name}` });
        else if (entry.file) {
          archive.append(createReadStream(entry.file), { name: `${prefix}/${entry.name}`, date: this.clock.now() });
        }
      }
      void archive.finalize();
    });
  }

  async verify(id: string): Promise<{ ok: boolean; errors: string[]; checkedFiles: number; tookMs: number }> {
    const started = Date.now();
    const row = this.row(id);
    const errors: string[] = [];
    let checked = 0;
    const archive = this.filePath(row);
    try {
      const checksum = await hashFile(archive);
      if (checksum !== row.checksum) errors.push('The archive checksum does not match the recorded checksum.');
      const work = path.join(this.config.tmpDir, `verify-${newId('bkp')}`);
      await extractZip(archive, work);
      const manifestPath = await findFile(work, 'manifest.json');
      if (!manifestPath) {
        errors.push('manifest.json is missing.');
        return { ok: false, errors, checkedFiles: 0, tookMs: Date.now() - started };
      }
      const root = path.dirname(manifestPath);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest;
      if (manifest.format !== 'loom-backup') errors.push('Not a Loom backup manifest.');
      for (const file of manifest.files ?? []) {
        const target = path.join(root, file.path);
        try {
          const hash = await hashFile(target);
          checked++;
          if (hash !== file.sha256) errors.push(`Checksum mismatch: ${file.path}`);
        } catch {
          errors.push(`Missing file: ${file.path}`);
        }
      }
      const dbPath = path.join(root, 'db/loom.db');
      try {
        const backupDb = new Database(dbPath, { readonly: true });
        try {
          const integrity = backupDb.pragma('integrity_check') as { integrity_check: string }[];
          if (!integrity.every((entry) => entry.integrity_check === 'ok')) {
            errors.push('The backup database failed integrity_check.');
          }
          const objects = backupDb.prepare('SELECT COUNT(*) AS c FROM objects').get() as { c: number };
          if (objects.c !== manifest.counts.objects) {
            errors.push('Object count does not match the manifest.');
          }
          const users = backupDb.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
          if (users.c === 0) errors.push('The backup contains no users.');
        } finally {
          backupDb.close();
        }
      } catch (error) {
        errors.push(`The backup database is unreadable: ${(error as Error).message}`);
      }
      await fs.rm(work, { recursive: true, force: true });
    } catch (error) {
      errors.push((error as Error).message);
    }
    if (errors.length) {
      this.db.prepare("UPDATE backups SET status = 'failed' WHERE id = ?").run(id);
    }
    return { ok: errors.length === 0, errors, checkedFiles: checked, tookMs: Date.now() - started };
  }

  async restore(
    zipPath: string,
    actorId: string,
  ): Promise<{ reloginRequired: true; counts: Manifest['counts']; warnings: string[] }> {
    const work = path.join(this.config.tmpDir, `restore-${newId('bkp')}`);
    const warnings: string[] = [];
    try {
      await extractZip(zipPath, work);
      const manifestPath = await findFile(work, 'manifest.json');
      if (!manifestPath) throw new AppError('bad_request', 'The archive has no manifest.json.');
      const root = path.dirname(manifestPath);
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Manifest;
      if (manifest.format !== 'loom-backup') throw new AppError('bad_request', 'Not a Loom backup.');
      if (manifest.formatVersion !== 1) {
        throw new AppError('bad_request', `Unsupported backup format version ${manifest.formatVersion}.`);
      }
      if (manifest.schemaVersion !== this.schemaVersion()) {
        throw new AppError(
          'bad_request',
          `This backup was created with schema version ${manifest.schemaVersion}, but this instance uses ${this.schemaVersion()}. Restore it with the matching Loom version, then upgrade.`,
        );
      }
      if (manifest.keyFingerprint !== this.config.keyFingerprint) {
        warnings.push(
          'The master key differs from the backup. Encrypted AI provider keys will not decrypt; re-enter them after restore.',
        );
      }

      for (const file of manifest.files) {
        const target = path.join(root, file.path);
        const hash = await hashFile(target).catch(() => '');
        if (!hash || hash !== file.sha256) {
          throw new AppError('bad_request', `Backup verification failed for ${file.path}.`);
        }
      }

      const backupDb = new Database(path.join(root, 'db/loom.db'), { readonly: true });
      let counts: Manifest['counts'];
      try {
        const integrity = backupDb.pragma('integrity_check') as { integrity_check: string }[];
        if (!integrity.every((entry) => entry.integrity_check === 'ok')) {
          throw new AppError('bad_request', 'The backup database is corrupt.');
        }
        for (const table of [...RESTORE_TABLES, 'search_fts']) {
          const found = backupDb
            .prepare("SELECT name FROM sqlite_master WHERE (type='table' OR type='view') AND name = ?")
            .get(table);
          if (!found) throw new AppError('bad_request', `The backup is missing table ${table}.`);
        }
        counts = {
          objects: (backupDb.prepare('SELECT COUNT(*) AS c FROM objects').get() as { c: number }).c,
          attachments: (backupDb.prepare('SELECT COUNT(*) AS c FROM attachments').get() as { c: number }).c,
          events: (backupDb.prepare('SELECT COUNT(*) AS c FROM activity_events').get() as { c: number }).c,
        };
        const blobRows = backupDb
          .prepare('SELECT DISTINCT blob_hash FROM attachments')
          .all() as { blob_hash: string }[];
        for (const blob of blobRows) {
          const source = path.join(root, 'attachments', blob.blob_hash.slice(0, 2), blob.blob_hash.slice(2, 4), blob.blob_hash);
          await fs.access(source);
          const destination = this.storage.pathFor(blob.blob_hash);
          await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
          try {
            await fs.access(destination);
          } catch {
            await fs.copyFile(source, destination);
            await fs.chmod(destination, 0o640).catch(() => undefined);
          }
        }
      } finally {
        backupDb.close();
      }

      await this.create('pre_restore', actorId).catch((error) => {
        throw new AppError('bad_request', `Could not create a safety backup before restore: ${(error as Error).message}`);
      });

      this.importRows(path.join(root, 'db/loom.db'));

      this.jobs.enqueue('search.reindex', {
        payload: { ftsOnly: true },
        idempotencyKey: `reindex:restore:${Date.now()}`,
        priority: 10,
      });
      this.activity.record({
        actorId,
        action: 'backup.restored',
        summary: 'Restored the workspace from a backup',
        source: 'api',
      });
      return { reloginRequired: true, counts, warnings };
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  }

  private importRows(backupDbPath: string): void {
    const backupDb = new Database(backupDbPath, { readonly: true });
    try {
      this.db.pragma('foreign_keys = OFF');
      const importTx = this.db.transaction(() => {
        for (const table of [...RESTORE_TABLES].reverse()) {
          this.db.prepare(`DELETE FROM ${table}`).run();
        }
        this.db.prepare('DELETE FROM search_fts').run();
        this.db.prepare('DELETE FROM sessions').run();
        this.db.prepare('DELETE FROM jobs').run();

        for (const table of RESTORE_TABLES) {
          const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
            (column) => column.name,
          );
          const rows = backupDb.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
          if (!rows.length) continue;
          const placeholders = columns.map(() => '?').join(',');
          const insert = this.db.prepare(
            `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
          );
          for (const row of rows) {
            insert.run(...columns.map((column) => row[column] ?? null));
          }
        }

        const violations = this.db.pragma('foreign_key_check') as unknown[];
        if (violations.length) {
          throw new AppError('bad_request', 'The backup contains inconsistent relationships.');
        }
      });
      importTx();
      const violations = this.db.pragma('foreign_key_check') as unknown[];
      if (violations.length) {
        throw new AppError('bad_request', 'The restored data has foreign-key violations.');
      }
    } finally {
      this.db.pragma('foreign_keys = ON');
      backupDb.close();
    }
  }

  async delete(id: string): Promise<void> {
    const row = this.row(id);
    await fs.rm(this.filePath(row), { force: true });
    this.db.prepare('DELETE FROM backups WHERE id = ?').run(id);
  }

  async prune(): Promise<number> {
    const retention = Math.max(1, this.settings.getApp().backupRetention);
    const groups: { kind: string; limit: number }[] = [
      { kind: 'auto', limit: retention },
      { kind: 'pre_migration', limit: 3 },
      { kind: 'pre_restore', limit: 3 },
    ];
    let removed = 0;
    for (const group of groups) {
      const rows = this.db
        .prepare("SELECT * FROM backups WHERE kind = ? AND status = 'ready' ORDER BY created_at DESC")
        .all(group.kind) as BackupRow[];
      for (const row of rows.slice(group.limit)) {
        await fs.rm(this.filePath(row), { force: true }).catch(() => undefined);
        this.db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
        removed++;
      }
    }
    const missing = this.db.prepare("SELECT * FROM backups WHERE status = 'ready'").all() as BackupRow[];
    for (const row of missing) {
      try {
        await fs.access(this.filePath(row));
      } catch {
        this.db.prepare("UPDATE backups SET status = 'missing' WHERE id = ?").run(row.id);
      }
    }
    return removed;
  }
}

async function findFile(root: string, name: string, depth = 0): Promise<string | null> {
  if (depth > 2) return null;
  const direct = path.join(root, name);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await findFile(path.join(root, entry.name), name, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
}

const BACKUP_README = `Loom full backup
================

This archive restores an entire Loom instance.

- manifest.json      format, schema version, counts, key fingerprint, file hashes
- db/loom.db         consistent SQLite snapshot (open with any SQLite tool)
- attachments/       original files, content-addressed
- checksums.sha256   verify with: sha256sum -c checksums.sha256
- README.txt

Restore inside Loom: Settings -> Data -> Restore, upload this ZIP, type RESTORE.
Keep LOOM_SECRET (or data/master.key) with the backup if AI provider keys must survive.
Backups contain your entire research corpus; store them encrypted offsite.
`;
