import { z } from 'zod';
import type { SettingsService } from '../settings/service';
import { createProvider } from '../../ai';
import {
  METADATA_PROMPT_VERSION,
  buildMetadataImageMessages,
  buildMetadataMessages,
  buildOcrMessages,
} from '../../ai/prompts';
import { messageText, type AiMessage, type ChatRequest } from '../../ai/types';
import { REFERENCE_TYPES, type PdfMetadataMode, type ReferenceType } from '../../../shared/constants';

export interface ExtractedMetadata {
  title?: string;
  authors?: string[];
  year?: number | null;
  venue?: string;
  doi?: string | null;
  url?: string | null;
  abstract?: string;
  type?: ReferenceType;
  publishedAt?: string | null;
}

export interface MetadataExtractionResult {
  metadata: ExtractedMetadata;
  raw: string | null;
  model: string | null;
  error: string | null;
  mode: PdfMetadataMode;
  ocrText: string | null;
  imageCount: number;
  metadataOrigin: 'ai' | 'heuristic';
}

const modelSchema = z.object({
  title: z.string().max(500).nullable().optional(),
  authors: z.array(z.string().max(200)).max(100).optional(),
  year: z.union([z.number(), z.string()]).nullable().optional(),
  venue: z.string().max(300).nullable().optional(),
  doi: z.string().max(300).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  abstract: z.string().max(50_000).nullable().optional(),
  type: z.enum(REFERENCE_TYPES).nullable().optional(),
  publishedAt: z.string().max(40).nullable().optional(),
});

function cleanDoi(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/[.,;]+$/, '');
  return /^10\.\d{4,9}\/\S+$/i.test(cleaned) ? cleaned : null;
}

function cleanUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function cleanAbstract(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, ' ').trim();
  return cleaned.length > 20 ? cleaned.slice(0, 50_000) : null;
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalise(value: z.infer<typeof modelSchema>): ExtractedMetadata {
  const metadata: ExtractedMetadata = {};
  if (value.title?.trim()) metadata.title = value.title.trim();
  if (value.authors) {
    const authors = value.authors.map((author) => author.trim()).filter(Boolean).slice(0, 100);
    if (authors.length) metadata.authors = authors;
  }
  if (value.year !== null && value.year !== undefined && value.year !== '') {
    const year = Number(value.year);
    if (Number.isInteger(year) && year >= 1000 && year <= 2200) metadata.year = year;
  }
  if (value.venue?.trim()) metadata.venue = value.venue.trim();
  const doi = cleanDoi(value.doi);
  if (doi) metadata.doi = doi;
  const url = cleanUrl(value.url);
  if (url) metadata.url = url;
  const abstract = cleanAbstract(value.abstract);
  if (abstract) metadata.abstract = abstract;
  if (value.type) metadata.type = value.type;
  if (value.publishedAt && /^\d{4}-\d{2}-\d{2}$/.test(value.publishedAt)) {
    metadata.publishedAt = value.publishedAt;
  }
  return metadata;
}


const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const NOISE = /jstor|taylor\s*&\s*francis|this content downloaded|all use subject|stable url|accessed:|author\(s\):|published by:|about\.jstor|terms and conditions|not-for-profit|digitize|scholars|support@|downloaded from|university of/i;

