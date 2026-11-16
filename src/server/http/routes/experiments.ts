import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { experimentCreateSchema, experimentUpdateSchema, paginationSchema } from '../../../shared/schemas';

export async function experimentRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/experiments', async (request, reply) => {
    const query = request.query as { projectId?: string; status?: string; limit?: string; offset?: string };
    const page = parse(paginationSchema, query);
    return reply.send({
      experiments: ctx.services.experiments.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status
          ? { status: query.status as 'planned' | 'running' | 'completed' | 'abandoned' }
          : {}),
        limit: page.limit,
        offset: page.offset,
      }),
    });
  });

  app.post('/experiments', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(experimentCreateSchema, request.body);
    return reply.status(201).send(ctx.services.experiments.create(input, request.user.id));
  });

  app.get('/experiments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.experiments.get(id));
  });

  app.patch('/experiments/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(experimentUpdateSchema, request.body);
    return reply.send(ctx.services.experiments.update(id, input, request.user.id));
  });

  app.delete('/experiments/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.experiments.delete(id, request.user.id);
    return reply.send({ ok: true });
  });
}
