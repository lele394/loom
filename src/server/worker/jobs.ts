import type { Db } from '../db/index';
import type { Clock } from '../core/clock';
import { newId } from '../core/ids';
import { parseJson } from '../core/text';
import type pino from 'pino';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';

export interface JobRow {
  id: string;
  type: string;
  payload_json: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface EnqueueOptions {
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  priority?: number;
  maxAttempts?: number;
  runAt?: Date;
}

export class JobQueue {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly log: pino.Logger,
  ) {}

  enqueue(type: string, options: EnqueueOptions = {}): string | null {
    const now = this.clock.iso();
    const id = newId('job');
    try {
      this.db
        .prepare(
          `INSERT INTO jobs (id, type, payload_json, status, priority, attempts, max_attempts, run_at, idempotency_key, created_at)
           VALUES (?, ?, ?, 'queued', ?, 0, ?, ?, ?, ?)`,
        )
        .run(
          id,
          type,
          JSON.stringify(options.payload ?? {}),
          options.priority ?? 100,
          options.maxAttempts ?? 3,
          (options.runAt ?? this.clock.now()).toISOString(),
          options.idempotencyKey ?? null,
          now,
        );
      return id;
    } catch (error) {
      const message = (error as Error).message;
      if (options.idempotencyKey && message.includes('UNIQUE')) return null;
      throw error;
    }
  }

  claim(): JobRow | null {
    const now = this.clock.iso();
    const row = this.db
      .prepare(
        `UPDATE jobs
         SET status = 'running', started_at = ?, attempts = attempts + 1
         WHERE id = (
           SELECT id FROM jobs
           WHERE status = 'queued' AND run_at <= ?
           ORDER BY priority ASC, run_at ASC, created_at ASC
           LIMIT 1
         )
         RETURNING *`,
      )
      .get(now, now) as JobRow | undefined;
    return row ?? null;
  }

  succeed(id: string): void {
    this.db
      .prepare("UPDATE jobs SET status = 'succeeded', finished_at = ?, last_error = NULL WHERE id = ?")
      .run(this.clock.iso(), id);
  }

  fail(id: string, error: unknown, retryable = true): JobStatus {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
    if (!row) return 'failed';
    const message = error instanceof Error ? error.message : String(error);
    const canRetry = retryable && row.attempts < row.max_attempts;
    if (!canRetry) {
      const status: JobStatus = retryable ? 'dead' : 'failed';
      this.db
        .prepare('UPDATE jobs SET status = ?, finished_at = ?, last_error = ? WHERE id = ?')
        .run(status, this.clock.iso(), message.slice(0, 4000), id);
      this.log.warn({ jobId: id, type: row.type, status, error: message }, 'job failed');
      return status;
    }
    const backoffMs = Math.min(30_000 * 2 ** (row.attempts - 1), 30 * 60_000) + Math.random() * 5000;
    const runAt = new Date(this.clock.now().getTime() + backoffMs).toISOString();
    this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', run_at = ?, last_error = ?, started_at = NULL WHERE id = ?",
      )
      .run(runAt, message.slice(0, 4000), id);
    this.log.warn({ jobId: id, type: row.type, retryInMs: backoffMs, error: message }, 'job retry');
    return 'queued';
  }

  retry(id: string): boolean {
    const result = this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', run_at = ?, attempts = 0, started_at = NULL, finished_at = NULL, last_error = NULL WHERE id = ? AND status IN ('failed','dead')",
      )
      .run(this.clock.iso(), id);
    return result.changes > 0;
  }

  recoverRunning(): number {
    const result = this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'",
      )
      .run();
    return result.changes;
  }

  list(status?: JobStatus, limit = 100): JobRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?')
        .all(status, limit) as JobRow[];
    }
    return this.db
      .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as JobRow[];
  }

  find(id: string): JobRow | null {
    return (this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined) ?? null;
  }

  /** Filtered listing used by feature queues; dismissed rows stay in the jobs history. */
  listFiltered(
    options: {
      type?: string;
      statuses?: JobStatus[];
      includeDismissed?: boolean;
      createdAfter?: string;
      limit?: number;
    } = {},
  ): JobRow[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (options.type) {
      clauses.push('type = ?');
      params.push(options.type);
    }
    if (options.statuses?.length) {
      clauses.push(`status IN (${options.statuses.map(() => '?').join(',')})`);
      params.push(...options.statuses);
    }
    if (!options.includeDismissed) clauses.push('dismissed_at IS NULL');
    if (options.createdAfter) {
      clauses.push('created_at >= ?');
      params.push(options.createdAfter);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(options.limit ?? 100);
    return this.db
      .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as JobRow[];
  }

  dismiss(id: string): boolean {
    const result = this.db
      .prepare("UPDATE jobs SET dismissed_at = ? WHERE id = ? AND status IN ('succeeded','failed','dead')")
      .run(this.clock.iso(), id);
    return result.changes > 0;
  }

  dismissFinished(type: string): number {
    const result = this.db
      .prepare(
        "UPDATE jobs SET dismissed_at = ? WHERE type = ? AND dismissed_at IS NULL AND status IN ('succeeded','failed','dead')",
      )
      .run(this.clock.iso(), type);
    return result.changes;
  }

  stats(): { queued: number; running: number; dead: number; oldestQueuedMs: number } {
    const counts = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
           SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN status='dead' THEN 1 ELSE 0 END) AS dead,
           MIN(CASE WHEN status='queued' THEN run_at END) AS oldest
         FROM jobs`,
      )
      .get() as { queued: number | null; running: number | null; dead: number | null; oldest: string | null };
    return {
      queued: counts.queued ?? 0,
      running: counts.running ?? 0,
      dead: counts.dead ?? 0,
      oldestQueuedMs: counts.oldest ? Math.max(0, Date.now() - new Date(counts.oldest).getTime()) : 0,
    };
  }

  payload(row: JobRow): Record<string, unknown> {
    return parseJson<Record<string, unknown>>(row.payload_json, {});
  }
}
