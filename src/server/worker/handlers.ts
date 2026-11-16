import type { Ctx } from '../ctx';
import { Worker, type JobHandler } from './worker';
import type { JobStatus } from './jobs';
import type { AppConfig } from '../config';

function primaryUserId(ctx: Ctx): string {
  const row = ctx.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
    | { id: string }
    | undefined;
  if (!row) throw new Error('No user exists yet.');
  return row.id;
}

export function createWorker(ctx: Ctx): Worker {
  const worker = new Worker(ctx, ctx.log);
  const handlers: Record<string, JobHandler> = {
    'search.reindex': async (payload) => {
      if (payload.ftsOnly) ctx.services.search.reindexFtsAll();
      else ctx.services.search.reindexAll();
    },
    'index.object': async (payload) => {
      const objectId = String(payload.objectId ?? '');
      if (objectId) ctx.services.search.indexObject(objectId);
    },
    'embed.chunks': async (payload) => {
      const cfg = ctx.services.search.embeddingConfig();
      if (!cfg) return;
      const objectId = payload.objectId ? String(payload.objectId) : null;
      if (objectId) {
        await ctx.services.search.embedObject(objectId);
        return;
      }
      const pending = ctx.db
        .prepare(
          'SELECT DISTINCT object_id FROM chunks WHERE embedding IS NULL OR embedding_model != ? LIMIT 200',
        )
        .all(cfg.modelKey) as { object_id: string }[];
      for (const row of pending) {
        await ctx.services.search.embedObject(row.object_id);
      }
    },
    'extract.attachment': async (payload) => {
      const attachmentId = String(payload.attachmentId ?? '');
      if (!attachmentId) throw new Error('Missing attachmentId');
      await ctx.services.attachments.extract(attachmentId);
    },
    'reference.summarize': async (payload) => {
      const referenceId = String(payload.referenceId ?? '');
      if (!referenceId) throw new Error('Missing referenceId');
      const mode = payload.mode as 'text' | 'images' | 'ocr' | undefined;
      await ctx.services.literatureSummary.generate(referenceId, {
        ...(mode ? { mode } : {}),
        instructions: payload.instructions ? String(payload.instructions) : '',
        actorId: payload.actorId ? String(payload.actorId) : primaryUserId(ctx),
      });
    },
    'digest.generate': async (payload) => {
      const userId = String(payload.userId ?? primaryUserId(ctx));
      const date = String(payload.date ?? '');
      if (!date) throw new Error('Missing digest date');
      await ctx.services.journal.runGeneration(
        userId,
        date,
        Boolean(payload.force),
        payload.actorId ? String(payload.actorId) : userId,
      );
    },
    'backup.create': async (payload) => {
      const kind = (payload.kind as 'manual' | 'auto' | 'pre_migration' | 'pre_restore') ?? 'auto';
      const actorId = payload.actorId ? String(payload.actorId) : primaryUserId(ctx);
      await ctx.services.backup.create(kind, actorId);
    },
    'backup.verify': async (payload) => {
      const backupId = String(payload.backupId ?? '');
      if (!backupId) throw new Error('Missing backupId');
      await ctx.services.backup.verify(backupId);
    },
    'backup.prune': async () => {
      await ctx.services.backup.prune();
    },
    'sessions.prune': async () => {
      const removed = ctx.db
        .prepare('DELETE FROM sessions WHERE expires_at < ?')
        .run(ctx.clock.iso()).changes;
      ctx.log.debug({ removed }, 'pruned sessions');
    },
    'trash.purge': async () => {
      const cutoff = new Date(ctx.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const rows = ctx.db
        .prepare('SELECT id FROM objects WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 500')
        .all(cutoff) as { id: string }[];
      const actorId = primaryUserId(ctx);
      for (const row of rows) ctx.services.objects.purge(row.id, actorId);
    },
    'attachment.gc': async () => {
      const removed = await ctx.services.attachments.gc();
      ctx.log.info({ removed }, 'attachment garbage collection finished');
    },
    'reference.enrich': async (payload) => {
      const referenceId = String(payload.referenceId ?? '');
      if (!referenceId) throw new Error('Missing referenceId');
      await ctx.services.literature.enrichFromDoi(referenceId, primaryUserId(ctx));
    },
  };
  worker.registerAll(handlers);
  return worker;
}

export interface SchedulerHandle {
  stop(): void;
}

export function localParts(now: Date, timeZone: string): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function runScheduled(ctx: Ctx, now = ctx.clock.now()): void {
  const users = ctx.db.prepare('SELECT id, timezone FROM users').all() as {
    id: string;
    timezone: string;
  }[];
  const app = ctx.services.settings.getApp();
  for (const user of users) {
    const local = localParts(now, user.timezone);
    const prefs = ctx.services.settings.getUserSettings(user.id);
    if (prefs.digestEnabled && local.time >= app.digestTime) {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayDate = localParts(yesterday, user.timezone).date;
      const existing = ctx.db
        .prepare('SELECT status, source_event_seq FROM daily_digests WHERE user_id = ? AND date = ?')
        .get(user.id, yesterdayDate) as
        | { status: string; source_event_seq: number | null }
        | undefined;
      const latestSeq = ctx.services.activity.maxSeqInRange(yesterdayDate, user.timezone);
      const needsDigest =
        !existing ||
        existing.status !== 'ready' ||
        (existing.source_event_seq ?? 0) < latestSeq;
      if (needsDigest) {
        const hour = local.time.slice(0, 2);
        ctx.jobs.enqueue('digest.generate', {
          payload: { userId: user.id, date: yesterdayDate, force: false, actorId: user.id },
          idempotencyKey: `digest:schedule:${user.id}:${yesterdayDate}:${hour}`,
          priority: 50,
          maxAttempts: 3,
        });
      }
    }
    if (local.time >= '03:00') {
      const existingBackup = ctx.db
        .prepare("SELECT 1 AS ok FROM backups WHERE kind = 'auto' AND status = 'ready' AND created_at >= ?")
        .get(`${local.date}T00:00:00.000Z`);
      if (!existingBackup) {
        const hour = local.time.slice(0, 2);
        ctx.jobs.enqueue('backup.create', {
          payload: { kind: 'auto', actorId: user.id },
          idempotencyKey: `backup:auto:${local.date}:${hour}`,
          priority: 20,
          maxAttempts: 2,
        });
      }
    }
    if (local.time >= '05:00') {
      ctx.jobs.enqueue('attachment.gc', {
        payload: {},
        idempotencyKey: `gc:${local.date}`,
        priority: 200,
      });
    }
    if (local.time >= '04:00') {
      const actorId = user.id;
      ctx.jobs.enqueue('trash.purge', {
        payload: { actorId },
        idempotencyKey: `trash:purge:${local.date}`,
        priority: 150,
      });
    }
    const hour = local.time.slice(0, 2);
    ctx.jobs.enqueue('sessions.prune', {
      payload: {},
      idempotencyKey: `sessions:prune:${local.date}:${hour}`,
      priority: 300,
    });
  }
}

export function startScheduler(ctx: Ctx, intervalMs = 60_000): SchedulerHandle {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    try {
      runScheduled(ctx);
    } catch (error) {
      ctx.log.error({ error }, 'scheduler tick failed');
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  setTimeout(tick, 2000).unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// Reference to satisfy generated docs/types without importing config in this file.
export type { AppConfig };