/** Deterministic metadata from first-page text, used when the model returns nothing or malformed JSON. */
export function heuristicMetadataFromText(text: string, titleHint?: string | null): ExtractedMetadata {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const metadata: ExtractedMetadata = {};
  const doiMatch = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.exec(text.slice(0, 20_000));
  const doi = cleanDoi(doiMatch?.[0]);
  if (doi) metadata.doi = doi;

  const authorLine = lines.find((line) => /^author\(s\)\s*:/i.test(line));
  if (authorLine) {
    const authors = authorLine
      .replace(/^author\(s\)\s*:\s*/i, '')
      .split(/\s*(?:;|\band\b)\s*/i)
      .map((author) => author.trim())
      .filter(Boolean);
    if (authors.length) metadata.authors = authors;
  }

  const sourceLine = lines.find((line) => /^source\s*:/i.test(line));
  if (sourceLine) {
    const venue = sourceLine
      .replace(/^source\s*:\s*/i, '')
      .split(/,\s*(?:vol\.|pp\.)|,\s*\d+\s*\(|\s+vol\./i)[0]
      ?.trim();
    if (venue && venue.length > 2) metadata.venue = venue.replace(/[.,;]+$/, '');
    const year = /\((?:[A-Z][a-z]{2,9}\.?,?\s*)?((?:19|20)\d{2})\)/.exec(sourceLine)?.[1];
    if (year) {
      metadata.year = Number(year);
      const month = /\(([A-Z][a-z]{2,9})\.?,?\s+(?:19|20)\d{2}\)/.exec(sourceLine)?.[1];
      const monthNumber = month ? MONTHS[month.slice(0, 3).toLowerCase()] : undefined;
      if (monthNumber) metadata.publishedAt = `${year}-${monthNumber}-01`;
    }
  }

  if (!metadata.year) {
    const yearMatch = /\b(19|20)\d{2}\b/.exec(text.slice(0, 12_000));
    if (yearMatch) metadata.year = Number(yearMatch[0]);
  }

  // Prefer a mixed-case title line near the top (the actual title, not a JSTOR watermark).
  const titleCaseCandidate = lines.slice(0, 20).find((line) => {
    if (NOISE.test(line)) return false;
    const letters = line.replace(/[^A-Za-z]/g, '');
    const upper = line.replace(/[^A-Z]/g, '');
    const ratio = letters ? upper.length / letters.length : 0;
    return (
      line.length >= 20 &&
      line.length <= 220 &&
      line.split(/\s+/).length >= 4 &&
      ratio < 0.5 &&
      !/^(vol\.|pp\.|doi|https?:|accessed:|source:)/i.test(line)
    );
  });
  if (titleCaseCandidate) metadata.title = titleCaseCandidate;

  // Otherwise use the longest consecutive run of uppercase lines on page 1.
  let bestTitle = '';
  let run: string[] = [];
  const flush = () => {
    const candidate = run.join(' ').replace(/\s+/g, ' ').trim();
    if (candidate.length > bestTitle.length && candidate.length >= 12) bestTitle = candidate;
    run = [];
  };
  for (const line of lines.slice(0, 40)) {
    if (NOISE.test(line)) {
      flush();
      continue;
    }
    const letters = line.replace(/[^A-Za-z]/g, '');
    const upper = line.replace(/[^A-Z]/g, '');
    const ratio = letters ? upper.length / letters.length : 0;
    const words = line.split(/\s+/).length;
    if (line.length >= 10 && line.length <= 220 && words >= 2 && ratio > 0.68) {
      run.push(line);
    } else {
      flush();
    }
  }
  flush();
  if (!bestTitle) {
    const fallback = lines.find(
      (line) =>
        !NOISE.test(line) &&
        line.length >= 18 &&
        line.split(/\s+/).length >= 3 &&
        !/^(vol\.|pp\.|doi|https?:)/i.test(line),
    );
    if (fallback) bestTitle = fallback;
  }
  if (!metadata.title && bestTitle) metadata.title = bestTitle;
  if (!metadata.title && titleHint?.trim()) metadata.title = titleHint.trim();

  const urlLine = lines.find((line) => /^stable url\s*:/i.test(line));
  if (urlLine) {
    const raw = urlLine.replace(/^stable url\s*:\s*/i, '').replace(/\s+/g, '');
    const url = cleanUrl(raw);
    if (url) metadata.url = url;
  }
  if (metadata.year || metadata.venue) metadata.type = 'article';
  return metadata;
}

export class LiteratureMetadataService {
  constructor(private readonly settings: SettingsService) {}

  defaultMode(): PdfMetadataMode {
    return this.settings.getApp().pdfMetadataMode;
  }

  async extract(
    input: {
      text: string;
      titleHint?: string | null;
      url?: string | null;
      filename?: string | null;
    },
    options: { mode?: PdfMetadataMode; images?: string[]; ocrText?: string | null } = {},
  ): Promise<MetadataExtractionResult> {
    const mode = options.mode ?? 'text';
    const images = options.images ?? [];
    const base: MetadataExtractionResult = {
      metadata: {},
      raw: null,
      model: null,
      error: null,
      mode,
      ocrText: options.ocrText ?? null,
      imageCount: images.length,
      metadataOrigin: 'heuristic',
    };

    const config = this.settings.getProviderConfig();
    if (!config || (!config.chatModel && config.kind !== 'fake')) {
      const heuristic = heuristicMetadataFromText(options.ocrText ?? input.text, input.titleHint);
      return {
        ...base,
        metadata: heuristic,
        error: 'No AI provider configured.',
        metadataOrigin: 'heuristic',
      };
    }
    if (mode === 'images' && images.length === 0) {
      return { ...base, error: 'Image mode needs rendered PDF pages.' };
    }
    if (mode === 'ocr' && !options.ocrText && images.length === 0) {
      return { ...base, error: 'OCR mode needs rendered PDF pages.' };
    }
    if (mode !== 'images' && mode !== 'ocr' && !input.text.trim()) {
      return { ...base, error: 'No extractable text.' };
    }

    const provider = createProvider(config);
    const model = `${config.chatModel || config.kind} (${METADATA_PROMPT_VERSION})`;
    const messages = (system: string, user: AiMessage['content']): AiMessage[] => [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    const collect = async (request: ChatRequest): Promise<string> => {
      let output = '';
      for await (const chunk of provider.chat(request)) {
        if (chunk.type === 'text') output += chunk.text;
      }
      return output;
    };
    const complete = async (payload: AiMessage[], json: boolean, maxTokens = 900): Promise<string> => {
      const run = (useJson: boolean) =>
        collect({
          model: config.chatModel,
          messages: payload,
          maxTokens,
          temperature: 0,
          json: useJson,
          signal: AbortSignal.timeout(45_000),
        });
      try {
        const first = await run(json);
        if (json && !first.trim()) return await run(false);
        return first;
      } catch (firstError) {
        const message = (firstError as Error).message.toLowerCase();
        if (!json || !/response_format|json mode|json_object|http 400/.test(message)) throw firstError;
        return run(false);
      }
    };

    try {
      let ocrText = options.ocrText ?? null;
      let raw = '';

      if (mode === 'ocr' && !ocrText) {
        const ocrPrompt = buildOcrMessages(images);
        ocrText = (await complete(messages(ocrPrompt.system, ocrPrompt.user), false, 1600)).trim();
        if (!ocrText) {
          return { ...base, error: 'The model returned no OCR text.', ocrText: null };
        }
      }

      let metadataRaw = '';
      if (mode === 'images') {
        const prompt = buildMetadataImageMessages({
          images,
          ...(input.titleHint ? { titleHint: input.titleHint } : {}),
          ...(input.filename ? { filename: input.filename } : {}),
        });
        metadataRaw = await complete(messages(prompt.system, prompt.user), true);
        raw = metadataRaw;
      } else {
        const text = mode === 'ocr' ? ocrText ?? '' : input.text;
        const prompt = buildMetadataMessages({
          text,
          ...(input.titleHint ? { titleHint: input.titleHint } : {}),
          ...(input.url ? { url: input.url } : {}),
          ...(input.filename ? { filename: input.filename } : {}),
        });
        metadataRaw = await complete(messages(prompt.system, prompt.user), true);
        if ((!metadataRaw.trim() || !modelSchema.safeParse(parseJson(metadataRaw)).success) && text.trim()) {
          // Some small/local models return an empty completion in JSON mode. Ask again
          // with a compact, explicit JSON-only prompt and no response_format.
          metadataRaw = await complete(
            [
              {
                role: 'system',
                content:
                  'You extract bibliographic metadata. Return ONLY a JSON object with keys title, authors (array), year, venue, doi, url, abstract, type, publishedAt. Use null when unknown. No markdown, no commentary.',
              },
              {
                role: 'user',
                content: `${input.titleHint ? `Title hint: ${input.titleHint}\n` : ''}Text:\n${text.slice(0, 6000)}`,
              },
            ],
            false,
            700,
          );
        }
        raw = mode === 'ocr' ? `--- OCR TEXT ---\n${ocrText ?? ''}\n\n--- METADATA JSON ---\n${metadataRaw}` : metadataRaw;
      }

      const parsed = modelSchema.safeParse(parseJson(metadataRaw));
      const aiMetadata = parsed.success ? normalise(parsed.data) : {};
      const sourceText = mode === 'images' ? input.text : mode === 'ocr' ? ocrText ?? input.text : input.text;
      const heuristic = heuristicMetadataFromText(sourceText, input.titleHint);
      const metadata: ExtractedMetadata = { ...heuristic, ...aiMetadata };
      const aiHasFields = Object.keys(aiMetadata).length > 0;
      if (!Object.keys(metadata).length) {
        return {
          ...base,
          raw,
          model,
          ocrText,
          error: raw.trim() ? 'The AI response was not valid metadata JSON.' : 'The AI provider returned no text.',
        };
      }
      return {
        metadata,
        raw,
        model,
        error: parsed.success ? null : 'The AI response was not valid metadata JSON; heuristic fallback used.',
        mode,
        ocrText,
        imageCount: images.length,
        metadataOrigin: aiHasFields ? 'ai' : 'heuristic',
      };
    } catch (error) {
      return { ...base, model, error: (error as Error).message, ocrText: options.ocrText ?? null };
    }
  }
}
