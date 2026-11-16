import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import path from 'node:path';
import type { Ctx } from './ctx';
import { API_PREFIX } from '../shared/constants';
import { newId } from './core/ids';
import { installAuthGuard } from './http/authGuard';
import { installErrorHandler, installNotFoundHandler } from './http/errors';
import { authRoutes } from './http/routes/auth';
import { metaRoutes } from './http/routes/meta';
import { projectRoutes } from './http/routes/projects';
import { objectRoutes } from './http/routes/objects';
import { noteRoutes } from './http/routes/notes';
import { taskRoutes } from './http/routes/tasks';
import { literatureRoutes } from './http/routes/literature';
import { experimentRoutes } from './http/routes/experiments';
import { questionRoutes } from './http/routes/questions';
import { inboxRoutes } from './http/routes/inbox';
import { searchRoutes } from './http/routes/search';
import { activityRoutes } from './http/routes/activity';
import { aiRoutes } from './http/routes/ai';
import { settingsRoutes } from './http/routes/settings';
import { dataRoutes } from './http/routes/data';
import { migrationStatus } from './db/migrate';

export async function buildApp(ctx: Ctx) {
  const webRoot = path.resolve(process.cwd(), 'dist/web');
  const hasSpa = existsSync(path.join(webRoot, 'index.html'));

  const app = Fastify({
    logger: {
      level: ctx.config.logLevel,
      base: { app: 'loom', version: ctx.config.appVersion },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.apiKey',
          '*.token',
          '*.secret',
        ],
        censor: '[redacted]',
      },
    },
    trustProxy: ctx.config.trustProxy,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => newId('req'),
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    allowList: (request) => !request.url.startsWith('/api/'),
  });
  await app.register(multipart, {
    limits: {
      fileSize: Math.max(ctx.config.maxUploadBytes, 10 * 1024 * 1024 * 1024),
      files: 10,
      fields: 30,
      parts: 40,
    },
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'SAMEORIGIN');
    reply.header('referrer-policy', 'no-referrer');
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    );
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header(
      'content-security-policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
    );
    if (ctx.config.secureCookies) {
      reply.header('strict-transport-security', 'max-age=31536000');
    }
    if (request.url.startsWith('/api/')) {
      reply.header('cache-control', 'no-store');
    } else if (request.url.startsWith('/assets/')) {
      reply.header('cache-control', 'public, max-age=31536000, immutable');
    } else if (request.url === '/' || request.url.endsWith('.html')) {
      reply.header('cache-control', 'no-cache');
    }
    return payload;
  });

  installErrorHandler(app, ctx);
  installAuthGuard(app, ctx);

  if (hasSpa) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      index: ['index.html'],
      wildcard: false,
      cacheControl: true,
      maxAge: '1h',
    });
  }

  await app.register(
    async (api) => {
      await authRoutes(api, ctx);
      await metaRoutes(api, ctx);
      await projectRoutes(api, ctx);
      await objectRoutes(api, ctx);
      await noteRoutes(api, ctx);
      await taskRoutes(api, ctx);
      await literatureRoutes(api, ctx);
      await experimentRoutes(api, ctx);
      await questionRoutes(api, ctx);
      await inboxRoutes(api, ctx);
      await searchRoutes(api, ctx);
      await activityRoutes(api, ctx);
      await aiRoutes(api, ctx);
      await settingsRoutes(api, ctx);
      await dataRoutes(api, ctx);
    },
    { prefix: API_PREFIX },
  );

  app.get('/healthz', async (_request, reply) => {
    return reply.send({ status: 'ok', uptime: Math.round(process.uptime()), version: ctx.config.appVersion });
  });

  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, unknown> = {};
    let ok = true;
    try {
      const started = Date.now();
      ctx.db.prepare('SELECT 1 AS ok').get();
      checks.db = { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      ok = false;
      checks.db = { ok: false, error: (error as Error).message };
    }
    try {
      const migrations = migrationStatus(ctx.db);
      checks.migrations = { ok: migrations.pending === 0, ...migrations };
      if (migrations.pending > 0) ok = false;
    } catch (error) {
      ok = false;
      checks.migrations = { ok: false, error: (error as Error).message };
    }
    try {
      const stats = await statfs(ctx.config.dataDir);
      checks.disk = {
        ok: stats.bavail > 0,
        freeBytes: stats.bavail * stats.bsize,
      };
      if (stats.bavail === 0) ok = false;
    } catch {
      checks.disk = { ok: false };
    }
    try {
      checks.attachments = { ok: existsSync(ctx.config.attachmentsDir), writable: true };
    } catch {
      checks.attachments = { ok: false };
    }
    checks.worker = ctx.jobs.stats();
    checks.restoreInProgress = ctx.maintenance.restoring;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      checks,
      version: ctx.config.appVersion,
    });
  });

  installNotFoundHandler(app, ctx, hasSpa);
  return app;
}
