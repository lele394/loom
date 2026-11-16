import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../../http/errors';
import { clearSessionCookies, setSessionCookies } from '../../http/authGuard';
import { changePasswordSchema, loginSchema, setupSchema } from '../../../shared/schemas';
import { AppError } from '../../core/errors';
import { SESSION_COOKIE } from '../../http/authGuard';

export async function authRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/auth/session', async (request, reply) => {
    if (ctx.services.auth.setupRequired()) {
      return reply.send({ user: null, csrfToken: null, setupRequired: true });
    }
    const session = ctx.services.auth.session(request.cookies[SESSION_COOKIE]);
    if (!session) return reply.send({ user: null, csrfToken: null, setupRequired: false });
    return reply.send({
      user: ctx.services.auth.userForSession(session),
      csrfToken: session.csrfToken,
      setupRequired: false,
    });
  });

  app.post(
    '/auth/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const input = parse(setupSchema, request.body);
      const result = ctx.services.auth.setup(input);
      const session = ctx.services.auth.session(result.token);
      if (!session) throw new AppError('internal_error', 'Could not establish a session.');
      setSessionCookies(ctx, reply, result.token, session.csrfToken);
      if (input.starterProject) {
        try {
          ctx.services.projects.create({ name: 'My Research', color: 'lavender' }, result.user.id);
        } catch (error) {
          ctx.log.warn({ error }, 'could not create starter project');
        }
      }
      return reply.status(201).send({ user: result.user, csrfToken: session.csrfToken });
    },
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const input = parse(loginSchema, request.body);
      const result = ctx.services.auth.login(input.username, input.password, {
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      const session = ctx.services.auth.session(result.token);
      if (!session) throw new AppError('internal_error', 'Could not establish a session.');
      setSessionCookies(ctx, reply, result.token, session.csrfToken);
      return reply.send({ user: result.user, csrfToken: session.csrfToken });
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    ctx.services.auth.logout(request.cookies[SESSION_COOKIE]);
    clearSessionCookies(ctx, reply);
    return reply.send({ ok: true });
  });

  app.post('/auth/logout-all', async (request, reply) => {
    if (!request.user) throw new AppError('unauthenticated');
    ctx.services.auth.logoutAll(request.user.id);
    clearSessionCookies(ctx, reply);
    return reply.send({ ok: true });
  });

  app.post('/auth/password', async (request, reply) => {
    if (!request.user || !request.sessionId) throw new AppError('unauthenticated');
    const input = parse(changePasswordSchema, request.body);
    ctx.services.auth.changePassword(
      request.user.id,
      input.currentPassword,
      input.newPassword,
      request.sessionId,
    );
    return reply.send({ ok: true });
  });
}
