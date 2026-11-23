import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import type { AppCapabilities } from '../capabilities';
import { addDays, todayIn } from '../../core/time';
import { latestLoomVersion } from '../../core/version';
import type { DashboardData } from '../../../shared/types';

export async function metaRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/meta', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const ai = ctx.services.ai.status();
    const search = ctx.services.search.status();
    const capabilities: AppCapabilities = {
      ai: ai.chat,
      chat: ai.chat,
      embeddings: ai.embeddings,
      semanticSearch: search.semanticAvailable,
      urlIngest: true,
      backup: true,
      version: ctx.config.appVersion,
      limits: {
        maxUploadMb: ctx.services.settings.getApp().maxUploadMb,
        maxUploadBytes: ctx.config.maxUploadBytes,
        maxStorageGb: Math.round(ctx.config.maxStorageBytes / (1024 * 1024 * 1024)),
      },
    };
    return reply.send({
      version: ctx.config.appVersion,
      capabilities,
      appearance: ctx.services.settings.getAppearance(request.user.id),
      preferences: ctx.services.settings.getUserSettings(request.user.id),
      ai,
      search,
      app: ctx.services.settings.getApp(),
      user: request.user,
    });
  });

  app.get('/meta/version-check', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const query = request.query as { refresh?: string };
    const latest = await latestLoomVersion(query.refresh === '1');
    return reply.send({
      localVersion: ctx.config.appVersion,
      latestVersion: latest.version,
      latestCommitSha: latest.commitSha,
      latestCommitUrl: latest.commitUrl,
      latestCommittedAt: latest.committedAt,
      checkedAt: new Date().toISOString(),
    });
  });

  app.get('/dashboard', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const user = request.user;
    const today = todayIn(user.timezone, ctx.clock);
    const projects = ctx.services.projects.list(false);
    const overdue = ctx.services.tasks.list({ due: 'overdue', timezone: user.timezone, limit: 10 });
    const dueToday = ctx.services.tasks.list({ due: 'today', timezone: user.timezone, limit: 10 });
    const seen = new Set(overdue.map((task) => task.id));
    const dueTasks = [...overdue, ...dueToday.filter((task) => !seen.has(task.id))].slice(0, 10);
    const openTaskCount = (
      ctx.db
        .prepare(
          "SELECT COUNT(*) AS count FROM tasks t JOIN objects o ON o.id = t.id WHERE o.deleted_at IS NULL AND t.completed_at IS NULL",
        )
        .get() as { count: number }
    ).count;
    const openQuestionCount = (
      ctx.db
        .prepare(
          "SELECT COUNT(*) AS count FROM questions q JOIN objects o ON o.id = q.id WHERE o.deleted_at IS NULL AND q.status IN ('open','investigating')",
        )
        .get() as { count: number }
    ).count;
    const yesterday = addDays(today, -1);
    const journal = ctx.services.journal.get(user.id, yesterday);
    const ai = ctx.services.ai.status();
    const search = ctx.services.search.status();
    const data: DashboardData = {
      greetingName: user.displayName,
      projects,
      dueTasks,
      openTaskCount,
      inboxCount: ctx.services.inbox.countNew(),
      openQuestionCount,
      recentActivity: ctx.services.activity.list({ limit: 12 }),
      yesterdayDigest: journal.digest,
      capabilities: { ai: ai.chat, semanticSearch: search.semanticAvailable },
    };
    return reply.send(data);
  });
}
