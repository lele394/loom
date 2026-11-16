import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  paginationSchema,
  questionAnswerSchema,
  questionCreateSchema,
  questionUpdateSchema,
} from '../../../shared/schemas';

export async function questionRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/questions', async (request, reply) => {
    const query = request.query as { projectId?: string; status?: string; limit?: string; offset?: string };
    const page = parse(paginationSchema, query);
    return reply.send({
      questions: ctx.services.questions.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status
          ? { status: query.status as 'open' | 'investigating' | 'answered' | 'parked' }
          : {}),
        limit: page.limit,
        offset: page.offset,
      }),
    });
  });

  app.post('/questions', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(questionCreateSchema, request.body);
    return reply.status(201).send(ctx.services.questions.create(input, request.user.id));
  });

  app.get('/questions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.questions.get(id));
  });

  app.patch('/questions/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(questionUpdateSchema, request.body);
    return reply.send(ctx.services.questions.update(id, input, request.user.id));
  });

  app.post('/questions/:id/answer', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(questionAnswerSchema, request.body ?? {});
    return reply.send(ctx.services.questions.answer(id, input, request.user.id));
  });

  app.delete('/questions/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.questions.delete(id, request.user.id);
    return reply.send({ ok: true });
  });
}
