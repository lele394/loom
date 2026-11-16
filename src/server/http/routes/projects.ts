import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  columnCreateSchema,
  columnUpdateSchema,
  projectArchiveSchema,
  projectCreateSchema,
  projectUpdateSchema,
} from '../../../shared/schemas';
import { todayIn } from '../../core/time';

const flag = (value: unknown): boolean => value === '1' || value === 'true' || value === true;

export async function projectRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/projects', async (request, reply) => {
    const query = request.query as { includeArchived?: string };
    return reply.send({ projects: ctx.services.projects.list(flag(query.includeArchived)) });
  });

  app.post('/projects', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(projectCreateSchema, request.body);
    return reply.status(201).send(ctx.services.projects.create(input, request.user.id));
  });

  app.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = ctx.services.projects.get(id);
    if (!project) return reply.status(404).send({ error: { code: 'not_found', message: 'Project not found.' } });
    return reply.send({ ...project, counts: ctx.services.projects.countsFor(id) });
  });

  app.patch('/projects/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(projectUpdateSchema, request.body);
    return reply.send(ctx.services.projects.update(id, input, request.user.id));
  });

  app.delete('/projects/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.projects.softDelete(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/projects/:id/restore', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.projects.restore(id, request.user.id));
  });

  app.post('/projects/:id/archive', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(projectArchiveSchema, request.body);
    return reply.send(ctx.services.projects.setArchived(id, input.archived, request.user.id));
  });

  app.get('/projects/:id/overview', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const project = ctx.services.projects.get(id);
    if (!project) throw new Error('Project not found');
    const today = todayIn(request.user.timezone, ctx.clock);
    const tasks = ctx.services.tasks.list({ projectId: id, due: 'today', timezone: request.user.timezone, limit: 10 });
    const openQuestions = ctx.services.questions
      .list({ projectId: id, limit: 5 })
      .filter((question) => question.status === 'open' || question.status === 'investigating');
    return reply.send({
      project,
      counts: ctx.services.projects.countsFor(id),
      today,
      dueToday: tasks,
      openQuestions,
      recentActivity: ctx.services.activity.list({ projectId: id, limit: 15 }),
    });
  });

  app.get('/projects/:id/columns', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ columns: ctx.services.projects.columns(id) });
  });

  app.post('/projects/:id/columns', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(columnCreateSchema, request.body);
    return reply.status(201).send(ctx.services.projects.createColumn(id, input, request.user.id));
  });

  app.patch('/board-columns/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(columnUpdateSchema, request.body);
    return reply.send(ctx.services.projects.updateColumn(id, input, request.user.id));
  });

  app.delete('/board-columns/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.projects.deleteColumn(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.get('/projects/:id/board', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = ctx.services.projects.get(id);
    if (!project) throw new Error('Project not found');
    return reply.send({ project, ...ctx.services.tasks.board(id) });
  });
}
