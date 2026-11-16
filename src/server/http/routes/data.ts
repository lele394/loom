import type { FastifyInstance } from 'fastify';
import { createReadStream, promises as fs } from 'node:fs';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import { backupCreateSchema } from '../../../shared/schemas';
import { AppError } from '../../core/errors';
import { writeStreamToFile } from '../../storage/blobStore';
import { clearSessionCookies } from '../authGuard';

export async function dataRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/export/workspace.zip', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const file = await ctx.services.export.createWorkspaceExport(request.user.id, request.user.timezone);
    return streamAndCleanup(ctx, reply, file.filePath, file.filename);
  });

  app.get('/export/projects/:id.zip', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const file = await ctx.services.export.createProjectExport(id, request.user.timezone);
    return streamAndCleanup(ctx, reply, file.filePath, file.filename);
  });

  app.get('/backups', async (_request, reply) => {
    return reply.send({ backups: ctx.services.backup.list(), restoreInProgress: ctx.maintenance.restoring });
  });

  app.post('/backups', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(backupCreateSchema, request.body ?? {});
    const jobId = ctx.jobs.enqueue('backup.create', {
      payload: { kind: input.kind, actorId: request.user.id },
      idempotencyKey: `backup:manual:${ctx.clock.iso()}`,
      priority: 25,
    });
    return reply.status(202).send({ jobId });
  });

  app.post('/backups/:id/verify', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(await ctx.services.backup.verify(id));
  });

  app.get('/backups/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = ctx.services.backup.row(id);
    if (row.status !== 'ready') throw new AppError('not_found', 'This backup is not available.');
    const file = ctx.services.backup.filePath(row);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat) throw new AppError('not_found', 'The backup file is missing.');
    return reply
      .type('application/zip')
      .header('content-disposition', `attachment; filename="${row.filename}"`)
      .header('content-length', String(stat.size))
      .send(createReadStream(file));
  });

  app.delete('/backups/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.services.backup.delete(id);
    return reply.send({ ok: true });
  });

  app.post('/backups/restore', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const query = request.query as { confirm?: string };
    if (query.confirm !== 'RESTORE') {
      throw new AppError('bad_request', 'Type RESTORE to confirm.');
    }
    if (ctx.maintenance.restoring) throw new AppError('restore_in_progress');
    const data = await request.file();
    if (!data) throw new AppError('bad_request', 'Upload a Loom backup ZIP.');
    const temp = ctx.storage.tempPath('restore');
    try {
      await writeStreamToFile(data.file, temp, 10 * 1024 * 1024 * 1024);
      ctx.maintenance.restoring = true;
      const actorId = request.user.id;
      const result = await ctx.services.backup.restore(temp, actorId);
      clearSessionCookies(ctx, reply);
      return reply.send(result);
    } finally {
      ctx.maintenance.restoring = false;
      await fs.rm(temp, { force: true });
    }
  });

  app.get('/export/notes/:id.md', async (request, reply) => {
    const { id } = request.params as { id: string };
    const markdown = ctx.services.notes.markdown(id);
    return reply
      .type('text/markdown; charset=utf-8')
      .header('content-disposition', `attachment; filename="${id.slice(-8)}.md"`)
      .send(markdown);
  });

  app.get('/export/references.bib', async (request, reply) => {
    const query = request.query as { projectId?: string };
    return reply
      .type('application/x-bibtex; charset=utf-8')
      .header('content-disposition', 'attachment; filename="loom-references.bib"')
      .send(ctx.services.literature.exportBibtex(query.projectId));
  });
}

function streamAndCleanup(
  ctx: Ctx,
  reply: import('fastify').FastifyReply,
  filePath: string,
  filename: string,
): unknown {
  const stream = createReadStream(filePath);
  const cleanup = () => {
    void ctx.services.export.cleanup(filePath);
  };
  stream.on('close', cleanup);
  stream.on('error', cleanup);
  return reply
    .type('application/zip')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(stream);
}
