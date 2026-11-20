import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { SettingsService } from '../settings/service';
import type { JobQueue } from '../../worker/jobs';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { parseJson } from '../../core/text';
import { isValidDateString, todayIn } from '../../core/time';
import { createProvider } from '../../ai';
import { DIGEST_PROMPT_VERSION, buildDigestMessages } from '../../ai/prompts';
import type { DailyDiff, Digest, JournalNote } from '../../../shared/types';

interface DigestRow {
  id: string;
  user_id: string;
  date: string;
  timezone: string;
  diff_json: string;
  summary_md: string | null;
  model: string | null;
  status: 'pending' | 'ready' | 'failed';
  generated_at: string | null;
  regenerated_count: number;
  source_event_seq: number | null;
  source_note_updated_at: string | null;
}

function mapDigest(row: DigestRow, diffOverride?: DailyDiff): Digest {
  return {
    id: row.id,
    date: row.date,
    timezone: row.timezone,
    diff: diffOverride ?? parseJson<DailyDiff>(row.diff_json, {
      date: row.date,
      timezone: row.timezone,
      totals: { added: 0, updated: 0, completed: 0, removed: 0 },
      byProject: [],
      eventCount: 0,
      eventSeqRange: null,
    }),
    summaryMarkdown: row.summary_md,
    model: row.model,
    status: row.status,
    generatedAt: row.generated_at,
    regeneratedCount: row.regenerated_count,
    sourceEventSeq: row.source_event_seq,
    stale: false,
  };
}

