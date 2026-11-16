import type { FastifyInstance } from 'fastify';
import { ZodError, type z } from 'zod';
import { AppError, isAppError } from '../core/errors';
import type { Ctx } from '../ctx';

export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError('validation_failed', 'Request validation failed.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function installErrorHandler(app: FastifyInstance, ctx: Ctx): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    if (error instanceof AppError) {
      reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
          requestId,
        },
      });
      return;
    }
    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'Request validation failed.',
          details: { issues: error.issues },
          requestId,
        },
      });
      return;
    }
    const fastifyError = error as { code?: string; statusCode?: number; message?: string };
    if (fastifyError.code === 'FST_REQ_FILE_TOO_LARGE') {
      reply.status(413).send({
        error: {
          code: 'payload_too_large',
          message: 'The upload exceeds the size limit.',
          requestId,
        },
      });
      return;
    }
    if (fastifyError.code === 'SQLITE_BUSY') {
      reply.status(503).send({
        error: { code: 'db_busy', message: 'The database is busy. Try again.', requestId },
      });
      return;
    }
    ctx.log.error({ requestId, error, errorMessage: (error as Error).message, stack: (error as Error).stack, url: request.url, method: request.method }, 'unhandled error');
    reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong.',
        requestId,
      },
    });
  });
}

export function installNotFoundHandler(app: FastifyInstance, ctx: Ctx, hasSpa: boolean): void {
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.status(404).send({
        error: { code: 'not_found', message: 'Endpoint not found.', requestId: request.id },
      });
      return;
    }
    if (hasSpa) {
      return reply.sendFile('index.html');
    }
    if (ctx.config.devWebUrl) {
      return reply
        .type('text/html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>Loom</title><body style="font-family:system-ui;padding:2rem;line-height:1.6">
           <h1>Loom API is running</h1>
           <p>In development the interface is served by Vite: <a href="${ctx.config.devWebUrl}">${ctx.config.devWebUrl}</a></p>
           <p>For production run <code>npm run build</code> then <code>npm start</code>.</p></body>`,
        );
    }
    reply.type('text/html').send('<h1>Loom</h1><p>No interface build found. Run npm run build.</p>');
  });
}

export function errorIsApp(error: unknown): error is AppError {
  return isAppError(error);
}
