import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { searchQuerySchema } from '../../../shared/schemas';
import { AppError } from '../../core/errors';

export async function searchRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/search', async (request, reply) => {
    const query = parse(searchQuerySchema, request.query);
    const response = await ctx.services.search.search({
      q: query.q,
      ...(query.type ? { type: query.type } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.tag ? { tag: query.tag } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      mode: query.mode,
      limit: query.limit,
    });
    return reply.send(response);
  });

  app.get('/search/suggest', async (request, reply) => {
    const query = request.query as { q?: string };
    return reply.send({ results: ctx.services.search.suggest(query.q ?? '', 8) });
  });

  app.get('/search/status', async (_request, reply) => {
    return reply.send(ctx.services.search.status());
  });

  app.post('/search/reindex', async (_request, reply) => {
    const jobId = ctx.jobs.enqueue('search.reindex', {
      payload: {},
      idempotencyKey: `reindex:${ctx.clock.iso()}`,
      priority: 30,
    });
    return reply.status(202).send({ jobId });
  });

  app.post('/search/embeddings/rebuild', async (_request, reply) => {
    if (!ctx.services.search.embeddingConfig()) {
      throw new AppError(
        'ai_unavailable',
        'Select an embedding provider and model before running a backfill.',
      );
    }
    const status = ctx.services.search.status();
    if (status.chunks === 0) {
      return reply.status(202).send({
        jobId: null,
        message: 'There are no text chunks to embed yet. Reindex your content first.',
      });
    }
    if (status.pending === 0) {
      return reply.status(202).send({
        jobId: null,
        message: 'All chunks are already embedded with the current model.',
      });
    }
    if (
      status.embeddingJob &&
      (status.embeddingJob.status === 'queued' || status.embeddingJob.status === 'running')
    ) {
      return reply.status(202).send({
        jobId: status.embeddingJob.id,
        message: 'An embedding job is already running.',
      });
    }
    const jobId = ctx.jobs.enqueue('embed.chunks', {
      payload: {},
      idempotencyKey: `embed:all:${ctx.clock.iso()}`,
      priority: 60,
      maxAttempts: 3,
    });
    return reply.status(202).send({ jobId });
  });
}
