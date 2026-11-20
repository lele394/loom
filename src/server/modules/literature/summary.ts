import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { SettingsService } from '../settings/service';
import type { AttachmentService } from '../attachments/service';
import type { ActivityService } from '../activity/service';
import type { AppConfig } from '../../config';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { createProvider } from '../../ai';
import {
  SUMMARY_PROMPT_VERSION,
  buildSummaryImageMessages,
  buildSummaryMessages,
} from '../../ai/prompts';
import { extractPdf } from '../../core/pdf';
import { ocrWithTesseract, withPdfImages, type RenderedPdfPage } from '../../core/pdfImages';
import { extractReadableText, safeFetch } from '../../core/net';
import type { PdfMetadataMode } from '../../../shared/constants';
import type { Reference, SummaryVersion, SummaryVersionSummary } from '../../../shared/types';
import { LiteratureService } from './service';

export class LiteratureSummaryService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly attachments: AttachmentService,
    private readonly activity: ActivityService,
    private readonly config: AppConfig,
    private readonly literature: LiteratureService,
  ) {}

  private imageUrl(page: RenderedPdfPage): string {
    return `data:${page.mime};base64,${page.base64}`;
  }

  private async pdfSummaryInput(
    buffer: Buffer,
    reference: Reference,
    mode: PdfMetadataMode,
  ): Promise<{
    text: string;
    images: string[];
    ocr: boolean;
  }> {
    let extraction: Awaited<ReturnType<typeof extractPdf>> | null = null;
    try {
      extraction = await extractPdf(buffer);
    } catch {
      extraction = null;
    }
    const text = extraction?.text ?? '';
    if (mode === 'text') return { text, images: [], ocr: false };
    return withPdfImages(
      buffer,
      this.config.tmpDir,
      async (pages) => {
        const local = mode === 'ocr' ? await ocrWithTesseract(pages.map((page) => page.path)) : null;
        if (local) return { text: local, images: [], ocr: true };
        return {
          text,
          images: pages.map((page) => this.imageUrl(page)),
          ocr: mode === 'ocr',
        };
      },
      { dpi: mode === 'ocr' ? 200 : 150, maxPages: 3 },
    );
  }

  async generate(
    referenceId: string,
    options: { mode?: PdfMetadataMode; instructions?: string; actorId?: string } = {},
  ): Promise<string> {
    const row = this.db
      .prepare(
        `SELECT l.*, o.title, o.project_id FROM literature l
         JOIN objects o ON o.id = l.id WHERE l.id = ? AND o.deleted_at IS NULL`,
      )
      .get(referenceId) as
      | {
          title: string;
          project_id: string | null;
          authors_json: string;
          venue: string;
          year: number | null;
          abstract: string;
          notes: string;
          url: string | null;
        }
      | undefined;
    if (!row) throw notFound('Reference');

    const config = this.settings.getProviderConfig();
    if (!config || (!config.chatModel && config.kind !== 'fake')) {
      throw new AppError('ai_unavailable', 'No AI provider configured.');
    }
    const reference = this.literature.get(referenceId);
    const appSettings = this.settings.getApp();
    const contextChars = Math.max(4_000, appSettings.aiContextTokens * 4);
    const mode = options.mode ?? appSettings.pdfMetadataMode;
    const instructions = (options.instructions ?? '').slice(0, 4000);
    let input: { text: string; images: string[]; ocr: boolean };

    const pdf = await this.attachments.pdfForObject(referenceId);
    if (pdf) {
      input = await this.pdfSummaryInput(pdf.buffer, reference, mode);
    } else if (reference.url) {
      const archived = this.db
        .prepare(
          `SELECT t.text FROM attachments a JOIN attachment_text t ON t.attachment_id = a.id
           WHERE a.object_id = ? AND a.mime LIKE 'text/html%' LIMIT 1`,
        )
        .get(referenceId) as { text: string } | undefined;
      if (archived?.text) {
        input = { text: archived.text.slice(0, contextChars), images: [], ocr: false };
      } else {
        const fetched = await safeFetch(reference.url);
        if (fetched.contentType === 'application/pdf') {
          input = await this.pdfSummaryInput(Buffer.from(fetched.body, 'latin1'), reference, mode);
        } else {
          input = { text: extractReadableText(fetched.body, contextChars), images: [], ocr: false };
        }
      }
    } else {
      input = {
        text: [reference.abstract, reference.notes].filter(Boolean).join('\n\n'),
        images: [],
        ocr: false,
      };
    }

    if (input.text.length > contextChars) {
      input = { ...input, text: input.text.slice(0, contextChars) };
    }
    if (!input.text.trim() && !input.images.length) {
      throw new AppError(
        'unsupported_file',
        mode === 'text'
          ? 'No extractable text. Choose OCR or page images for a scanned PDF.'
          : 'No readable content could be extracted for a summary.',
      );
    }

    const provider = createProvider(config);
    const prompt = input.images.length
      ? buildSummaryImageMessages({
          images: input.images,
          title: reference.title,
          authors: reference.authors,
          venue: reference.venue,
          year: reference.year,
          instructions,
          ocr: input.ocr,
        })
      : buildSummaryMessages({
          title: reference.title,
          authors: reference.authors,
          venue: reference.venue,
          year: reference.year,
          text: input.text,
          instructions,
        });

    let summary = '';
    for await (const chunk of provider.chat({
      model: config.chatModel,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      maxTokens: appSettings.aiSummaryOutputTokens,
      temperature: 0.2,
      signal: AbortSignal.timeout(180_000),
    })) {
      if (chunk.type === 'text') summary += chunk.text;
    }
    summary = summary.trim();
    if (!summary) throw new AppError('provider_bad_response', 'The model returned an empty summary.');

    const model = `${config.chatModel || config.kind} (${SUMMARY_PROMPT_VERSION})`;
    const now = this.clock.iso();
    const promptText = input.images.length
      ? [
          prompt.system,
          `[Image-based summary: ${input.images.length} page image(s) supplied]`,
          typeof prompt.user === 'string'
            ? prompt.user
            : prompt.user
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n'),
        ].join('\n\n')
      : `${prompt.system}\n\n${prompt.user}`;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE literature SET ai_summary = ?, ai_summary_model = ?, ai_summary_at = ?, ai_summary_instructions = ?
           WHERE id = ?`,
        )
        .run(summary, model, now, instructions, referenceId);
      this.db
        .prepare(
          `INSERT INTO reference_summary_versions
             (id, reference_id, title, summary_md, prompt, model, mode, instructions, created_by, created_at)
           VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId('sver'),
          referenceId,
          summary,
          promptText,
          model,
          mode,
          instructions,
          options.actorId ?? this.primaryUserId(),
          now,
        );
    });
    tx();
    this.activity.record({
      actorId: options.actorId ?? this.primaryUserId(),
      projectId: row.project_id,
      objectId: referenceId,
      objectType: 'reference',
      objectTitle: reference.title,
      action: 'reference.summarized',
      summary: `Generated an AI summary for "${reference.title}"`,
      source: 'job',
    });
    return summary;
  }

  listVersions(referenceId: string): SummaryVersionSummary[] {
    this.literature.assertExists(referenceId);
    const rows = this.db
      .prepare(
        `SELECT id, reference_id, title, model, mode, instructions,
                length(summary_md) AS char_count, created_at
         FROM reference_summary_versions
         WHERE reference_id = ?
         ORDER BY created_at DESC, id DESC`,
      )
      .all(referenceId) as {
      id: string;
      reference_id: string;
      title: string;
      model: string | null;
      mode: string;
      instructions: string;
      char_count: number;
      created_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      referenceId: row.reference_id,
      title: row.title,
      model: row.model,
      mode: row.mode,
      instructions: row.instructions,
      charCount: row.char_count,
      createdAt: row.created_at,
    }));
  }

  getVersion(versionId: string): SummaryVersion {
    const row = this.db
      .prepare('SELECT * FROM reference_summary_versions WHERE id = ?')
      .get(versionId) as
      | {
          id: string;
          reference_id: string;
          title: string;
          summary_md: string;
          prompt: string;
          model: string | null;
          mode: string;
          instructions: string;
          created_at: string;
        }
      | undefined;
    if (!row) throw notFound('Summary version');
    return {
      id: row.id,
      referenceId: row.reference_id,
      title: row.title,
      summaryMarkdown: row.summary_md,
      prompt: row.prompt,
      model: row.model,
      mode: row.mode,
      instructions: row.instructions,
      charCount: row.summary_md.length,
      createdAt: row.created_at,
    };
  }

  updateVersionTitle(versionId: string, title: string): SummaryVersionSummary {
    const version = this.getVersion(versionId);
    const clean = title.trim().slice(0, 250);
    this.db
      .prepare('UPDATE reference_summary_versions SET title = ? WHERE id = ?')
      .run(clean, versionId);
    return {
      id: version.id,
      referenceId: version.referenceId,
      title: clean,
      model: version.model,
      mode: version.mode,
      instructions: version.instructions,
      charCount: version.charCount,
      createdAt: version.createdAt,
    };
  }

  private primaryUserId(): string {
    const row = this.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as {
      id: string;
    };
    return row.id;
  }
}
