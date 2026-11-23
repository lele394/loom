import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  repositoryCreateSchema,
  repositorySyncSchema,
  repositoryUpdateSchema,
} from '../../../shared/schemas';

export async function repositoryRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/projects/:id/repositories', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ repositories: ctx.services.repositories.list(id) });
  });

  app.post(
    '/projects/:id/repositories',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const { id } = request.params as { id: string };
      const input = parse(repositoryCreateSchema, request.body);
      return reply.status(201).send(
        await ctx.services.repositories.add(id, input, request.user.id),
      );
    },
  );

  app.patch('/repositories/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(repositoryUpdateSchema, request.body);
    return reply.send(
      await ctx.services.repositories.updateToken(id, input.token ?? null, request.user.id),
    );
  });

  app.delete('/repositories/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.repositories.remove(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post(
    '/repositories/:id/sync',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const { id } = request.params as { id: string };
      const input = parse(repositorySyncSchema, request.body ?? {});
      return reply.send(
        await ctx.services.repositories.sync(id, request.user.id, input.since),
      );
    },
  );

  app.get('/projects/:id/repository-commits', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as {
      repositoryId?: string;
      limit?: string;
      offset?: string;
      from?: string;
      to?: string;
    };
    const requestedLimit = Number(query.limit);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(100, Math.floor(requestedLimit))
      : 20;
    const requestedOffset = Number(query.offset);
    const offset = Number.isFinite(requestedOffset)
      ? Math.min(1_000_000, Math.max(0, Math.floor(requestedOffset)))
      : 0;
    const page = ctx.services.repositories.listCommits({
      projectId: id,
      ...(query.repositoryId ? { repositoryId: query.repositoryId } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      limit: limit + 1,
      offset,
    });
    return reply.send({
      commits: page.slice(0, limit),
      hasMore: page.length > limit,
    });
  });
}
