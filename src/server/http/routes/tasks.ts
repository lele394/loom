import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  taskCompleteSchema,
  taskCreateSchema,
  taskListQuerySchema,
  taskMoveSchema,
  taskUpdateSchema,
} from '../../../shared/schemas';

export async function taskRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/tasks', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const query = parse(taskListQuerySchema, request.query);
    return reply.send({
      tasks: ctx.services.tasks.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.columnId ? { columnId: query.columnId } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.due ? { due: query.due } : {}),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
        timezone: request.user.timezone,
      }),
    });
  });

  app.post('/tasks', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(taskCreateSchema, request.body);
    return reply.status(201).send(ctx.services.tasks.create(input, request.user.id));
  });

  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.tasks.get(id));
  });

  app.patch('/tasks/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(taskUpdateSchema, request.body);
    return reply.send(ctx.services.tasks.update(id, input, request.user.id));
  });

  app.delete('/tasks/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.tasks.delete(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/tasks/:id/move', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(taskMoveSchema, request.body);
    return reply.send(ctx.services.tasks.move(id, input.columnId, input.position, request.user.id));
  });

  app.post('/tasks/:id/complete', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(taskCompleteSchema, request.body);
    return reply.send(ctx.services.tasks.complete(id, input.done, request.user.id));
  });
}
