import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import type { Ctx } from '../../ctx';
import { parse } from '../errors';
import {
  bibtexImportSchema,
  bookmarkCreateSchema,
  bookmarkUpdateSchema,
  pdfMetadataModeSchema,
  referenceCreateSchema,
  referenceListQuerySchema,
  referenceUpdateSchema,
  reextractMetadataSchema,
  summarizeReferenceSchema,
  urlIngestSchema,
  urlsIngestSchema,
} from '../../../shared/schemas';
import { AppError } from '../../core/errors';
import { sanitizeFilename } from '../../core/text';

export async function literatureRoutes(app: FastifyInstance, ctx: Ctx): Promise<void> {
  app.get('/references', async (request, reply) => {
    const query = parse(referenceListQuerySchema, request.query);
    return reply.send({
      references: ctx.services.literature.list({
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.q ? { q: query.q } : {}),
        ...(query.readingStatus ? { readingStatus: query.readingStatus } : {}),
        ...(query.year ? { year: query.year } : {}),
        ...(query.tag ? { tag: query.tag } : {}),
        limit: query.limit,
        offset: query.offset,
      }),
    });
  });

  app.post('/references', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(referenceCreateSchema, request.body);
    return reply.status(201).send(ctx.services.literature.create(input, request.user.id));
  });

  app.get('/references/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.literature.get(id));
  });

  app.patch('/references/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(referenceUpdateSchema, request.body);
    return reply.send(ctx.services.literature.update(id, input, request.user.id));
  });

  app.delete('/references/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.literature.delete(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post(
    '/references/ingest-url',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(urlIngestSchema, request.body);
    return reply
      .status(201)
      .send(
        await ctx.services.literature.ingestUrl(
          input.url,
          input.projectId,
          request.user.id,
          input.pdfMode,
        ),
      );
    },
  );

  app.post(
    '/references/ingest-urls',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const input = parse(urlsIngestSchema, request.body);
      return reply.send(
        await ctx.services.literature.ingestUrls(
          input.urls,
          input.projectId,
          request.user.id,
          input.pdfMode,
        ),
      );
    },
  );

  app.post(
    '/references/:id/reextract-metadata',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(reextractMetadataSchema, request.body ?? {});
    const result = await ctx.services.literature.reextractMetadata(id, input);
    if (input.apply && Object.keys(result.metadata).length) {
      const reference = await ctx.services.literature.applyExtractedMetadata(id, result, request.user.id);
      return reply.send({ ...result, reference });
    }
    return reply.send(result);
    },
  );

  app.post(
    '/references/ingest-pdf',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!request.user) throw new Error('unauthenticated');
      const query = request.query as { projectId?: string; mode?: string };
      const mode = query.mode ? parse(pdfMetadataModeSchema, query.mode) : undefined;
      const data = await request.file();
      if (!data) throw new AppError('bad_request', 'No PDF was uploaded.');
      const projectId = query.projectId || null;
      const reference = await ctx.services.literature.ingestPdf(
        data.file,
        data.filename ?? 'paper.pdf',
        projectId,
        request.user.id,
        mode,
      );
      return reply.status(201).send(reference);
    },
  );

  app.post('/references/import-bibtex', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const input = parse(bibtexImportSchema, request.body);
    return reply.send(
      ctx.services.literature.importBibtex(input.bibtex, input.projectId, request.user.id),
    );
  });

  app.get('/references.bib', async (request, reply) => {
    const query = request.query as { projectId?: string; ids?: string };
    const bibtex = ctx.services.literature.exportBibtex(
      query.projectId,
      query.ids ? query.ids.split(',').filter(Boolean) : undefined,
    );
    return reply
      .type('application/x-bibtex; charset=utf-8')
      .header('content-disposition', 'attachment; filename="loom-references.bib"')
      .send(bibtex);
  });

  app.get('/references/:id/bookmarks', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send({ bookmarks: ctx.services.literature.listBookmarks(id) });
  });

  app.post('/references/:id/bookmarks', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(bookmarkCreateSchema, request.body);
    return reply.status(201).send(ctx.services.literature.createBookmark(id, input, request.user.id));
  });

  app.patch('/bookmarks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parse(bookmarkUpdateSchema, request.body);
    return reply.send(ctx.services.literature.updateBookmark(id, input));
  });

  app.delete('/bookmarks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    ctx.services.literature.deleteBookmark(id);
    return reply.send({ ok: true });
  });

  app.post('/references/:id/summarize', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const input = parse(summarizeReferenceSchema, request.body ?? {});
    ctx.services.literature.assertExists(id);
    const jobId = ctx.jobs.enqueue('reference.summarize', {
      payload: { referenceId: id, mode: input.mode, instructions: input.instructions, actorId: request.user.id },
      idempotencyKey: `summary:${id}:${Date.now()}`,
      priority: 80,
      maxAttempts: 2,
    });
    return reply.status(202).send({ jobId });
  });

  app.post('/references/:id/enrich', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    return reply.send(await ctx.services.literature.enrichFromDoi(id, request.user.id));
  });

  app.post(
    '/references/:id/pdf',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const data = await request.file();
    if (!data) throw new AppError('bad_request', 'No file was uploaded.');
    const attachment = await ctx.services.attachments.upload(
      id,
      data.file,
      data.filename ?? 'paper.pdf',
      data.mimetype ?? 'application/pdf',
      request.user.id,
    );
    return reply.status(201).send(attachment);
    },
  );

  app.post('/objects/:id/attachments', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    const data = await request.file();
    if (!data) throw new AppError('bad_request', 'No file was uploaded.');
    const attachment = await ctx.services.attachments.upload(
      id,
      data.file,
      data.filename ?? 'file',
      data.mimetype ?? 'application/octet-stream',
      request.user.id,
    );
    return reply.status(201).send(attachment);
  });

  app.get('/attachments/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return reply.send(ctx.services.attachments.get(id));
  });

  app.get('/attachments/:id/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { inline?: string };
    const attachment = ctx.services.attachments.rowForDownload(id);
    const inline = query.inline === '1' && attachment.mime === 'application/pdf';
    const rangeHeader = request.headers.range;
    const filename = sanitizeFilename(attachment.filename);
    const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
    const disposition = `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
      filename,
    )}`;

    let start = 0;
    let end = attachment.size - 1;
    let status = 200;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        start = match[1] ? Number(match[1]) : 0;
        end = match[2] ? Number(match[2]) : attachment.size - 1;
        if (start > end || start >= attachment.size) {
          return reply
            .status(416)
            .header('content-range', `bytes */${attachment.size}`)
            .send();
        }
        end = Math.min(end, attachment.size - 1);
        status = 206;
      }
    }

    const stream = ctx.storage.createReadStream(attachment.hash, rangeHeader ? { start, end } : undefined);
    reply
      .status(status)
      .header('content-type', inline ? 'application/pdf' : attachment.mime === 'text/csv' ? 'text/csv' : attachment.mime)
      .header('content-disposition', disposition)
      .header('content-length', String(end - start + 1))
      .header('accept-ranges', 'bytes')
      .header('cache-control', 'private, max-age=0, must-revalidate')
      .header('etag', `"${attachment.hash}"`)
      .header('x-content-type-options', 'nosniff');
    if (status === 206) {
      reply.header('content-range', `bytes ${start}-${end}/${attachment.size}`);
    }
    return reply.send(stream);
  });

  app.delete('/attachments/:id', async (request, reply) => {
    if (!request.user) throw new Error('unauthenticated');
    const { id } = request.params as { id: string };
    ctx.services.attachments.remove(id, request.user.id);
    return reply.send({ ok: true });
  });

  app.post('/attachments/:id/retry', async (request, reply) => {
    await ctx.services.attachments.retryExtraction((request.params as { id: string }).id);
    return reply.status(202).send({ ok: true });
  });
}
