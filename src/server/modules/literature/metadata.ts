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
  /** Final prompt sent for the metadata call (images are summarised, not embedded). */
  prompt?: string | null;
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

function sliceJson(raw: string): string | null {
  const cleaned = raw.replace(/^\uFEFF/, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const open = cleaned[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === open) depth++;
    else if (char === close) {
      depth--;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  return null;
}

/** Parse a model response even when it is fenced, wrapped in prose, or has trailing commas. */
function parseJson(raw: string): unknown {
  const slice = sliceJson(raw);
  if (!slice) return null;
  for (const candidate of [slice, slice.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      if (record) return record;
    }
    return null;
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function splitAuthors(value: string): string[] {
  const primary = value
    .split(/\s*(?:;|\band\b|\n)\s*/i)
    .map((author) => author.trim())
    .filter(Boolean);
  if (primary.length > 1) return primary;
  const single = primary[0] ?? '';
  if (single.includes(',')) {
    const parts = single.split(',').map((part) => part.trim()).filter(Boolean);
    // "Paul I. Penzes, Alain J. Martin" is a list, "Doe, Jane" is one name.
    if (parts.length > 1 && parts.filter((part) => part.includes(' ')).length >= 2) return parts;
  }
  return single ? [single] : [];
}

function normaliseAuthors(value: unknown): string[] | undefined {
  const names: string[] = [];
  const add = (item: unknown) => {
    if (typeof item === 'string') {
      names.push(...splitAuthors(item));
      return;
    }
    const record = asRecord(item);
    if (!record) return;
    const name = asString(record.name ?? record.fullName ?? record.full_name ?? record.displayName);
    if (name) names.push(name);
  };
  if (Array.isArray(value)) for (const item of value) add(item);
  else add(value);
  const unique = [...new Set(names.map((name) => name.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  return unique.length ? unique.slice(0, 100) : undefined;
}

function normaliseYear(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 2200) {
    return value;
  }
  if (typeof value === 'string') {
    const match = /\b(1\d{3}|2[0-2]\d{2})\b/.exec(value);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function normaliseDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const month = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (month) return `${trimmed}-01`;
  if (/[A-Za-z]{3}/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      const iso = parsed.toISOString().slice(0, 10);
      if (iso >= '1000-01-01' && iso <= '2200-12-31') return iso;
    }
  }
  return undefined;
}

function normaliseType(value: unknown): ReferenceType | undefined {
  const clean = asString(value)?.toLowerCase().replace(/[_/]+/g, ' ').trim();
  if (!clean) return undefined;
  if ((REFERENCE_TYPES as readonly string[]).includes(clean)) return clean as ReferenceType;
  if (/conference|proceedings|symposium|workshop/.test(clean)) return 'inproceedings';
  if (/journal|article|paper/.test(clean)) return 'article';
  if (/web|blog|page|site/.test(clean)) return 'website';
  if (/thesis|dissertation/.test(clean)) return 'thesis';
  if (/report|technical/.test(clean)) return 'report';
  if (/preprint|arxiv/.test(clean)) return 'preprint';
  if (/book|chapter/.test(clean)) return 'book';
  return undefined;
}

/**
 * Models often use different casing or aliases (`DOI`, `Year`, `Journal`, `author`).
 * Map those onto the canonical schema before validation.
 */
function normaliseModelPayload(value: unknown): Record<string, unknown> | null {
  let record = asRecord(value);
  if (!record) return null;

  const hasBibliographicKey = (item: Record<string, unknown>) =>
    Object.keys(item).some((key) => /^(title|name|authors?|doi|year)$/.test(key.toLowerCase().replace(/[^a-z]/g, '')));
  if (!hasBibliographicKey(record)) {
    for (const wrapper of ['metadata', 'data', 'result', 'reference', 'paper', 'record']) {
      const inner = asRecord(record[wrapper]);
      if (inner && hasBibliographicKey(inner)) {
        record = inner;
        break;
      }
    }
  }

  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (out[key] === undefined && value !== undefined) out[key] = value;
  };

  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = rawKey.toLowerCase().replace(/[^a-z]/g, '');
    if (key === 'title' || key === 'name' || key === 'papertitle' || key === 'documenttitle') {
      put('title', asString(rawValue));
    } else if (key === 'authors' || key === 'author' || key === 'creators' || key === 'creator') {
      put('authors', normaliseAuthors(rawValue));
    } else if (key === 'year' || key === 'publicationyear' || key === 'publishedyear' || key === 'pubyear') {
      put('year', normaliseYear(rawValue));
    } else if (
      key === 'venue' ||
      key === 'journal' ||
      key === 'conference' ||
      key === 'booktitle' ||
      key === 'proceedings' ||
      key === 'publication'
    ) {
      put('venue', asString(rawValue));
    } else if (key === 'doi') {
      put('doi', asString(rawValue));
    } else if (key === 'url' || key === 'link' || key === 'uri' || key === 'webpage') {
      put('url', asString(rawValue));
    } else if (key === 'abstract' || key === 'description') {
      put('abstract', asString(rawValue));
    } else if (key === 'type' || key === 'documenttype' || key === 'kind' || key === 'entrytype') {
      put('type', normaliseType(rawValue));
    } else if (
      key === 'publishedat' ||
      key === 'publicationdate' ||
      key === 'publisheddate' ||
      key === 'date'
    ) {
      put('publishedAt', normaliseDate(rawValue));
    }
  }
  return out;
}

/** Parse a raw provider response into validated metadata, or null when no object can be read. */
export function parseMetadataResponse(raw: string): ExtractedMetadata | null {
  const parsed = modelSchema.safeParse(normaliseModelPayload(parseJson(raw)));
  return parsed.success ? normalise(parsed.data) : null;
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
    const complete = async (payload: AiMessage[], json: boolean, maxTokens = 1600): Promise<string> => {
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
        const code = (firstError as { code?: string }).code;
        if (
          !json ||
          (code !== 'provider_error' && !/response_format|json mode|json_object|http 400/.test(message))
        ) {
          throw firstError;
        }
        return run(false);
      }
    };

    const parseMetadata = (raw: string) => {
      const payload = normaliseModelPayload(parseJson(raw));
      return { payload, parsed: modelSchema.safeParse(payload) };
    };
    const usableMetadata = (raw: string): boolean => {
      const { parsed } = parseMetadata(raw);
      return parsed.success && Object.keys(normalise(parsed.data)).length > 0;
    };

    try {
      let ocrText = options.ocrText ?? null;
      let metadataRaw = '';
      let promptUsed: string | null = null;
      const promptText = (system: string, user: string) => `SYSTEM:\n${system}\n\nUSER:\n${user}`;

      if (mode === 'ocr' && !ocrText) {
        const ocrPrompt = buildOcrMessages(images);
        ocrText = (await complete(messages(ocrPrompt.system, ocrPrompt.user), false, 1600)).trim();
        if (!ocrText) {
          return { ...base, error: 'The model returned no OCR text.', ocrText: null };
        }
      }

      if (mode === 'images') {
        const prompt = buildMetadataImageMessages({
          images,
          ...(input.titleHint ? { titleHint: input.titleHint } : {}),
          ...(input.filename ? { filename: input.filename } : {}),
        });
        promptUsed = promptText(prompt.system, '[...page images attached...]');
        metadataRaw = await complete(messages(prompt.system, prompt.user), true, 1600);
      } else {
        const text = mode === 'ocr' ? ocrText ?? '' : input.text;
        const ask = async (limit: number, json: boolean, maxTokens: number) => {
          const prompt = buildMetadataMessages({
            text: text.slice(0, limit),
            ...(input.titleHint ? { titleHint: input.titleHint } : {}),
            ...(input.url ? { url: input.url } : {}),
            ...(input.filename ? { filename: input.filename } : {}),
          });
          promptUsed = promptText(prompt.system, prompt.user);
          return complete(messages(prompt.system, prompt.user), json, maxTokens);
        };

        metadataRaw = await ask(8_000, true, 2000);
        // Small/local models sometimes return nothing when the prompt is long or when
        // JSON mode is unsupported. Retry with less text and no response_format.
        if (!usableMetadata(metadataRaw) && text.trim()) {
          metadataRaw = await ask(4_000, false, 2000);
        }
        if (!usableMetadata(metadataRaw) && text.trim()) {
          metadataRaw = await ask(2_200, false, 1600);
        }
      }

      const { parsed } = parseMetadata(metadataRaw);
      const aiMetadata = parsed.success ? normalise(parsed.data) : {};
      const sourceText = mode === 'images' ? input.text : mode === 'ocr' ? ocrText ?? input.text : input.text;
      const heuristic = heuristicMetadataFromText(sourceText, input.titleHint);
      const metadata: ExtractedMetadata = { ...heuristic, ...aiMetadata };
      const aiHasFields = Object.keys(aiMetadata).length > 0;
      if (!Object.keys(metadata).length) {
        return {
          ...base,
          raw: metadataRaw,
          model,
          ocrText,
          prompt: promptUsed,
          error: metadataRaw.trim()
            ? 'The AI response did not contain usable metadata.'
            : 'The AI provider returned no text for the metadata request.',
        };
      }
      return {
        metadata,
        raw: metadataRaw,
        model,
        error: parsed.success
          ? null
          : metadataRaw.trim()
            ? 'The AI response was not valid metadata JSON; heuristic fallback used.'
            : 'The AI provider returned no text for the metadata request; heuristic fallback used.',
        mode,
        ocrText,
        imageCount: images.length,
        metadataOrigin: aiHasFields ? 'ai' : 'heuristic',
        prompt: promptUsed,
      };
    } catch (error) {
      return { ...base, model, error: (error as Error).message, ocrText: options.ocrText ?? null };
    }
  }
}
