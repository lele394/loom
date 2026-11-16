import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  linkCreateSchema,
  objectListQuerySchema,
  objectUpdateSchema,
  paginationSchema,
  tagCreateSchema,
  tagUpdateSchema,
  tagsReplaceSchema,
} from '../../../shared/schemas';
import { AppError } from '../../core/errors';
import type { ObjectType } from '../../../shared/constants';

export async function objectRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/objects', async (request, reply) => {
    const query = parse(objectListQuerySchema, request.query);
    const projectId =
      query.projectId === undefined ? undefined : query.projectId === 'global' ? null : query.projectId;
    return reply.send({
      objects: ctx.services.objects.list({
        ...(query.type ? { type: query.type as ObjectType } : {}),
        projectId,
        ...(query.tag ? { tag: query.tag } : {}),
        ...(query.favorite ? { favorite: true } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { q: query.q } : {}),
        limit: query.limit,
        offset: query.offset,
      }),
    });
  });

  app.get('/objects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.objects.envelope(id));
  });

  app.patch('/objects/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(objectUpdateSchema, request.body);
    let summary = ctx.services.objects.summary(id);
    if (input.projectId !== undefined) {
      summary = ctx.services.objects.moveToProject(id, input.projectId, request.user.id);
    }
    if (input.favorite !== undefined) {
      summary = ctx.services.objects.setFavorite(id, input.favorite, request.user.id);
    }
    return reply.send(summary);
  });

  app.delete('/objects/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.objects.softDelete(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/objects/:id/restore', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const summary = ctx.services.objects.restore(id, request.user.id);
    ctx.services.search.indexObject(id);
    return reply.send(summary);
  });

  app.get('/objects/:id/links', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({
      links: ctx.services.objects.linksFor(id),
      backlinks: ctx.services.objects.backlinksFor(id),
    });
  });

  app.post('/objects/:id/links', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(linkCreateSchema, request.body);
    return reply
      .status(201)
      .send(ctx.services.objects.createLink(id, input.targetId, input.kind, request.user.id, input.anchor));
  });

  app.delete('/links/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.objects.removeLink(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.get('/objects/:id/activity', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ events: ctx.services.activity.forObject(id, 100) });
  });

  app.get('/objects/:id/tags', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ tags: ctx.services.objects.getObjectTags(id) });
  });

  app.put('/objects/:id/tags', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(tagsReplaceSchema, request.body);
    return reply.send({ tags: ctx.services.objects.setTags(id, input.tagIds, request.user.id) });
  });

  app.get('/tags', async (_request, reply) => {
    return reply.send({ tags: ctx.services.objects.listTags(true) });
  });

  app.post('/tags', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(tagCreateSchema, request.body);
    return reply.status(201).send(ctx.services.objects.createTag(input.name, input.color, request.user.id));
  });

  app.patch('/tags/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(tagUpdateSchema, request.body);
    return reply.send(ctx.services.objects.updateTag(id, input, request.user.id));
  });

  app.delete('/tags/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.objects.deleteTag(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.get('/trash', async (request, reply) => {
    const query = parse(paginationSchema, request.query);
    return reply.send({
      objects: ctx.services.objects.listDeleted(query.limit),
      projects: ctx.services.projects.listDeleted(),
    });
  });

  app.post('/trash/:id/restore', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const summary = ctx.services.objects.restore(id, request.user.id);
    ctx.services.search.indexObject(id);
    return reply.send(summary);
  });

  app.delete('/trash/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.objects.purge(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.delete('/trash/projects/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.projects.purge(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/trash/empty', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const items = ctx.services.objects.listDeleted(1000);
    for (const item of items) ctx.services.objects.purge(item.id, request.user.id);
    const projects = ctx.services.projects.listDeleted();
    for (const project of projects) ctx.services.projects.purge(project.id, request.user.id);
    return reply.send({ purgedObjects: items.length, purgedProjects: projects.length });
  });

  app.post('/trash/purge-expired', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    return reply.send({ purged: ctx.services.objects.purgeExpired(request.user.id, 30) });
  });


}
