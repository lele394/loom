import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { noteCreateSchema, noteListQuerySchema, noteUpdateSchema } from '../../../shared/schemas';
import { sanitizeFilename } from '../../core/text';

export async function noteRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/notes', async (request, reply) => {
    const query = parse(noteListQuerySchema, request.query);
    return reply.send({
      notes: ctx.services.notes.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.template ? { template: query.template } : {}),
        ...(query.pinned !== undefined ? { pinned: query.pinned } : {}),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
      }),
    });
  });

  app.post('/notes', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(noteCreateSchema, request.body);
    return reply.status(201).send(ctx.services.notes.create(input, request.user.id));
  });

  app.get('/notes/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.notes.get(id));
  });

  app.put('/notes/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(noteUpdateSchema, request.body);
    return reply.send(ctx.services.notes.save(id, input, request.user.id));
  });

  app.delete('/notes/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.notes.delete(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.get('/notes/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ versions: ctx.services.notes.versions(id) });
  });

  app.get('/notes/:id/versions/:version', async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    return reply.send(ctx.services.notes.getVersion(id, Number(version)));
  });

  app.post('/notes/:id/versions/:version/restore', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id, version } = request.params as { id: string; version: string };
    return reply.send(ctx.services.notes.restoreVersion(id, Number(version), request.user.id));
  });

  app.get('/notes/:id/markdown', async (request, reply) => {
    const { id } = request.params as { id: string };
    const markdown = ctx.services.notes.markdown(id);
    const name = sanitizeFilename(ctx.services.notes.filename(id));
    return reply
      .type('text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(markdown);
  });
}
