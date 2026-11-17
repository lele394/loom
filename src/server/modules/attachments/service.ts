import { promises as fs } from 'node:fs';
import type { Readable } from 'node:stream';
import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import type { SearchService } from '../search/service';
import type { JobQueue } from '../../worker/jobs';
import type { BlobStore } from '../../storage/blobStore';
import { writeStreamToFile } from '../../storage/blobStore';
import type { AppConfig } from '../../config';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { parseJson } from '../../core/text';
import { parseCsvPreview } from '../../core/csv';
import { extractPdf } from '../../core/pdf';
import type { Attachment, PdfAnnotation, PdfAnnotationGeometry } from '../../../shared/types';

interface AttachmentRow {
  id: string;
  object_id: string;
  kind: Attachment['kind'];
  blob_hash: string;
  filename: string;
  mime: string;
  size: number;
  page_count: number | null;
  text_status: Attachment['textStatus'];
  text_error: string | null;
  meta_json: string;
  created_at: string;
  extracted_at: string | null;
}

interface PdfAnnotationRow {
  id: string;
  attachment_id: string;
  page: number;
  kind: PdfAnnotation['kind'];
  color: string;
  geometry_json: string;
  text: string;
  created_at: string;
  updated_at: string;
}

function mapPdfAnnotation(row: PdfAnnotationRow): PdfAnnotation {
  return {
    id: row.id,
    attachmentId: row.attachment_id,
    page: row.page,
    kind: row.kind,
    color: row.color,
    geometry: parseJson<PdfAnnotationGeometry>(row.geometry_json, {}),
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertAnnotationGeometry(kind: PdfAnnotation['kind'], geometry: PdfAnnotationGeometry): void {
  if (kind === 'ink') {
    if (!geometry.points || geometry.points.length < 2) {
      throw new AppError('bad_request', 'Ink annotations need at least two points.');
    }
    return;
  }
  if (!geometry.rect) {
    throw new AppError('bad_request', 'This annotation needs a rectangle.');
  }
}

function mapAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    objectId: row.object_id,
    kind: row.kind,
    filename: row.filename,
    mime: row.mime,
    size: row.size,
    pageCount: row.page_count,
    textStatus: row.text_status,
    textError: row.text_error,
    meta: parseJson(row.meta_json, {}),
    createdAt: row.created_at,
  };
}

interface SniffResult {
  kind: Attachment['kind'];
  mime: string;
}

const TEXT_EXTENSIONS = new Set(['csv', 'tsv', 'txt', 'md', 'json', 'log', 'yaml', 'yml']);
const BLOCKED_INLINE = new Set(['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript']);

function sniff(head: Buffer, filename: string, declaredMime: string): SniffResult {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const starts = (bytes: number[], offset = 0) =>
    bytes.every((byte, index) => head[offset + index] === byte);

  if (head.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { kind: 'pdf', mime: 'application/pdf' };
  }
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png' };
  }
  if (starts([0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') {
    return { kind: 'image', mime: 'image/gif' };
  }
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { kind: 'image', mime: 'image/webp' };
  }
  if (head.subarray(0, 2).toString('latin1') === 'PK') {
    return { kind: 'data', mime: 'application/zip' };
  }
  if (extension === 'pdf' || declaredMime === 'application/pdf') {
    throw new AppError('unsupported_file', 'This file is named PDF but is not a valid PDF.');
  }
  if (BLOCKED_INLINE.has(declaredMime) || ['html', 'htm', 'svg', 'js', 'mjs'].includes(extension)) {
    return { kind: 'other', mime: 'application/octet-stream' };
  }
  if (extension === 'csv' || declaredMime === 'text/csv') {
    return { kind: 'csv', mime: 'text/csv' };
  }
  if (extension === 'tsv' || declaredMime === 'text/tab-separated-values') {
    return { kind: 'csv', mime: 'text/tab-separated-values' };
  }
  if (extension === 'json') return { kind: 'data', mime: 'application/json' };
  if (TEXT_EXTENSIONS.has(extension) || declaredMime.startsWith('text/')) {
    return { kind: 'data', mime: 'text/plain' };
  }
  return { kind: 'other', mime: 'application/octet-stream' };
}

