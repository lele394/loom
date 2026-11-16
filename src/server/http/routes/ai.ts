import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  aiActionSchema,
  aiProviderCreateSchema,
  aiProviderUpdateSchema,
  chatSendSchema,
  conversationCreateSchema,
  conversationUpdateSchema,
  messageExtractTasksSchema,
  messageToNoteSchema,
} from '../../../shared/schemas';
import type { ChatEvent } from '../../modules/ai/service';
import { AppError } from '../../core/errors';

export async function aiRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/ai/status', async (_request, reply) => {
    return reply.send(ctx.services.ai.status());
  });

  app.get('/ai/providers', async (_request, reply) => {
    return reply.send({ providers: ctx.services.settings.listProviders() });
  });

  app.post('/ai/providers', async (request, reply) => {
    const input = parse(aiProviderCreateSchema, request.body);
    const id = ctx.services.settings.createProvider(input);
    if (input.embedModel) {
      ctx.jobs.enqueue('embed.chunks', {
        payload: {},
        idempotencyKey: `embed:providers:${Date.now()}`,
        priority: 60,
        maxAttempts: 3,
      });
    }
    return reply.status(201).send({ id, providers: ctx.services.settings.listProviders() });
  });

  app.patch('/ai/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(aiProviderUpdateSchema, request.body);
    if (!ctx.services.settings.updateProvider(id, input)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Provider not found.' } });
    }
    if (input.embedModel) {
      ctx.jobs.enqueue('embed.chunks', {
        payload: {},
        idempotencyKey: `embed:providers:${Date.now()}`,
        priority: 60,
        maxAttempts: 3,
      });
    }
    return reply.send({ providers: ctx.services.settings.listProviders() });
  });

  app.delete('/ai/providers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!ctx.services.settings.deleteProvider(id)) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Provider not found.' } });
    }
    return reply.send({ ok: true });
  });

  app.post('/ai/providers/:id/test', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await ctx.services.ai.testProvider(id));
  });

  app.get('/ai/conversations', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    return reply.send({ conversations: ctx.services.ai.listConversations(request.user.id) });
  });

  app.post('/ai/conversations', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(conversationCreateSchema, request.body);
    return reply.status(201).send(ctx.services.ai.createConversation(request.user.id, input));
  });

  app.get('/ai/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.ai.getConversation(id));
  });

  app.patch('/ai/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(conversationUpdateSchema, request.body);
    return reply.send(ctx.services.ai.updateConversation(id, input));
  });

  app.delete('/ai/conversations/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    ctx.services.ai.deleteConversation(id);
    return reply.send({ ok: true });
  });

  app.post(
    '/ai/conversations/:id/messages',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(chatSendSchema, request.body);
    if (!ctx.services.ai.status().chat) {
      throw new AppError('ai_unavailable', 'No AI provider is configured.');
    }

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
    });
    raw.flushHeaders?.();
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) raw.write(': ping\n\n');
    }, 15_000);
    heartbeat.unref();
    raw.on('close', () => controller.abort());

    const send = (event: ChatEvent) => {
      if (raw.writableEnded) return;
      raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    try {
      for await (const event of ctx.services.ai.chat(id, input.content, {
        contextObjectIds: input.contextObjectIds,
        userId: request.user.id,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) break;
        send(event);
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'provider_error';
      send({
        type: 'error',
        code,
        message: (error as Error).message || 'The AI request failed.',
      });
    } finally {
      clearInterval(heartbeat);
      if (!raw.writableEnded) raw.end();
    }
    },
  );

  app.post('/ai/actions', async (request, reply) => {
    const input = parse(aiActionSchema, request.body);
    return reply.send(
      await ctx.services.ai.act({
        action: input.action,
        objectIds: input.objectIds,
        instruction: input.instruction,
      }),
    );
  });

  app.post('/ai/messages/:id/to-note', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(messageToNoteSchema, request.body ?? {});
    return reply.status(201).send(ctx.services.ai.messageToNote(id, input, request.user.id));
  });

  app.post('/ai/messages/:id/extract-tasks', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(messageExtractTasksSchema, request.body);
    return reply.send(await ctx.services.ai.extractTasks(id, input, request.user.id));
  });
}
