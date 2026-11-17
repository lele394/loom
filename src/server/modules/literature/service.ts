import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import type { SearchService } from '../search/service';
import type { AttachmentService } from '../attachments/service';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { buildCiteKey, parseJson, sanitizeFilename, uniqueCiteKey } from '../../core/text';
import { formatBibtex, parseBibtex, splitAuthors } from '../../core/bibtex';
import { extractPageMetadata, extractReadableText, safeFetch } from '../../core/net';
import { extractPdf } from '../../core/pdf';
import { ocrWithTesseract, withPdfImages, type RenderedPdfPage } from '../../core/pdfImages';
import { METADATA_PROMPT_VERSION } from '../../ai/prompts';
import type { LiteratureMetadataService, MetadataExtractionResult } from './metadata';
import type { AppConfig } from '../../config';
import { Readable } from 'node:stream';
import type { PdfMetadataMode, ReadingStatus, ReferenceType } from '../../../shared/constants';
import type { Reference, ReferenceBookmark } from '../../../shared/types';

interface LiteratureRow {
  id: string;
  cite_key: string;
  type: ReferenceType;
  authors_json: string;
  year: number | null;
  venue: string;
  doi: string | null;
  url: string | null;
  abstract: string;
  published_at: string | null;
  reading_status: ReadingStatus;
  rating: number | null;
  notes: string;
  extra_json: string;
  ai_summary: string;
  ai_summary_model: string | null;
  ai_summary_at: string | null;
  ai_summary_instructions: string;
  added_at: string;
}

export interface ReferenceInput {
  title: string;
  type?: ReferenceType;
  authors?: string[];
  year?: number | null;
  venue?: string;
  doi?: string | null;
  url?: string | null;
  abstract?: string;
  publishedAt?: string | null;
  readingStatus?: ReadingStatus;
  rating?: number | null;
  notes?: string;
  citeKey?: string;
  projectId?: string | null;
  extra?: Record<string, unknown>;
}

