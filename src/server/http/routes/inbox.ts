import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { inboxConvertSchema, inboxCreateSchema } from '../../../shared/schemas';

export async function inboxRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/inbox', async (request, reply) => {
    const query = request.query as { status?: string };
    const status =
      query.status === 'triaged' || query.status === 'archived' || query.status === 'new'
        ? query.status
        : 'new';
    return reply.send({ items: ctx.services.inbox.list(status), newCount: ctx.services.inbox.countNew() });
  });

  app.post('/inbox', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(inboxCreateSchema, request.body);
    return reply.status(201).send(ctx.services.inbox.capture(input, request.user.id));
  });

  app.post('/inbox/:id/convert', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(inboxConvertSchema, request.body);
    return reply.send(ctx.services.inbox.convert(id, input, request.user.id));
  });

  app.post('/inbox/:id/archive', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.inbox.archive(id, request.user.id));
  });

  app.delete('/inbox/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.inbox.delete(id, request.user.id);
    return reply.send({ ok: true });
  });
}
