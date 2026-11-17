import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  calendarItemCreateSchema,
  calendarItemUpdateSchema,
  calendarQuerySchema,
  calendarSubscriptionCreateSchema,
  calendarSubscriptionQuerySchema,
  calendarUpcomingQuerySchema,
} from '../../../shared/schemas';

export async function calendarRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/calendar', async (request, reply) => {
    const query = parse(calendarQuerySchema, request.query);
    return reply.send({
      items: ctx.services.calendar.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      }),
    });
  });

  app.get('/calendar/upcoming', async (request, reply) => {
    const query = parse(calendarUpcomingQuerySchema, request.query);
    return reply.send({
      items: ctx.services.calendar.upcoming({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        limit: query.limit,
      }),
    });
  });

  app.get('/calendar/subscriptions', async (request, reply) => {
    const query = parse(calendarSubscriptionQuerySchema, request.query);
    return reply.send({
      subscriptions: ctx.services.calendar.listSubscriptions({
        ...(query.projectId ? { projectId: query.projectId } : {}),
      }),
    });
  });

  app.post(
    '/calendar/subscriptions',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const input = parse(calendarSubscriptionCreateSchema, request.body);
      return reply.status(201).send(
        await ctx.services.calendar.addSubscription(input, request.user.id),
      );
    },
  );

  app.post(
    '/calendar/subscriptions/:id/sync',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const { id } = request.params as { id: string };
      return reply.send(await ctx.services.calendar.syncSubscription(id, request.user.id));
    },
  );

  app.delete('/calendar/subscriptions/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.calendar.removeSubscription(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/calendar', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(calendarItemCreateSchema, request.body);
    return reply.status(201).send(ctx.services.calendar.create(input, request.user.id));
  });

  app.patch('/calendar/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(calendarItemUpdateSchema, request.body);
    return reply.send(ctx.services.calendar.update(id, input, request.user.id));
  });

  app.delete('/calendar/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.calendar.remove(id, request.user.id);
    return reply.send({ ok: true });
  });
}
