import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './index';
import { sha256 } from '../core/crypto';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

export interface MigrationResult {
  applied: number;
  current: number;
}

export function runMigrations(db: Db): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedRows = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as { version: number; name: string; checksum: string }[];
  const appliedByVersion = new Map(appliedRows.map((row) => [row.version, row]));

  let applied = 0;
  for (const file of files) {
    const version = Number(file.split('_')[0]);
    if (!Number.isInteger(version)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = sha256(sql);
    const existing = appliedByVersion.get(version);
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration ${file} was modified after being applied (checksum mismatch). Restore the original or add a new migration.`,
        );
      }
      continue;
    }
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(version, file, checksum, new Date().toISOString());
    });
    run();
    applied++;
  }

  const current = (
    db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    }
  ).version;
  return { applied, current: current ?? 0 };
}

export function migrationVersion(db: Db): number {
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
      version: number | null;
    };
    return row.version ?? 0;
  } catch {
    return 0;
  }
}

export function migrationStatus(db: Db): { current: number; pending: number } {
  const current = migrationVersion(db);
  let files: string[] = [];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith('.sql'));
  } catch {
    files = [];
  }
  const pending = files.filter((file) => {
    const version = Number(file.split('_')[0]);
    return Number.isInteger(version) && version > current;
  }).length;
  return { current, pending };
}