export class JournalService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly settings: SettingsService,
    private readonly jobs: JobQueue,
  ) {}

  private user(id: string): { id: string; timezone: string; display_name: string } {
    const row = this.db
      .prepare('SELECT id, timezone, display_name FROM users WHERE id = ?')
      .get(id) as { id: string; timezone: string; display_name: string } | undefined;
    if (!row) throw notFound('User');
    return row;
  }

  get(userId: string, date?: string): { digest: Digest | null; diff: DailyDiff } {
    const user = this.user(userId);
    const day = date ?? todayIn(user.timezone, this.clock);
    if (!isValidDateString(day)) throw new AppError('bad_request', 'Invalid date.');
    const diff = this.activity.diff(day, user.timezone);
    const row = this.db
      .prepare('SELECT * FROM daily_digests WHERE user_id = ? AND date = ?')
      .get(userId, day) as DigestRow | undefined;
    if (!row) return { digest: null, diff };
    const latestSeq = this.activity.maxSeqInRange(day, user.timezone);
    const digest = mapDigest(row, diff);
    const note = this.getNote(userId, day);
    digest.stale =
      (row.source_event_seq ?? 0) < latestSeq ||
      (row.source_note_updated_at ?? null) !== (note?.updatedAt ?? null);
    return { digest, diff };
  }

  getNote(userId: string, date: string): JournalNote | null {
    this.user(userId);
    if (!isValidDateString(date)) throw new AppError('bad_request', 'Invalid date.');
    const row = this.db
      .prepare('SELECT date, note_md, updated_at FROM journal_notes WHERE user_id = ? AND date = ?')
      .get(userId, date) as { date: string; note_md: string; updated_at: string } | undefined;
    return row ? { date: row.date, noteMarkdown: row.note_md, updatedAt: row.updated_at } : null;
  }

  saveNote(userId: string, date: string, noteMarkdown: string): JournalNote | null {
    this.user(userId);
    if (!isValidDateString(date)) throw new AppError('bad_request', 'Invalid date.');
    const now = this.clock.iso();
    if (!noteMarkdown.trim()) {
      this.db.prepare('DELETE FROM journal_notes WHERE user_id = ? AND date = ?').run(userId, date);
      return null;
    }
    this.db
      .prepare(
        `INSERT INTO journal_notes (user_id, date, note_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET note_md = excluded.note_md, updated_at = excluded.updated_at`,
      )
      .run(userId, date, noteMarkdown, now, now);
    return this.getNote(userId, date);
  }

  list(userId: string, from?: string, to?: string, limit = 60): Digest[] {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (from) {
      clauses.push('date >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('date <= ?');
      params.push(to);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM daily_digests WHERE ${clauses.join(' AND ')} ORDER BY date DESC LIMIT ?`,
      )
      .all(...params, limit) as DigestRow[];
    return rows.map((row) => {
      const user = this.user(userId);
      const latestSeq = this.activity.maxSeqInRange(row.date, user.timezone);
      const note = this.getNote(userId, row.date);
      const digest = mapDigest(row);
      digest.stale =
        (row.source_event_seq ?? 0) < latestSeq ||
        (row.source_note_updated_at ?? null) !== (note?.updatedAt ?? null);
      return digest;
    });
  }

  enqueueGeneration(
    userId: string,
    date: string,
    force: boolean,
    actorId: string,
  ): { jobId: string | null } {
    const user = this.user(userId);
    if (!isValidDateString(date)) throw new AppError('bad_request', 'Invalid date.');
    const latestSeq = this.activity.maxSeqInRange(date, user.timezone);
    const key = force
      ? `digest:${userId}:${date}:force:${this.clock.iso()}`
      : `digest:${userId}:${date}:${latestSeq}`;
    const jobId = this.jobs.enqueue('digest.generate', {
      payload: { userId, date, force, actorId },
      idempotencyKey: key,
      maxAttempts: 3,
      priority: 40,
    });
    return { jobId };
  }

  /** Job handler. Never invents events: the diff is the only input to the model. */
  async runGeneration(userId: string, date: string, force: boolean, actorId?: string): Promise<Digest> {
    const user = this.user(userId);
    const diff = this.activity.diff(date, user.timezone);
    const latestSeq = this.activity.maxSeqInRange(date, user.timezone);
    const note = this.getNote(userId, date);
    const noteUpdatedAt = note?.updatedAt ?? null;
    const existing = this.db
      .prepare('SELECT * FROM daily_digests WHERE user_id = ? AND date = ?')
      .get(userId, date) as DigestRow | undefined;

    if (
      existing &&
      !force &&
      existing.status === 'ready' &&
      (existing.source_event_seq ?? 0) >= latestSeq &&
      (existing.source_note_updated_at ?? null) === noteUpdatedAt
    ) {
      return mapDigest(existing, diff);
    }

    const config = this.settings.getProviderConfig();
    let summary: string | null = null;
    let model: string | null = null;
    let failed = false;
    let failureMessage: string | null = null;

    if (config && (config.chatModel || config.kind === 'fake')) {
      const provider = createProvider(config);
      const prompt = buildDigestMessages(diff, undefined, note?.noteMarkdown ?? '');
      try {
        let text = '';
        for await (const chunk of provider.chat({
          model: config.chatModel,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          // Reasoning models can spend a large part of the budget on hidden
          // reasoning before emitting the actual Markdown answer.
          maxTokens: this.settings.getApp().aiSummaryOutputTokens,
          temperature: 0.1,
          signal: AbortSignal.timeout(180_000),
        })) {
          if (chunk.type === 'text') text += chunk.text;
        }
        const trimmed = text.trim();
        if (!trimmed) {
          throw new Error(
            'The AI model returned no digest text. It may have spent its whole token budget on hidden reasoning.',
          );
        }
        summary = trimmed;
        model = `${config.chatModel || 'fake'} (${DIGEST_PROMPT_VERSION})`;
      } catch (error) {
        failed = true;
        summary = null;
        model = config.chatModel || 'fake';
        failureMessage = error instanceof Error ? error.message : 'The digest summary could not be generated.';
      }
    }

    const now = this.clock.iso();
    const id = existing?.id ?? newId('dgt');
    const regenerated = existing ? existing.regenerated_count + (existing.summary_md ? 1 : 0) : 0;
    const tx = this.db.transaction(() => {
      if (existing?.summary_md) {
        this.db
          .prepare(
            `INSERT INTO digest_revisions (id, digest_id, summary_md, diff_json, model, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(newId('rev'), existing.id, existing.summary_md, existing.diff_json, existing.model, now);
      }
      this.db
        .prepare(
          `INSERT INTO daily_digests (id, user_id, date, timezone, diff_json, summary_md, model, status, generated_at, regenerated_count, source_event_seq, source_note_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, date) DO UPDATE SET
             diff_json = excluded.diff_json,
             summary_md = excluded.summary_md,
             model = excluded.model,
             status = excluded.status,
             generated_at = excluded.generated_at,
             regenerated_count = excluded.regenerated_count,
             source_event_seq = excluded.source_event_seq,
             source_note_updated_at = excluded.source_note_updated_at`,
        )
        .run(
          id,
          userId,
          date,
          user.timezone,
          JSON.stringify(diff),
          summary,
          model,
          failed ? 'failed' : 'ready',
          now,
          regenerated,
          latestSeq,
          noteUpdatedAt,
        );
      if (!failed) {
        this.activity.record({
          actorId: actorId ?? userId,
          action: 'journal.digest_generated',
          summary: `Generated the journal digest for ${date}`,
          source: 'job',
        });
      }
    });
    tx();

    if (failed) {
      throw new AppError(
        'provider_error',
        failureMessage ?? 'The digest summary could not be generated; the diff is preserved.',
      );
    }
    const row = this.db
      .prepare('SELECT * FROM daily_digests WHERE user_id = ? AND date = ?')
      .get(userId, date) as DigestRow;
    return mapDigest(row, diff);
  }

  revisions(userId: string, date: string): { id: string; summaryMarkdown: string; model: string | null; createdAt: string }[] {
    const digest = this.db
      .prepare('SELECT id FROM daily_digests WHERE user_id = ? AND date = ?')
      .get(userId, date) as { id: string } | undefined;
    if (!digest) return [];
    const rows = this.db
      .prepare(
        'SELECT id, summary_md, model, created_at FROM digest_revisions WHERE digest_id = ? ORDER BY created_at DESC',
      )
      .all(digest.id) as { id: string; summary_md: string; model: string | null; created_at: string }[];
    return rows.map((row) => ({
      id: row.id,
      summaryMarkdown: row.summary_md,
      model: row.model,
      createdAt: row.created_at,
    }));
  }
}
