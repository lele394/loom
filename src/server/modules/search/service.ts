import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { JobQueue } from '../../worker/jobs';
import type { SettingsService } from '../settings/service';
import { AppError } from '../../core/errors';
import { newId } from '../../core/ids';
import { excerpt, parseJson, splitText, estimateTokens } from '../../core/text';
import { objectTypes, typeDefinition } from '../../core/registry';
import { createProvider } from '../../ai';
import type { AiProvider } from '../../ai/types';
import type { ObjectType } from '../../../shared/constants';
import type { SearchResponse, SearchResult } from '../../../shared/types';

interface SearchFilters {
  q: string;
  type?: ObjectType;
  projectId?: string; // 'global' means null project
  tag?: string;
  from?: string;
  to?: string;
  mode?: 'text' | 'semantic' | 'hybrid';
  limit?: number;
}

export interface RetrievedChunk {
  chunkId: string;
  objectId: string;
  objectType: string;
  title: string;
  projectId: string | null;
  locator: Record<string, unknown>;
  text: string;
  score: number;
}

interface ChunkRow {
  id: string;
  object_id: string;
  locator_json: string;
  text: string;
  embedding: Buffer | null;
  embedding_model: string | null;
  embedding_dim: number | null;
}

function bufferToFloats(buffer: Buffer): Float32Array {
  const copy = Buffer.from(buffer);
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4));
}

