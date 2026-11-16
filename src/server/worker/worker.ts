import type { Ctx } from '../ctx';
import type { JobRow, JobStatus } from './jobs';
import { AppError } from '../core/errors';
import type pino from 'pino';

export type JobHandler = (payload: Record<string, unknown>, ctx: Ctx) => Promise<void>;

const TIMEOUTS: Record<string, number> = {
  'extract.attachment': 120_000,
  'embed.chunks': 120_000,
  'digest.generate': 180_000,
  'backup.create': 600_000,
  'backup.verify': 300_000,
  'search.reindex': 600_000,
  'reference.summarize': 240_000,
  'reference.reextract': 240_000,
};

const NON_RETRYABLE = new Set([
  'validation_failed',
  'unsupported_file',
  'provider_auth',
  'not_found',
  'ai_unavailable',
]);

export class Worker {
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private busy = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly log: pino.Logger,
  ) {}

  register(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  registerAll(handlers: Record<string, JobHandler>): this {
    for (const [type, handler] of Object.entries(handlers)) this.register(type, handler);
    return this;
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + 10_000;
    while (this.busy && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  async tick(): Promise<boolean> {
    if (this.busy || this.stopping) return false;
    const job = this.ctx.jobs.claim();
    if (!job) return false;
    this.busy = true;
    const started = Date.now();
    try {
      await this.run(job);
    } finally {
      this.busy = false;
    }
    this.log.info(
      { jobId: job.id, type: job.type, durationMs: Date.now() - started },
      'job finished',
    );
    return true;
  }

  private async run(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.ctx.jobs.fail(job.id, new Error(`No handler for job type ${job.type}`), false);
      return;
    }
    const payload = this.ctx.jobs.payload(job);
    const timeout = TIMEOUTS[job.type] ?? 60_000;
    try {
      await withTimeout(handler(payload, this.ctx), timeout);
      this.ctx.jobs.succeed(job.id);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retryable = !(error instanceof AppError) ? true : !NON_RETRYABLE.has(code ?? '');
      this.log.warn(
        { jobId: job.id, type: job.type, attempt: job.attempts, error: (error as Error).message },
        'job failed',
      );
      this.ctx.jobs.fail(job.id, error, retryable);
    }
  }

  /** Deterministically process up to `max` jobs (used by tests and the refresh button). */
  async drain(max = 100): Promise<number> {
    let processed = 0;
    while (processed < max) {
      const did = await this.tick();
      if (!did) break;
      processed++;
    }
    return processed;
  }

  status(): { registered: string[]; busy: boolean } {
    return { registered: [...this.handlers.keys()], busy: this.busy };
  }

  queueStatus(): Record<JobStatus, number> {
    const rows = this.ctx.jobs.list(undefined, 5000);
    const counts: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };
    for (const row of rows) counts[row.status]++;
    return counts;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError('provider_timeout', 'The job timed out.')), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
