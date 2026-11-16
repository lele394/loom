import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export type Db = Database.Database;

export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  return db;
}

/** Run a synchronous unit of work. Nested calls become savepoints (better-sqlite3 behaviour). */
export function inTx<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}

export function nowIso(clock: { iso(): string } = { iso: () => new Date().toISOString() }): string {
  return clock.iso();
}
