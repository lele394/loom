import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  appSettingsUpdateSchema,
  appearanceUpdateSchema,
  githubTokenSchema,
  userSettingsUpdateSchema,
} from '../../../shared/schemas';

export async function settingsRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/settings', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    return reply.send({
      app: ctx.services.settings.getApp(),
      appearance: ctx.services.settings.getAppearance(request.user.id),
      preferences: ctx.services.settings.getUserSettings(request.user.id),
      user: request.user,
      providers: ctx.services.settings.listProviders(),
      github: ctx.services.settings.getGithubCredential(request.user.id),
      limits: {
        maxUploadMb: ctx.services.settings.getApp().maxUploadMb,
        maxStorageGb: Math.round(ctx.config.maxStorageBytes / (1024 * 1024 * 1024)),
      },
    });
  });

  app.patch('/settings/app', async (request, reply) => {
    const input = parse(appSettingsUpdateSchema, request.body);
    return reply.send(ctx.services.settings.updateApp(input));
  });

  app.patch('/settings/appearance', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(appearanceUpdateSchema, request.body);
    return reply.send(ctx.services.settings.updateAppearance(request.user.id, input));
  });

  app.patch('/settings/preferences', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(userSettingsUpdateSchema, request.body);
    if (input.timezone) {
      ctx.services.auth.updateProfile(request.user.id, { timezone: input.timezone });
    }
    return reply.send(ctx.services.settings.updateUserSettings(request.user.id, input));
  });

  app.put('/settings/github', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(githubTokenSchema, request.body);
    return reply.send(await ctx.services.settings.saveGithubToken(request.user.id, input.token));
  });

  app.delete('/settings/github', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    return reply.send(ctx.services.settings.clearGithubToken(request.user.id));
  });

  app.patch('/settings/account', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const body = request.body as { displayName?: string; timezone?: string };
    const user = ctx.services.auth.updateProfile(request.user.id, {
      ...(typeof body.displayName === 'string' ? { displayName: body.displayName } : {}),
      ...(typeof body.timezone === 'string' ? { timezone: body.timezone } : {}),
    });
    return reply.send(user);
  });

  app.get('/jobs', async (request, reply) => {
    const query = request.query as { status?: string };
    const status =
      query.status && ['queued', 'running', 'succeeded', 'failed', 'dead'].includes(query.status)
        ? (query.status as 'queued' | 'running' | 'succeeded' | 'failed' | 'dead')
        : undefined;
    return reply.send({
      jobs: ctx.jobs.list(status, 100),
      stats: ctx.jobs.stats(),
    });
  });

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = ctx.jobs.find(id);
    if (!job) return reply.status(404).send({ error: { code: 'not_found', message: 'Job not found.' } });
    return reply.send(job);
  });

  app.post('/jobs/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = ctx.jobs.retry(id);
    return reply.send({ ok });
  });
}