function floatsToBuffer(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function safeFtsQuery(q: string): string {
  const tokens = q
    .replace(/["'()*:^\-]/g, ' ')
    .replace(/\b(AND|OR|NOT|NEAR)\b/gi, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && token.length <= 64)
    .slice(0, 12);
  if (tokens.length === 0) return '';
  return tokens.map((token, index) => (index === tokens.length - 1 ? `"${token}"*` : `"${token}"`)).join(' OR ');
}

function makeSnippet(text: string, query: string, max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const term = query
    .toLowerCase()
    .split(/\s+/)
    .find((t) => t.length > 2);
  if (!term) return excerpt(flat, max);
  const index = flat.toLowerCase().indexOf(term.toLowerCase());
  if (index < 0) return excerpt(flat, max);
  const start = Math.max(0, index - 80);
  const piece = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${piece}${start + max < flat.length ? '…' : ''}`;
}

export class SearchService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly jobs: JobQueue,
  ) {}

  // ── Indexing ───────────────────────────────────────────────────────────
  indexObject(objectId: string): number {
    const object = this.db
      .prepare('SELECT id, type, title, project_id FROM objects WHERE id = ?')
      .get(objectId) as { id: string; type: ObjectType; title: string; project_id: string | null } | undefined;
    if (!object) return 0;
    const def = objectTypes[object.type];
    if (!def) return 0;
    const body = def.body(this.db, objectId);
    const tags = (
      this.db
        .prepare('SELECT t.name FROM tags t JOIN object_tags ot ON ot.tag_id = t.id WHERE ot.object_id = ?')
        .all(objectId) as { name: string }[]
    )
      .map((row) => row.name)
      .join(' ');

    this.db.prepare('DELETE FROM search_fts WHERE object_id = ?').run(objectId);
    this.db
      .prepare('INSERT INTO search_fts (title, body, tags, object_id) VALUES (?, ?, ?, ?)')
      .run(object.title, body.text, tags, objectId);
    this.db.prepare('UPDATE objects SET subtitle = ? WHERE id = ?').run(body.subtitle, objectId);

    this.db.prepare('DELETE FROM chunks WHERE object_id = ?').run(objectId);
    const chunks = this.buildChunks(objectId, object.type, body.text).map((chunk) => ({
      ...chunk,
      id: newId('chk'),
    }));
    const insert = this.db.prepare(
      `INSERT INTO chunks (id, object_id, attachment_id, locator_json, text, token_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = this.clock.iso();
    this.db.prepare('DELETE FROM chunks_fts WHERE object_id = ?').run(objectId);
    const insertChunkFts = this.db.prepare(
      'INSERT INTO chunks_fts (text, chunk_id, object_id) VALUES (?, ?, ?)',
    );
    for (const chunk of chunks) {
      insert.run(
        chunk.id,
        objectId,
        chunk.attachmentId ?? null,
        JSON.stringify(chunk.locator),
        chunk.text,
        estimateTokens(chunk.text),
        now,
      );
      insertChunkFts.run(chunk.text, chunk.id, objectId);
    }

    if (this.embeddingConfig()) {
      this.jobs.enqueue('embed.chunks', {
        payload: { objectId },
        idempotencyKey: `embed:${objectId}:${this.objectVersion(objectId)}`,
        maxAttempts: 5,
      });
    }
    return chunks.length;
  }

  private objectVersion(objectId: string): number {
    const row = this.db.prepare('SELECT version FROM objects WHERE id = ?').get(objectId) as
      | { version: number }
      | undefined;
    return row?.version ?? 0;
  }

  private buildChunks(
    objectId: string,
    type: ObjectType,
    fallbackText: string,
  ): { text: string; locator: Record<string, unknown>; attachmentId?: string }[] {
    const chunks: { text: string; locator: Record<string, unknown>; attachmentId?: string }[] = [];
    if (type === 'note') {
      const row = this.db.prepare('SELECT blocks_json FROM notes WHERE id = ?').get(objectId) as
        | { blocks_json: string }
        | undefined;
      const blocks = parseJson<{ id: string; type: string; text: string }[]>(row?.blocks_json, []);
      for (const block of blocks) {
        const text = block.text?.trim();
        if (!text) continue;
        for (const piece of splitText(text, 1500, 150)) {
          chunks.push({ text: piece, locator: { blockId: block.id, blockType: block.type } });
        }
      }
      return chunks;
    }

    if (type === 'reference') {
      const row = this.db
        .prepare(
          `SELECT l.abstract, l.notes, l.authors_json, l.venue, l.year, o.title
           FROM literature l JOIN objects o ON o.id = l.id WHERE l.id = ?`,
        )
        .get(objectId) as
        | {
            abstract: string;
            notes: string;
            authors_json: string;
            venue: string;
            year: number | null;
            title: string;
          }
        | undefined;
      if (!row) return chunks;
      const authors = parseJson<string[]>(row.authors_json, []).join(', ');
      const abstract = row.abstract.trim();
      if (abstract) {
        for (const piece of splitText(abstract, 1200, 150)) {
          chunks.push({ text: piece, locator: { field: 'abstract' } });
        }
      } else {
        chunks.push({
          text: `${row.title}. ${authors}. ${row.venue} ${row.year ?? ''}`.trim(),
          locator: { field: 'metadata' },
        });
      }
      if (row.notes.trim()) {
        chunks.push({ text: row.notes.trim(), locator: { field: 'notes' } });
      }

      const attachments = this.db
        .prepare(
          `SELECT a.id, a.mime FROM attachments a
           JOIN attachment_text t ON t.attachment_id = a.id
           WHERE a.object_id = ?`,
        )
        .all(objectId) as { id: string; mime: string }[];
      for (const attachment of attachments) {
        const textRow = this.db
          .prepare('SELECT text, page_map_json FROM attachment_text WHERE attachment_id = ?')
          .get(attachment.id) as { text: string; page_map_json: string } | undefined;
        if (!textRow) continue;
        const pageMap = parseJson<{ page: number; start: number; end: number }[]>(
          textRow.page_map_json,
          [],
        );
        if (pageMap.length) {
          for (const page of pageMap) {
            const pageText = textRow.text.slice(page.start, page.end).trim();
            if (!pageText) continue;
            for (const piece of splitText(pageText, 1200, 150)) {
              chunks.push({
                text: piece,
                locator: { page: page.page },
                attachmentId: attachment.id,
              });
            }
          }
          continue;
        }
        for (const piece of splitText(textRow.text, 1200, 150)) {
          chunks.push({
            text: piece,
            locator: {
              attachmentId: attachment.id,
              kind: attachment.mime.includes('html') ? 'archive' : 'text',
            },
            attachmentId: attachment.id,
          });
        }
      }
      return chunks;
    }

    if (type === 'experiment') {
      const row = this.db
        .prepare('SELECT objective, hypothesis, method, results, metrics_json FROM experiments WHERE id = ?')
        .get(objectId) as
        | {
            objective: string;
            hypothesis: string;
            method: string;
            results: string;
            metrics_json: string;
          }
        | undefined;
      if (row) {
        for (const field of ['objective', 'hypothesis', 'method', 'results'] as const) {
          if (row[field].trim()) {
            chunks.push({ text: row[field].trim(), locator: { field } });
          }
        }
        const metrics = parseJson<{ name: string; value: number; unit?: string }[]>(row.metrics_json, []);
        if (metrics.length) {
          chunks.push({
            text: metrics.map((m) => `${m.name}: ${m.value}${m.unit ? ` ${m.unit}` : ''}`).join('\n'),
            locator: { field: 'metrics' },
          });
        }
      }
      return chunks;
    }

    if (type === 'question') {
      const row = this.db.prepare('SELECT context FROM questions WHERE id = ?').get(objectId) as
        | { context: string }
        | undefined;
      const text = [row?.context ?? '', fallbackText].join('\n').trim();
      if (text) chunks.push({ text, locator: { field: 'context' } });
      return chunks;
    }

    if (fallbackText.trim()) {
      chunks.push({ text: fallbackText.trim(), locator: { field: 'body' } });
    }
    return chunks;
  }

  removeObject(objectId: string): void {
    this.db.prepare('DELETE FROM search_fts WHERE object_id = ?').run(objectId);
    this.db.prepare('DELETE FROM chunks_fts WHERE object_id = ?').run(objectId);
    this.db.prepare('DELETE FROM chunks WHERE object_id = ?').run(objectId);
  }

  clearAll(): void {
    this.db.prepare('DELETE FROM search_fts').run();
    this.db.prepare('DELETE FROM chunks_fts').run();
    this.db.prepare('DELETE FROM chunks').run();
  }

  reindexAll(): number {
    const rows = this.db
      .prepare('SELECT id FROM objects WHERE deleted_at IS NULL ORDER BY created_at ASC')
      .all() as { id: string }[];
    for (const row of rows) this.indexObject(row.id);
    return rows.length;
  }

  /** Rebuild only the object-level FTS rows, preserving chunks and embeddings (used after restore). */
  reindexFtsAll(): number {
    const rows = this.db
      .prepare('SELECT id, type, title FROM objects WHERE deleted_at IS NULL ORDER BY created_at ASC')
      .all() as { id: string; type: ObjectType; title: string }[];
    const tagsStmt = this.db.prepare(
      'SELECT t.name FROM tags t JOIN object_tags ot ON ot.tag_id = t.id WHERE ot.object_id = ?',
    );
    for (const row of rows) {
      const def = objectTypes[row.type];
      if (!def) continue;
      const body = def.body(this.db, row.id);
      const tags = (tagsStmt.all(row.id) as { name: string }[]).map((entry) => entry.name).join(' ');
      this.db.prepare('DELETE FROM search_fts WHERE object_id = ?').run(row.id);
      this.db
        .prepare('INSERT INTO search_fts (title, body, tags, object_id) VALUES (?, ?, ?, ?)')
        .run(row.title, body.text, tags, row.id);
      this.db.prepare('UPDATE objects SET subtitle = ? WHERE id = ?').run(body.subtitle, row.id);
    }
    this.db.prepare('DELETE FROM chunks_fts').run();
    const chunks = this.db.prepare('SELECT id, object_id, text FROM chunks').all() as {
      id: string;
      object_id: string;
      text: string;
    }[];
    const insert = this.db.prepare('INSERT INTO chunks_fts (text, chunk_id, object_id) VALUES (?, ?, ?)');
    for (const chunk of chunks) insert.run(chunk.text, chunk.id, chunk.object_id);
    return rows.length;
  }

  // ── Embeddings ─────────────────────────────────────────────────────────
  embeddingConfig(): { provider: AiProvider; model: string; modelKey: string } | null {
    const config = this.settings.getEmbeddingProviderConfig();
    if (!config || !config.embedModel) return null;
    if (config.kind === 'fake') {
      return {
        provider: createProvider(config),
        model: config.embedModel,
        modelKey: `${config.kind}:${config.embedModel}`,
      };
    }
    return {
      provider: createProvider(config),
      model: config.embedModel,
      modelKey: `${config.id}:${config.embedModel}`,
    };
  }

  async embedObject(objectId: string): Promise<number> {
    const cfg = this.embeddingConfig();
    if (!cfg) return 0;
    const rows = this.db
      .prepare(
        'SELECT * FROM chunks WHERE object_id = ? AND (embedding IS NULL OR embedding_model != ?) ORDER BY id',
      )
      .all(objectId, cfg.modelKey) as ChunkRow[];
    if (!rows.length) return 0;
    let embedded = 0;
    for (let i = 0; i < rows.length; i += 32) {
      const batch = rows.slice(i, i + 32);
      const vectors = await cfg.provider.embed(
        batch.map((row) => row.text),
        cfg.model,
        AbortSignal.timeout(120_000),
      );
      if (vectors.length !== batch.length) {
        throw new AppError('provider_bad_response', 'Embedding count does not match input count.');
      }
      const update = this.db.prepare(
        'UPDATE chunks SET embedding = ?, embedding_model = ?, embedding_dim = ? WHERE id = ?',
      );
      batch.forEach((row, index) => {
        const vector = vectors[index]!;
        update.run(floatsToBuffer(vector), cfg.modelKey, vector.length, row.id);
        embedded++;
      });
    }
    return embedded;
  }

  embeddingCoverage(): { chunks: number; embedded: number; model: string | null } {
    const cfg = this.embeddingConfig();
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number };
    if (!cfg) return { chunks: total.count, embedded: 0, model: null };
    const embedded = this.db
      .prepare('SELECT COUNT(*) AS count FROM chunks WHERE embedding IS NOT NULL AND embedding_model = ?')
      .get(cfg.modelKey) as { count: number };
    return { chunks: total.count, embedded: embedded.count, model: cfg.modelKey };
  }

  // ── Search ─────────────────────────────────────────────────────────────
  async search(filters: SearchFilters): Promise<SearchResponse> {
    const started = Date.now();
    const mode = filters.mode ?? 'text';
    const limit = filters.limit ?? 30;
    const q = filters.q.trim();
    if (!q) {
      return {
        query: q,
        mode,
        engines: [],
        tookMs: Date.now() - started,
        results: [],
        total: 0,
        semanticAvailable: this.embeddingCoverage().embedded > 0,
      };
    }

    const engines: string[] = [];
    const textResults = this.textSearch({ ...filters, q, limit: 50 });
    if (textResults.length || mode !== 'semantic') engines.push('text');
    let semanticResults: SearchResult[] = [];
    if (mode !== 'text') {
      try {
        semanticResults = await this.semanticSearch({ ...filters, q, limit: 50 });
        engines.push('semantic');
      } catch (error) {
        if (mode === 'semantic') throw error;
      }
    }

    let results: SearchResult[];
    if (mode === 'text') results = textResults;
    else if (mode === 'semantic') results = semanticResults;
    else results = fuse(textResults, semanticResults);

    return {
      query: q,
      mode,
      engines,
      tookMs: Date.now() - started,
      results: results.slice(0, limit),
      total: results.length,
      semanticAvailable: this.embeddingCoverage().embedded > 0,
    };
  }

  private filterSql(filters: SearchFilters, params: unknown[], objectAlias = 'o'): string {
    const clauses: string[] = [`${objectAlias}.deleted_at IS NULL`];
    if (filters.type) {
      clauses.push(`${objectAlias}.type = ?`);
      params.push(filters.type);
    }
    if (filters.projectId === 'global') {
      clauses.push(`${objectAlias}.project_id IS NULL`);
    } else if (filters.projectId) {
      clauses.push(`${objectAlias}.project_id = ?`);
      params.push(filters.projectId);
    }
    if (filters.tag) {
      clauses.push(
        `EXISTS (SELECT 1 FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ${objectAlias}.id AND t.name = ? COLLATE NOCASE)`,
      );
      params.push(filters.tag);
    }
    if (filters.from) {
      clauses.push(`${objectAlias}.updated_at >= ?`);
      params.push(`${filters.from}T00:00:00.000Z`);
    }
    if (filters.to) {
      clauses.push(`${objectAlias}.updated_at <= ?`);
      params.push(`${filters.to}T23:59:59.999Z`);
    }
    return clauses.join(' AND ');
  }

  textSearch(filters: SearchFilters & { q: string }): SearchResult[] {
    const fts = safeFtsQuery(filters.q);
    if (!fts) return [];
    const params: unknown[] = [fts];
    const where = this.filterSql(filters, params);
    const rows = this.db
      .prepare(
        `SELECT search_fts.object_id AS objectId, o.type, o.title, o.project_id AS projectId,
                p.name AS projectName, o.updated_at AS updatedAt,
                bm25(search_fts, 8.0, 1.0, 3.0) AS score,
                snippet(search_fts, 1, '«', '»', '…', 14) AS snippet
         FROM search_fts
         JOIN objects o ON o.id = search_fts.object_id
         LEFT JOIN projects p ON p.id = o.project_id
         WHERE search_fts MATCH ? AND ${where}
         ORDER BY score ASC, o.updated_at DESC
         LIMIT ?`,
      )
      .all(...params, filters.limit ?? 50) as {
      objectId: string;
      type: ObjectType;
      title: string;
      projectId: string | null;
      projectName: string | null;
      updatedAt: string;
      score: number;
      snippet: string;
    }[];
    const objects: SearchResult[] = rows.map((row) => ({
      objectId: row.objectId,
      type: row.type,
      title: row.title,
      projectId: row.projectId,
      projectName: row.projectName,
      snippet: row.snippet,
      score: row.score,
      updatedAt: row.updatedAt,
    }));

    // Chunk-level text search makes PDF and long-note content searchable with a locator.
    const chunkParams: unknown[] = [fts];
    const chunkWhere = this.filterSql(filters, chunkParams);
    const chunkRows = this.db
      .prepare(
        `SELECT chunks_fts.object_id AS objectId, o.type, o.title, o.project_id AS projectId,
                p.name AS projectName, o.updated_at AS updatedAt,
                bm25(chunks_fts, 1.0) AS score,
                snippet(chunks_fts, 0, '«', '»', '…', 18) AS snippet,
                c.locator_json AS locatorJson
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.chunk_id
         JOIN objects o ON o.id = chunks_fts.object_id
         LEFT JOIN projects p ON p.id = o.project_id
         WHERE chunks_fts MATCH ? AND ${chunkWhere}
         ORDER BY score ASC
         LIMIT ?`,
      )
      .all(...chunkParams, filters.limit ?? 50) as {
      objectId: string;
      type: ObjectType;
      title: string;
      projectId: string | null;
      projectName: string | null;
      updatedAt: string;
      score: number;
      snippet: string;
      locatorJson: string;
    }[];
    const chunkBest = new Map<string, (typeof chunkRows)[number]>();
    for (const row of chunkRows) {
      const existing = chunkBest.get(row.objectId);
      if (!existing || row.score < existing.score) chunkBest.set(row.objectId, row);
    }
    const seen = new Set(objects.map((object) => object.objectId));
    for (const row of chunkBest.values()) {
      if (seen.has(row.objectId)) continue;
      objects.push({
        objectId: row.objectId,
        type: row.type,
        title: row.title,
        projectId: row.projectId,
        projectName: row.projectName,
        snippet: row.snippet,
        score: row.score,
        updatedAt: row.updatedAt,
        locator: parseJson(row.locatorJson, {}),
      });
    }
    return objects;
  }

  async semanticSearch(filters: SearchFilters & { q: string }): Promise<SearchResult[]> {
    const cfg = this.embeddingConfig();
    if (!cfg) throw new AppError('semantic_unavailable');
    const coverage = this.embeddingCoverage();
    if (coverage.embedded === 0) throw new AppError('semantic_unavailable');
    const [queryVector] = await cfg.provider.embed([filters.q], cfg.model, AbortSignal.timeout(30_000));
    if (!queryVector) throw new AppError('provider_bad_response', 'Empty query embedding.');
    const params: unknown[] = [cfg.modelKey];
    const where = this.filterSql(filters, params);
    const rows = this.db
      .prepare(
        `SELECT c.id, c.object_id, c.text, c.locator_json, c.embedding,
                o.type, o.title, o.project_id, o.updated_at, p.name AS project_name
         FROM chunks c JOIN objects o ON o.id = c.object_id
         LEFT JOIN projects p ON p.id = o.project_id
         WHERE c.embedding IS NOT NULL AND c.embedding_model = ? AND ${where}
         LIMIT 50000`,
      )
      .all(...params) as {
      id: string;
      object_id: string;
      text: string;
      locator_json: string;
      embedding: Buffer;
      type: ObjectType;
      title: string;
      project_id: string | null;
      updated_at: string;
      project_name: string | null;
    }[];

    interface Agg {
      result: SearchResult;
      best: number;
    }
    const byObject = new Map<string, Agg>();
    for (const row of rows) {
      const score = cosine(queryVector, bufferToFloats(row.embedding));
      if (score < 0.2) continue;
      const existing = byObject.get(row.object_id);
      if (!existing || score > existing.best) {
        byObject.set(row.object_id, {
          best: score,
          result: {
            objectId: row.object_id,
            type: row.type,
            title: row.title,
            projectId: row.project_id,
            projectName: row.project_name,
            snippet: makeSnippet(row.text, filters.q),
            score,
            updatedAt: row.updated_at,
            locator: parseJson(row.locator_json, {}),
          },
        });
      }
    }
    return [...byObject.values()]
      .sort((a, b) => b.best - a.best)
      .slice(0, filters.limit ?? 50)
      .map((entry) => entry.result);
  }

  suggest(q: string, limit = 8): { objectId: string; type: string; title: string }[] {
    const fts = safeFtsQuery(q);
    if (!fts) return [];
    return this.db
      .prepare(
        `SELECT search_fts.object_id AS objectId, o.type, o.title
         FROM search_fts JOIN objects o ON o.id = search_fts.object_id
         WHERE search_fts MATCH ? AND o.deleted_at IS NULL
         ORDER BY bm25(search_fts, 8.0, 1.0, 3.0) ASC
         LIMIT ?`,
      )
      .all(fts, limit) as { objectId: string; type: string; title: string }[];
  }

  async retrieve(options: {
    query: string;
    scope: 'global' | 'project' | 'selection';
    projectId?: string | null;
    objectIds?: string[];
    types?: ObjectType[];
    limit?: number;
  }): Promise<RetrievedChunk[]> {
    const limit = options.limit ?? 8;
    if (options.scope === 'selection') {
      return this.chunksForObjects(options.objectIds ?? [], limit * 2);
    }

    const response = await this.search({
      q: options.query,
      mode: this.embeddingConfig() ? 'hybrid' : 'text',
      projectId: options.scope === 'project' ? options.projectId ?? undefined : undefined,
      limit: limit * 3,
    });

    const chunks: RetrievedChunk[] = [];
    for (const result of response.results) {
      if (result.type === 'task' && !options.types?.includes('task')) continue;
      if (result.type === 'question' && !options.types?.includes('question')) continue;
      const rows = this.db
        .prepare(
          `SELECT c.id, c.locator_json, c.text, o.type, o.title, o.project_id
           FROM chunks c JOIN objects o ON o.id = c.object_id
           WHERE c.object_id = ? AND o.deleted_at IS NULL
           ORDER BY CASE WHEN c.text LIKE ? THEN 0 ELSE 1 END, length(c.text) DESC
           LIMIT 2`,
        )
        .all(result.objectId, `%${options.query.split(/\s+/)[0] ?? ''}%`) as {
        id: string;
        locator_json: string;
        text: string;
        type: string;
        title: string;
        project_id: string | null;
      }[];
      for (const row of rows) {
        chunks.push({
          chunkId: row.id,
          objectId: result.objectId,
          objectType: row.type,
          title: row.title,
          projectId: row.project_id,
          locator: parseJson(row.locator_json, {}),
          text: row.text,
          score: result.score,
        });
      }
      if (chunks.length >= limit) break;
    }
    return chunks.slice(0, limit);
  }

  chunksForObjects(objectIds: string[], limit = 20): RetrievedChunk[] {
    if (!objectIds.length) return [];
    const placeholders = objectIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT c.id, c.object_id, c.locator_json, c.text, o.type, o.title, o.project_id
         FROM chunks c JOIN objects o ON o.id = c.object_id
         WHERE c.object_id IN (${placeholders}) AND o.deleted_at IS NULL
         ORDER BY c.object_id, c.created_at LIMIT ?`,
      )
      .all(...objectIds, limit) as {
      id: string;
      object_id: string;
      locator_json: string;
      text: string;
      type: string;
      title: string;
      project_id: string | null;
    }[];
    return rows.map((row) => ({
      chunkId: row.id,
      objectId: row.object_id,
      objectType: row.type,
      title: row.title,
      projectId: row.project_id,
      locator: parseJson(row.locator_json, {}),
      text: row.text,
      score: 1,
    }));
  }

  status(): {
    chunks: number;
    embedded: number;
    model: string | null;
    objects: number;
    semanticAvailable: boolean;
  } {
    const coverage = this.embeddingCoverage();
    const objects = this.db
      .prepare('SELECT COUNT(*) AS count FROM objects WHERE deleted_at IS NULL')
      .get() as { count: number };
    return {
      ...coverage,
      objects: objects.count,
      semanticAvailable: coverage.embedded > 0,
    };
  }
}

function fuse(text: SearchResult[], semantic: SearchResult[]): SearchResult[] {
  const k = 60;
  const scores = new Map<string, { result: SearchResult; score: number }>();
  const add = (result: SearchResult, rank: number) => {
    const entry = scores.get(result.objectId);
    const contribution = 1 / (k + rank);
    if (entry) {
      entry.score += contribution;
      if (!entry.result.locator && result.locator) entry.result.locator = result.locator;
      if (!entry.result.snippet && result.snippet) entry.result.snippet = result.snippet;
    } else {
      scores.set(result.objectId, { result: { ...result }, score: contribution });
    }
  };
  text.forEach((result, index) => add(result, index + 1));
  semantic.forEach((result, index) => add(result, index + 1));
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map((entry) => ({ ...entry.result, score: entry.score }));
}