export class LiteratureService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
    private readonly attachments: AttachmentService,
    private readonly metadata: LiteratureMetadataService,
    private readonly config: AppConfig,
  ) {}

  private row(id: string): LiteratureRow {
    const row = this.db.prepare('SELECT * FROM literature WHERE id = ?').get(id) as
      | LiteratureRow
      | undefined;
    if (!row) throw notFound('Reference');
    return row;
  }

  private map(id: string, row?: LiteratureRow): Reference {
    const reference = row ?? this.row(id);
    const object = this.objects.requireRow(id);
    return {
      id,
      title: object.title,
      citeKey: reference.cite_key,
      type: reference.type,
      authors: parseJson<string[]>(reference.authors_json, []),
      year: reference.year,
      venue: reference.venue,
      doi: reference.doi,
      url: reference.url,
      abstract: reference.abstract,
      publishedAt: reference.published_at,
      readingStatus: reference.reading_status,
      rating: reference.rating,
      notes: reference.notes,
      extra: parseJson<Record<string, unknown>>(reference.extra_json, {}),
      aiSummary: reference.ai_summary,
      aiSummaryModel: reference.ai_summary_model,
      aiSummaryAt: reference.ai_summary_at,
      aiSummaryInstructions: reference.ai_summary_instructions,
      addedAt: reference.added_at,
      projectId: object.project_id,
      version: object.version,
    };
  }

  private uniqueCiteKey(base: string): string {
    return uniqueCiteKey(base, (key) => {
      const row = this.db.prepare('SELECT 1 AS ok FROM literature WHERE cite_key = ?').get(key);
      return Boolean(row);
    });
  }

  create(input: ReferenceInput, actorId: string): Reference {
    this.objects.ensureProjectWritable(input.projectId ?? null);
    if (input.projectId && !this.objects.projectExists(input.projectId)) throw notFound('Project');
    const authors = input.authors ?? [];
    const year = input.year ?? null;
    const citeKey = input.citeKey?.trim() || this.uniqueCiteKey(buildCiteKey(authors, year, input.title));
    this.ensureCiteKeyFree(citeKey);
    const status = input.readingStatus ?? 'unread';
    const now = this.clock.iso();

    const tx = this.db.transaction(() => {
      const id = this.objects.insertObject({
        type: 'reference',
        title: input.title.trim(),
        projectId: input.projectId ?? null,
        status,
        metadata: { citeKey, year, doi: input.doi ?? null },
        actorId,
      });
      this.db
        .prepare(
          `INSERT INTO literature (id, cite_key, type, authors_json, year, venue, doi, url, abstract,
             published_at, reading_status, rating, notes, extra_json, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          citeKey,
          input.type ?? 'article',
          JSON.stringify(authors),
          year,
          input.venue ?? '',
          input.doi ?? null,
          input.url ?? null,
          input.abstract ?? '',
          input.publishedAt ?? null,
          status,
          input.rating ?? null,
          input.notes ?? '',
          JSON.stringify(input.extra ?? {}),
          now,
        );
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: input.projectId ?? null,
        objectId: id,
        objectType: 'reference',
        objectTitle: input.title,
        action: 'reference.created',
        summary: `Added reference "${input.title}"`,
      });
      return id;
    });
    return this.map(tx());
  }

  private ensureCiteKeyFree(citeKey: string): void {
    const row = this.db.prepare('SELECT id FROM literature WHERE cite_key = ?').get(citeKey);
    if (row) throw new AppError('duplicate', `Citation key "${citeKey}" is already used.`);
  }

  get(id: string): Reference {
    return this.map(id);
  }

  list(filters: {
    projectId?: string;
    q?: string;
    readingStatus?: ReadingStatus;
    year?: number;
    tag?: string;
    limit?: number;
    offset?: number;
  }): Reference[] {
    const clauses: string[] = ["o.type = 'reference'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('o.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.readingStatus) {
      clauses.push('l.reading_status = ?');
      params.push(filters.readingStatus);
    }
    if (filters.year) {
      clauses.push('l.year = ?');
      params.push(filters.year);
    }
    if (filters.q) {
      clauses.push('(o.title LIKE ? OR l.abstract LIKE ? OR l.authors_json LIKE ? OR l.venue LIKE ?)');
      const term = `%${filters.q}%`;
      params.push(term, term, term, term);
    }
    if (filters.tag) {
      clauses.push(
        'EXISTS (SELECT 1 FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = o.id AND t.name = ? COLLATE NOCASE)',
      );
      params.push(filters.tag);
    }
    const rows = this.db
      .prepare(
        `SELECT l.* FROM literature l JOIN objects o ON o.id = l.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY l.added_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 30, filters.offset ?? 0) as LiteratureRow[];
    return rows.map((row) => this.map(row.id, row));
  }

  update(id: string, input: Partial<ReferenceInput>, actorId: string): Reference {
    const current = this.row(id);
    const object = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(object.project_id);
    if (input.projectId !== undefined && input.projectId !== object.project_id) {
      this.objects.moveToProject(id, input.projectId, actorId);
    }
    if (input.citeKey && input.citeKey !== current.cite_key) this.ensureCiteKeyFree(input.citeKey);
    const title = input.title?.trim() || object.title;
    const status = input.readingStatus ?? current.reading_status;
    const changes: Record<string, { from: unknown; to: unknown }> = {};

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE literature SET cite_key = ?, type = ?, authors_json = ?, year = ?, venue = ?, doi = ?, url = ?,
             abstract = ?, published_at = ?, reading_status = ?, rating = ?, notes = ?, extra_json = ?
           WHERE id = ?`,
        )
        .run(
          input.citeKey ?? current.cite_key,
          input.type ?? current.type,
          JSON.stringify(input.authors ?? parseJson(current.authors_json, [])),
          input.year === undefined ? current.year : input.year,
          input.venue ?? current.venue,
          input.doi === undefined ? current.doi : input.doi,
          input.url === undefined ? current.url : input.url,
          input.abstract ?? current.abstract,
          input.publishedAt === undefined ? current.published_at : input.publishedAt,
          status,
          input.rating === undefined ? current.rating : input.rating,
          input.notes ?? current.notes,
          JSON.stringify(input.extra ?? parseJson(current.extra_json, {})),
          id,
        );
      this.objects.touch(id, {
        title,
        status,
        metadata: {
          citeKey: input.citeKey ?? current.cite_key,
          year: input.year === undefined ? current.year : input.year,
          doi: input.doi === undefined ? current.doi : input.doi,
        },
        actorId,
      });
      this.search.indexObject(id);
      if (status !== current.reading_status) {
        changes.status = { from: current.reading_status, to: status };
      }
      if (title !== object.title) changes.title = { from: object.title, to: title };
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'reference',
        objectTitle: title,
        action: status !== current.reading_status ? 'reference.status_changed' : 'reference.updated',
        summary:
          status !== current.reading_status
            ? `Marked "${title}" as ${status}`
            : `Updated reference "${title}"`,
        changes: Object.keys(changes).length ? changes : null,
      });
    });
    tx();
    return this.map(id);
  }

  delete(id: string, actorId: string): void {
    this.objects.softDelete(id, actorId);
  }

  assertExists(id: string): void {
    this.objects.requireRow(id);
  }

  async applyExtractedMetadata(
    id: string,
    result: MetadataExtractionResult,
    actorId: string,
  ): Promise<Reference> {
    const reference = this.map(id);
    return this.applyMetadata(reference, result, result.mode, result.mode, actorId);
  }

  listBookmarks(referenceId: string): ReferenceBookmark[] {
    this.objects.requireRow(referenceId);
    const rows = this.db
      .prepare('SELECT * FROM reference_bookmarks WHERE reference_id = ? ORDER BY page ASC, created_at ASC')
      .all(referenceId) as {
      id: string;
      reference_id: string;
      page: number;
      note: string;
      created_at: string;
      updated_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      referenceId: row.reference_id,
      page: row.page,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createBookmark(referenceId: string, input: { page: number; note?: string }, actorId: string): ReferenceBookmark {
    this.objects.requireRow(referenceId);
    const id = newId('bkm');
    const now = this.clock.iso();
    this.db
      .prepare(
        'INSERT INTO reference_bookmarks (id, reference_id, page, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, referenceId, input.page, (input.note ?? '').slice(0, 250), now, now);
    this.activity.record({
      actorId,
      projectId: this.objects.requireRow(referenceId).project_id,
      objectId: referenceId,
      objectType: 'reference',
      action: 'reference.bookmark_added',
      summary: `Bookmarked page ${input.page}`,
    });
    return this.listBookmarks(referenceId).find((bookmark) => bookmark.id === id)!;
  }

  updateBookmark(
    bookmarkId: string,
    input: { page?: number; note?: string },
  ): ReferenceBookmark {
    const row = this.db.prepare('SELECT * FROM reference_bookmarks WHERE id = ?').get(bookmarkId) as
      | { id: string; reference_id: string; page: number; note: string; created_at: string; updated_at: string }
      | undefined;
    if (!row) throw notFound('Bookmark');
    this.db
      .prepare('UPDATE reference_bookmarks SET page = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(input.page ?? row.page, (input.note ?? row.note).slice(0, 250), this.clock.iso(), bookmarkId);
    return this.listBookmarks(row.reference_id).find((bookmark) => bookmark.id === bookmarkId)!;
  }

  deleteBookmark(bookmarkId: string): void {
    const row = this.db.prepare('SELECT reference_id FROM reference_bookmarks WHERE id = ?').get(bookmarkId) as
      | { reference_id: string }
      | undefined;
    if (!row) throw notFound('Bookmark');
    this.db.prepare('DELETE FROM reference_bookmarks WHERE id = ?').run(bookmarkId);
  }

  async ingestPdf(
    stream: NodeJS.ReadableStream,
    filename: string,
    projectId: string | null,
    actorId: string,
    mode?: PdfMetadataMode,
  ): Promise<Reference> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk)
          : Buffer.from(chunk as unknown as Uint8Array);
      total += buffer.length;
      if (total > this.config.maxUploadBytes) {
        throw new AppError('payload_too_large', 'The PDF exceeds the upload limit.');
      }
      chunks.push(buffer);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new AppError('unsupported_file', 'This file is not a valid PDF.');
    }
    return this.ingestPdfBuffer(buffer, filename, projectId, actorId, null, mode);
  }

  private imageDataUrl(page: RenderedPdfPage): string {
    return `data:${page.mime};base64,${page.base64}`;
  }

  private async metadataForPdfBuffer(
    buffer: Buffer,
    extraction: Awaited<ReturnType<typeof extractPdf>> | null,
    title: string,
    filename: string,
    mode: PdfMetadataMode,
    sourceUrl: string | null,
  ): Promise<MetadataExtractionResult> {
    const input = {
      text: extraction?.text ?? '',
      titleHint: title,
      filename,
      ...(sourceUrl ? { url: sourceUrl } : {}),
    };
    if (mode === 'images') {
      return withPdfImages(
        buffer,
        this.config.tmpDir,
        (pages) =>
          this.metadata.extract(input, {
            mode: 'images',
            images: pages.map((page) => this.imageDataUrl(page)),
          }),
        { dpi: 150, maxPages: 3 },
      );
    }
    if (mode === 'ocr') {
      return withPdfImages(
        buffer,
        this.config.tmpDir,
        async (pages) => {
          const local = await ocrWithTesseract(pages.map((page) => page.path));
          return this.metadata.extract(input, {
            mode: 'ocr',
            images: pages.map((page) => this.imageDataUrl(page)),
            ocrText: local,
          });
        },
        { dpi: 200, maxPages: 3 },
      );
    }
    return this.metadata.extract(input, { mode: 'text' });
  }

  private async ingestPdfBuffer(
    buffer: Buffer,
    filename: string,
    projectId: string | null,
    actorId: string,
    sourceUrl: string | null,
    requestedMode?: PdfMetadataMode,
  ): Promise<Reference> {
    let extraction: Awaited<ReturnType<typeof extractPdf>> | null = null;
    try {
      extraction = await extractPdf(buffer);
    } catch {
      // Scanned / over-limit PDFs are still stored; metadata falls back to the file name.
    }
    const hint = filename
      .replace(/\.pdf$/i, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const title = hint || 'Untitled PDF';
    const reference = this.create(
      {
        title,
        type: 'article',
        doi: extraction?.doi ?? null,
        url: sourceUrl,
        projectId,
      },
      actorId,
    );
    try {
      await this.attachments.upload(
        reference.id,
        Readable.from(buffer),
        filename,
        'application/pdf',
        actorId,
      );
    } catch (error) {
      this.objects.softDelete(reference.id, actorId);
      throw error;
    }
    const mode = requestedMode ?? this.metadata.defaultMode();
    let result: MetadataExtractionResult;
    try {
      result = await this.metadataForPdfBuffer(buffer, extraction, title, filename, mode, sourceUrl);
    } catch (error) {
      result = {
        metadata: {},
        raw: null,
        model: null,
        error: (error as Error).message,
        mode,
        ocrText: null,
        imageCount: 0,
        metadataOrigin: 'heuristic',
      };
    }
    let usedMode = mode;
    if (!Object.keys(result.metadata).length && mode !== 'text' && extraction?.text.trim()) {
      const fallback = await this.metadata.extract(
        { text: extraction.text, titleHint: title, filename, ...(sourceUrl ? { url: sourceUrl } : {}) },
        { mode: 'text' },
      );
      if (Object.keys(fallback.metadata).length) {
        result = { ...fallback, error: result.error };
        usedMode = 'text';
      }
    }
    return this.applyMetadata(reference, result, usedMode, mode, actorId, sourceUrl);
  }

  async ingestUrl(
    url: string,
    projectId: string | null,
    actorId: string,
    pdfMode?: PdfMetadataMode,
  ): Promise<Reference> {
    const fetched = await safeFetch(url);
    if (fetched.contentType === 'application/pdf') {
      const name = decodeURIComponent(new URL(fetched.finalUrl).pathname.split('/').pop() ?? 'document.pdf');
      return this.ingestPdfBuffer(
        Buffer.from(fetched.body, 'latin1'),
        name.endsWith('.pdf') ? name : `${name}.pdf`,
        projectId,
        actorId,
        fetched.finalUrl,
        pdfMode,
      );
    }
    const page = extractPageMetadata(fetched.body);
    const title = page.title || new URL(fetched.finalUrl).hostname;
    const reference = this.create(
      {
        title,
        type: 'website',
        authors: page.authors,
        url: fetched.finalUrl,
        abstract: page.description,
        publishedAt: page.publishedAt,
        projectId,
      },
      actorId,
    );
    this.activity.record({
      actorId,
      projectId,
      objectId: reference.id,
      objectType: 'reference',
      objectTitle: reference.title,
      action: 'reference.url_ingested',
      summary: `Captured webpage "${reference.title}"`,
    });
    const text = extractReadableText(fetched.body);
    const parsedUrl = new URL(fetched.finalUrl);
    const archiveStem =
      sanitizeFilename(`${parsedUrl.hostname}${parsedUrl.pathname.replace(/\//g, '-')}`, 80).replace(/-+$/g, '') ||
      'webpage';
    if (fetched.body.trim()) {
      await this.attachments.attachGenerated(
        reference.id,
        `${archiveStem}.html`,
        'text/html',
        Buffer.from(fetched.body, 'utf8'),
        text || null,
        actorId,
        { kind: 'data', meta: { archiveOf: fetched.finalUrl } },
      );
    }
    if (!text) return reference;
    const result = await this.metadata.extract(
      { text, titleHint: title, url: fetched.finalUrl },
      { mode: 'text' },
    );
    return this.applyMetadata(reference, result, 'text', 'text', actorId, fetched.finalUrl);
  }

  async ingestUrls(
    urls: string[],
    projectId: string | null,
    actorId: string,
    pdfMode?: PdfMetadataMode,
  ): Promise<{ created: Reference[]; errors: { url: string; error: string }[] }> {
    const results: (Reference | null)[] = new Array(urls.length).fill(null);
    const errors: { url: string; error: string }[] = [];
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= urls.length) return;
        try {
          results[index] = await this.ingestUrl(urls[index]!, projectId, actorId, pdfMode);
        } catch (error) {
          errors.push({ url: urls[index]!, error: (error as Error).message });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, urls.length) }, () => worker()),
    );
    return { created: results.filter((reference): reference is Reference => Boolean(reference)), errors };
  }

  async reextractMetadata(
    id: string,
    options: { source?: 'pdf' | 'url' | 'fields'; mode?: PdfMetadataMode } = {},
  ): Promise<
    MetadataExtractionResult & {
      source: 'pdf' | 'url' | 'fields';
      textPreview: string;
      attachmentId: string | null;
    }
  > {
    const reference = this.map(id);
    const pdf = await this.attachments.pdfForObject(id);
    const source = options.source ?? (pdf ? 'pdf' : reference.url ? 'url' : 'fields');
    const mode = options.mode ?? this.metadata.defaultMode();

    if (source === 'pdf') {
      if (!pdf) throw new AppError('bad_request', 'This reference has no PDF attachment.');
      let extraction: Awaited<ReturnType<typeof extractPdf>> | null = null;
      try {
        extraction = await extractPdf(pdf.buffer);
      } catch {
        extraction = null;
      }
      let result: MetadataExtractionResult;
      try {
        result = await this.metadataForPdfBuffer(
          pdf.buffer,
          extraction,
          reference.title,
          pdf.attachment.filename,
          mode,
          reference.url,
        );
      } catch (error) {
        result = {
          metadata: {},
          raw: null,
          model: null,
          error: (error as Error).message,
          mode,
          ocrText: null,
          imageCount: 0,
          metadataOrigin: 'heuristic',
        };
      }
      return {
        ...result,
        source,
        attachmentId: pdf.attachment.id,
        textPreview: (extraction?.text ?? '').slice(0, 1500),
      };
    }

    if (source === 'url') {
      if (!reference.url) throw new AppError('bad_request', 'This reference has no URL.');
      const fetched = await safeFetch(reference.url);
      if (fetched.contentType === 'application/pdf') {
        const filename = decodeURIComponent(new URL(fetched.finalUrl).pathname.split('/').pop() ?? 'document.pdf');
        const buffer = Buffer.from(fetched.body, 'latin1');
        let extraction: Awaited<ReturnType<typeof extractPdf>> | null = null;
        try {
          extraction = await extractPdf(buffer);
        } catch {
          extraction = null;
        }
        let result: MetadataExtractionResult;
        try {
          result = await this.metadataForPdfBuffer(
            buffer,
            extraction,
            reference.title,
            filename,
            mode,
            fetched.finalUrl,
          );
        } catch (error) {
          result = {
            metadata: {},
            raw: null,
            model: null,
            error: (error as Error).message,
            mode,
            ocrText: null,
            imageCount: 0,
            metadataOrigin: 'heuristic',
          };
        }
        return {
          ...result,
          source,
          attachmentId: null,
          textPreview: (extraction?.text ?? '').slice(0, 1500),
        };
      }
      const text = extractReadableText(fetched.body);
      const result = await this.metadata.extract(
        { text, titleHint: reference.title, url: fetched.finalUrl },
        { mode: 'text' },
      );
      return { ...result, source, attachmentId: null, textPreview: text.slice(0, 1500) };
    }

    const text = [
      reference.title,
      reference.authors.join(', '),
      reference.year ? String(reference.year) : '',
      reference.venue,
      reference.abstract,
      reference.notes,
    ]
      .filter(Boolean)
      .join('\n');
    const result = await this.metadata.extract(
      { text, titleHint: reference.title, ...(reference.url ? { url: reference.url } : {}) },
      { mode: 'text' },
    );
    return { ...result, source, attachmentId: null, textPreview: text.slice(0, 1500) };
  }

  private async applyMetadata(
    reference: Reference,
    result: MetadataExtractionResult,
    mode: PdfMetadataMode,
    requestedMode: PdfMetadataMode,
    actorId: string,
    forceUrl?: string | null,
  ): Promise<Reference> {
    if (!Object.keys(result.metadata).length) return reference;
    const current = this.map(reference.id);
    const patch: Partial<ReferenceInput> = {
      ...result.metadata,
      ...(forceUrl ? { url: forceUrl } : {}),
      extra: {
        metadataSource: result.metadataOrigin,
        metadataMode: mode,
        metadataRequestedMode: requestedMode,
        metadataModel: result.model,
        metadataPromptVersion: METADATA_PROMPT_VERSION,
        ...(result.error ? { metadataError: result.error.slice(0, 500) } : {}),
      },
    };
    const autoKey = buildCiteKey(current.authors, current.year, current.title);
    if (current.citeKey === autoKey) {
      const nextKey = buildCiteKey(
        result.metadata.authors ?? current.authors,
        result.metadata.year ?? current.year,
        result.metadata.title ?? current.title,
      );
      if (nextKey && nextKey !== current.citeKey) patch.citeKey = this.uniqueCiteKey(nextKey);
    }
    try {
      return this.update(reference.id, patch, actorId);
    } catch {
      return reference;
    }
  }

  importBibtex(
    bibtex: string,
    projectId: string | null,
    actorId: string,
  ): { created: number; skipped: number; errors: string[] } {
    if (projectId) {
      this.objects.ensureProjectWritable(projectId);
      if (!this.objects.projectExists(projectId)) throw notFound('Project');
    }
    const parsed = parseBibtex(bibtex);
    let created = 0;
    let skipped = 0;
    const errors = [...parsed.errors];
    for (const entry of parsed.entries) {
      if (this.db.prepare('SELECT 1 AS ok FROM literature WHERE cite_key = ?').get(entry.citeKey)) {
        skipped++;
        continue;
      }
      const title = entry.fields.title ?? '';
      if (!title) {
        errors.push(`Entry ${entry.citeKey} has no title.`);
        continue;
      }
      const typeMap: Record<string, ReferenceType> = {
        article: 'article',
        inproceedings: 'inproceedings',
        conference: 'inproceedings',
        book: 'book',
        misc: 'other',
        techreport: 'report',
        phdthesis: 'thesis',
        mastersthesis: 'thesis',
        unpublished: 'preprint',
      };
      try {
        this.create(
          {
            title,
            type: typeMap[entry.entryType] ?? 'other',
            authors: splitAuthors(entry.fields.author ?? ''),
            year: entry.fields.year ? Number(entry.fields.year) : null,
            venue: entry.fields.journal ?? entry.fields.booktitle ?? '',
            doi: entry.fields.doi ?? null,
            url: entry.fields.url ?? null,
            abstract: entry.fields.abstract ?? '',
            citeKey: entry.citeKey,
            projectId,
            extra: Object.fromEntries(
              Object.entries(entry.fields).filter(
                ([key]) =>
                  !['author', 'title', 'year', 'journal', 'booktitle', 'doi', 'url', 'abstract'].includes(key),
              ),
            ),
          },
          actorId,
        );
        created++;
      } catch (error) {
        errors.push(`${entry.citeKey}: ${(error as Error).message}`);
      }
    }
    return { created, skipped, errors };
  }

  exportBibtex(projectId?: string, ids?: string[]): string {
    const clauses: string[] = ["o.type = 'reference'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (projectId) {
      clauses.push('o.project_id = ?');
      params.push(projectId);
    }
    if (ids?.length) {
      clauses.push(`l.id IN (${ids.map(() => '?').join(',')})`);
      params.push(...ids);
    }
    const rows = this.db
      .prepare(
        `SELECT l.* FROM literature l JOIN objects o ON o.id = l.id WHERE ${clauses.join(' AND ')} ORDER BY l.added_at DESC`,
      )
      .all(...params) as LiteratureRow[];
    return rows
      .map((row) => {
        const object = this.objects.requireRow(row.id);
        return formatBibtex({
          citeKey: row.cite_key,
          type: row.type,
          title: object.title,
          authors: parseJson(row.authors_json, []),
          year: row.year,
          venue: row.venue,
          doi: row.doi,
          url: row.url,
          abstract: row.abstract,
          publishedAt: row.published_at,
          extra: parseJson(row.extra_json, {}),
        });
      })
      .join('\n');
  }

  async enrichFromDoi(id: string, actorId: string): Promise<Reference> {
    const current = this.row(id);
    if (!current.doi) throw new AppError('bad_request', 'Add a DOI before enriching.');
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(current.doi)}`, {
      headers: { 'user-agent': 'Loom/0.1 (research notebook; mailto:noreply@example.org)' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new AppError('provider_error', `Crossref returned HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as {
      message?: {
        title?: string[];
        author?: { given?: string; family?: string }[];
        'container-title'?: string[];
        published?: { 'date-parts'?: number[][] };
        publishedPrint?: { 'date-parts'?: number[][] };
        abstract?: string;
        URL?: string;
        type?: string;
      };
    };
    const message = payload.message;
    if (!message) throw new AppError('provider_bad_response', 'Crossref returned no metadata.');
    const year =
      message.published?.['date-parts']?.[0]?.[0] ??
      message.publishedPrint?.['date-parts']?.[0]?.[0] ??
      current.year;
    const authors =
      message.author
        ?.map((author) => [author.given, author.family].filter(Boolean).join(' '))
        .filter(Boolean) ?? parseJson(current.authors_json, []);
    const typeMap: Record<string, ReferenceType> = {
      'journal-article': 'article',
      proceedings: 'inproceedings',
      book: 'book',
      posted: 'preprint',
      report: 'report',
      dissertation: 'thesis',
    };
    const abstract = (message.abstract ?? current.abstract)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return this.update(
      id,
      {
        title: message.title?.[0] ?? undefined,
        authors,
        year: year ?? null,
        venue: message['container-title']?.[0] ?? current.venue,
        abstract,
        url: message.URL ?? current.url,
        type: typeMap[message.type ?? ''] ?? current.type,
      },
      actorId,
    );
  }
}