export class AttachmentService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
    private readonly jobs: JobQueue,
    private readonly storage: BlobStore,
    private readonly config: AppConfig,
  ) {}

  get(id: string): Attachment {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
      | AttachmentRow
      | undefined;
    if (!row) throw notFound('Attachment');
    return mapAttachment(row);
  }

  rowForDownload(id: string): { hash: string; size: number; filename: string; mime: string; kind: string } {
    const row = this.get(id);
    const raw = this.db.prepare('SELECT blob_hash FROM attachments WHERE id = ?').get(id) as {
      blob_hash: string;
    };
    return { hash: raw.blob_hash, size: row.size, filename: row.filename, mime: row.mime, kind: row.kind };
  }

  async upload(
    objectId: string,
    stream: Readable,
    filename: string,
    declaredMime: string,
    actorId: string,
  ): Promise<Attachment> {
    const object = this.objects.requireRow(objectId);
    this.objects.ensureProjectWritable(object.project_id);
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM attachments WHERE object_id = ?')
      .get(objectId) as { count: number };
    if (count.count >= 10) {
      throw new AppError('bad_request', 'An object can have at most 10 attachments.');
    }
    const used = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM attachments').get() as {
      total: number;
    };
    if (used.total >= this.config.maxStorageBytes) {
      throw new AppError('storage_quota_exceeded', 'The attachment storage quota is full.');
    }

    const temp = this.storage.tempPath('upload');
    const { size } = await writeStreamToFile(stream, temp, this.config.maxUploadBytes);
    const handle = await fs.open(temp, 'r');
    let head = Buffer.alloc(64);
    try {
      const { bytesRead } = await handle.read(head, 0, 64, 0);
      head = head.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const sniffed = sniff(head, filename, declaredMime);
    if (used.total + size > this.config.maxStorageBytes) {
      await fs.rm(temp, { force: true });
      throw new AppError('storage_quota_exceeded', 'The attachment storage quota would be exceeded.');
    }
    const stored = await this.storage.saveFile(temp, this.config.maxUploadBytes);

    let meta: Record<string, unknown> = {};
    if (sniffed.kind === 'csv') {
      try {
        const buffer = await fs.readFile(this.storage.pathFor(stored.hash), 'utf8');
        meta.preview = parseCsvPreview(buffer, sniffed.mime.includes('tab') ? '\t' : ',');
      } catch {
        meta.preview = null;
      }
    }

    const id = newId('att');
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attachments (id, object_id, kind, blob_hash, filename, mime, size, page_count, text_status, meta_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        )
        .run(
          id,
          objectId,
          sniffed.kind,
          stored.hash,
          filename || 'file',
          sniffed.mime,
          stored.size,
          sniffed.kind === 'pdf' ? 'pending' : 'none',
          JSON.stringify(meta),
          now,
        );
      this.objects.bumpVersion(objectId, actorId);
      this.objects.refreshSubtitle(objectId);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId,
        objectType: object.type,
        objectTitle: object.title,
        action: `${object.type}.attachment_added`,
        summary: `Attached "${filename || 'file'}" to ${object.type} "${object.title}"`,
      });
      if (sniffed.kind === 'pdf') {
        this.jobs.enqueue('extract.attachment', {
          payload: { attachmentId: id },
          idempotencyKey: `extract:${id}`,
          maxAttempts: 3,
        });
      }
    });
    tx();
    return this.get(id);
  }

  async pdfForObject(objectId: string): Promise<{ attachment: Attachment; buffer: Buffer } | null> {
    const row = this.db
      .prepare("SELECT * FROM attachments WHERE object_id = ? AND kind = 'pdf' ORDER BY created_at ASC LIMIT 1")
      .get(objectId) as AttachmentRow | undefined;
    if (!row) return null;
    const stat = await this.storage.stat(row.blob_hash);
    if (!stat) throw new AppError('attachment_missing');
    const parts: Buffer[] = [];
    for await (const chunk of this.storage.createReadStream(row.blob_hash)) {
      parts.push(chunk as Buffer);
    }
    return { attachment: mapAttachment(row), buffer: Buffer.concat(parts) };
  }

  /** Attach generated content (e.g. a webpage archive) with optional extracted text, without a job. */
  async attachGenerated(
    objectId: string,
    filename: string,
    mime: string,
    data: Buffer,
    text: string | null,
    actorId: string,
    options: { kind?: Attachment['kind']; meta?: Record<string, unknown> } = {},
  ): Promise<Attachment> {
    const object = this.objects.requireRow(objectId);
    this.objects.ensureProjectWritable(object.project_id);
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM attachments WHERE object_id = ?')
      .get(objectId) as { count: number };
    if (count.count >= 10) {
      throw new AppError('bad_request', 'An object can have at most 10 attachments.');
    }
    const used = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM attachments').get() as {
      total: number;
    };
    if (used.total + data.length > this.config.maxStorageBytes) {
      throw new AppError('storage_quota_exceeded', 'The attachment storage quota would be exceeded.');
    }
    const temp = this.storage.tempPath('generated');
    await fs.writeFile(temp, data, { mode: 0o600 });
    const stored = await this.storage.saveFile(temp, this.config.maxUploadBytes);
    const id = newId('att');
    const now = this.clock.iso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO attachments (id, object_id, kind, blob_hash, filename, mime, size, page_count, text_status, meta_json, created_at, extracted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
        )
        .run(
          id,
          objectId,
          options.kind ?? 'data',
          stored.hash,
          filename,
          mime,
          stored.size,
          text ? 'ready' : 'none',
          JSON.stringify(options.meta ?? {}),
          now,
          text ? now : null,
        );
      if (text) {
        this.db
          .prepare('INSERT INTO attachment_text (attachment_id, text, page_map_json) VALUES (?, ?, ?)')
          .run(id, text, '[]');
      }
      this.objects.bumpVersion(objectId, actorId);
      this.search.indexObject(objectId);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId,
        objectType: object.type,
        objectTitle: object.title,
        action: `${object.type}.attachment_added`,
        summary: `Archived "${filename}" on ${object.type} "${object.title}"`,
      });
    });
    tx();
    return this.get(id);
  }

  remove(id: string, actorId: string): void {
    const row = this.get(id);
    const object = this.objects.requireRow(row.objectId);
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
      this.objects.bumpVersion(object.id, actorId);
      this.search.indexObject(object.id);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: object.id,
        objectType: object.type,
        objectTitle: object.title,
        action: `${object.type}.attachment_removed`,
        summary: `Removed attachment "${row.filename}"`,
      });
    });
    tx();
  }

  listAnnotations(attachmentId: string): PdfAnnotation[] {
    this.get(attachmentId);
    const rows = this.db
      .prepare('SELECT * FROM pdf_annotations WHERE attachment_id = ? ORDER BY page ASC, created_at ASC')
      .all(attachmentId) as PdfAnnotationRow[];
    return rows.map(mapPdfAnnotation);
  }

  createAnnotation(
    attachmentId: string,
    input: {
      page: number;
      kind: PdfAnnotation['kind'];
      color: string;
      geometry: PdfAnnotationGeometry;
      text?: string;
    },
    actorId: string,
  ): PdfAnnotation {
    const attachment = this.get(attachmentId);
    const object = this.objects.requireRow(attachment.objectId);
    this.objects.ensureProjectWritable(object.project_id);
    assertAnnotationGeometry(input.kind, input.geometry);
    const id = newId('ann');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO pdf_annotations
           (id, attachment_id, page, kind, color, geometry_json, text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        attachmentId,
        input.page,
        input.kind,
        input.color,
        JSON.stringify(input.geometry),
        (input.text ?? '').slice(0, 2000),
        now,
        now,
      );
    this.objects.bumpVersion(object.id, actorId);
    return this.listAnnotations(attachmentId).find((annotation) => annotation.id === id)!;
  }

  updateAnnotation(
    annotationId: string,
    input: { color?: string; geometry?: PdfAnnotationGeometry; text?: string },
    actorId: string,
  ): PdfAnnotation {
    const row = this.db.prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(annotationId) as
      | PdfAnnotationRow
      | undefined;
    if (!row) throw notFound('Annotation');
    const attachment = this.get(row.attachment_id);
    const object = this.objects.requireRow(attachment.objectId);
    this.objects.ensureProjectWritable(object.project_id);
    const geometry = input.geometry ?? parseJson<PdfAnnotationGeometry>(row.geometry_json, {});
    assertAnnotationGeometry(row.kind, geometry);
    this.db
      .prepare(
        'UPDATE pdf_annotations SET color = ?, geometry_json = ?, text = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.color ?? row.color,
        JSON.stringify(geometry),
        (input.text ?? row.text).slice(0, 2000),
        this.clock.iso(),
        annotationId,
      );
    this.objects.bumpVersion(object.id, actorId);
    return mapPdfAnnotation(this.db.prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(annotationId) as PdfAnnotationRow);
  }

  deleteAnnotation(annotationId: string, actorId: string): void {
    const row = this.db.prepare('SELECT * FROM pdf_annotations WHERE id = ?').get(annotationId) as
      | PdfAnnotationRow
      | undefined;
    if (!row) throw notFound('Annotation');
    const attachment = this.get(row.attachment_id);
    const object = this.objects.requireRow(attachment.objectId);
    this.objects.ensureProjectWritable(object.project_id);
    this.db.prepare('DELETE FROM pdf_annotations WHERE id = ?').run(annotationId);
    this.objects.bumpVersion(object.id, actorId);
  }

  async extract(attachmentId: string): Promise<void> {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ?').get(attachmentId) as
      | AttachmentRow
      | undefined;
    if (!row) throw new Error('Attachment not found');
    if (row.kind !== 'pdf') return;
    const object = this.objects.requireRow(row.object_id);
    this.db
      .prepare("UPDATE attachments SET text_status = 'pending', text_error = NULL WHERE id = ?")
      .run(attachmentId);

    try {
      const stat = await this.storage.stat(row.blob_hash);
      if (!stat) throw new Error('Blob missing from storage');
      const parts: Buffer[] = [];
      for await (const chunk of this.storage.createReadStream(row.blob_hash)) {
        parts.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(parts);
      const extraction = await extractPdf(buffer);
      const { pageCount, text: fullText, pageMap } = extraction;
      const detectedDoi = extraction.doi;
      const meta = parseJson<Record<string, unknown>>(row.meta_json, {});
      if (detectedDoi) meta.detectedDoi = detectedDoi;
      meta.hasText = fullText.trim().length > 0;

      const tx = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT INTO attachment_text (attachment_id, text, page_map_json) VALUES (?, ?, ?)
             ON CONFLICT(attachment_id) DO UPDATE SET text = excluded.text, page_map_json = excluded.page_map_json`,
          )
          .run(attachmentId, fullText, JSON.stringify(pageMap));
        this.db
          .prepare(
            `UPDATE attachments SET text_status = 'ready', text_error = NULL, page_count = ?, meta_json = ?, extracted_at = ?
             WHERE id = ?`,
          )
          .run(pageCount, JSON.stringify(meta), this.clock.iso(), attachmentId);
        this.objects.bumpVersion(object.id, object.created_by);
        this.search.indexObject(object.id);
        if (detectedDoi) {
          const reference = this.db
            .prepare('SELECT doi FROM literature WHERE id = ?')
            .get(object.id) as { doi: string | null } | undefined;
          if (reference && !reference.doi) {
            this.activity.record({
              actorId: object.created_by,
              projectId: object.project_id,
              objectId: object.id,
              objectType: 'reference',
              objectTitle: object.title,
              action: 'reference.doi_detected',
              summary: `Detected DOI ${detectedDoi} in "${row.filename}"`,
              source: 'job',
            });
          }
        }
      });
      tx();
    } catch (error) {
      this.db
        .prepare("UPDATE attachments SET text_status = 'failed', text_error = ? WHERE id = ?")
        .run((error as Error).message.slice(0, 500), attachmentId);
      throw error;
    }
  }

  async retryExtraction(id: string): Promise<void> {
    const row = this.get(id);
    if (row.kind !== 'pdf') return;
    this.jobs.enqueue('extract.attachment', {
      payload: { attachmentId: id },
      idempotencyKey: `extract:${id}:${Date.now()}`,
      maxAttempts: 2,
    });
  }

  async gc(): Promise<number> {
    const referenced = new Set(
      (
        this.db.prepare('SELECT DISTINCT blob_hash FROM attachments').all() as { blob_hash: string }[]
      ).map((row) => row.blob_hash),
    );
    let removed = 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const hash of await this.storage.list()) {
      if (referenced.has(hash)) continue;
      try {
        const stat = await fs.stat(this.storage.pathFor(hash));
        if (stat.mtimeMs < cutoff) {
          await this.storage.remove(hash);
          removed++;
        }
      } catch {
        continue;
      }
    }
    await this.storage.cleanupTemp(24 * 60 * 60 * 1000);
    return removed;
  }
}
