import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { activityQuerySchema, digestDateSchema, journalGenerateSchema } from '../../../shared/schemas';
import { isValidDateString, todayIn, zonedDayRange } from '../../core/time';
import { AppError } from '../../core/errors';

export async function activityRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/activity', async (request, reply) => {
    const query = parse(activityQuerySchema, request.query);
    return reply.send({ events: ctx.services.activity.list(query) });
  });

  app.get('/activity/diff', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const query = request.query as { date?: string };
    const date = query.date ?? todayIn(request.user.timezone, ctx.clock);
    if (!isValidDateString(date)) throw new AppError('bad_request', 'Invalid date.');
    return reply.send(ctx.services.activity.diff(date, request.user.timezone));
  });

  app.get('/journal', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const query = request.query as { from?: string; to?: string };
    return reply.send({ digests: ctx.services.journal.list(request.user.id, query.from, query.to) });
  });

  app.get('/journal/:date', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { date } = request.params as { date: string };
    parse(digestDateSchema, date);
    const result = ctx.services.journal.get(request.user.id, date);
    const { start, end } = zonedDayRange(date, request.user.timezone);
    const events = ctx.services.activity.list({
      from: start.toISOString(),
      to: new Date(end.getTime() - 1).toISOString(),
      limit: 200,
    });
    return reply.send({ ...result, events });
  });

  app.post('/journal/:date/generate', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { date } = request.params as { date: string };
    parse(digestDateSchema, date);
    const input = parse(journalGenerateSchema, request.body ?? {});
    const { jobId } = ctx.services.journal.enqueueGeneration(
      request.user.id,
      date,
      input.force,
      request.user.id,
    );
    return reply.status(202).send({ jobId });
  });

  app.get('/journal/:date/revisions', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { date } = request.params as { date: string };
    parse(digestDateSchema, date);
    return reply.send({ revisions: ctx.services.journal.revisions(request.user.id, date) });
  });
}
