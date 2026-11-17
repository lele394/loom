import { z } from 'zod';
import {
  AI_SCOPES,
  APPEARANCE_MODES,
  EXPERIMENT_STATUSES,
  INBOX_KINDS,
  LINK_KINDS,
  NOTE_BLOCK_TYPES,
  NOTE_TEMPLATES,
  OBJECT_TYPES,
  PALETTES,
  PRIORITIES,
  QUESTION_STATUSES,
  READING_STATUSES,
  REFERENCE_TYPES,
  PDF_METADATA_MODES,
  PDF_ANNOTATION_KINDS,
} from './constants';

const id = z.string().min(3).max(64);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z.string().min(10).max(40);
const nullableDate = z.union([isoDate, z.null()]).optional();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const idSchema = id;
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(30),
  offset: z.coerce.number().int().min(0).max(10_000).optional().default(0),
});

// ── Auth ────────────────────────────────────────────────────────────────
export const setupSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores'),
  password: z.string().min(10).max(400),
  displayName: z.string().trim().max(80).optional().default(''),
  timezone: z.string().min(1).max(80).optional().default('UTC'),
  starterProject: z.boolean().optional().default(true),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(400),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(400),
  newPassword: z.string().min(10).max(400),
});

// ── Projects ────────────────────────────────────────────────────────────
export const projectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4000).optional().default(''),
  color: z.enum(PALETTES).optional().default('lavender'),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  color: z.enum(PALETTES).optional(),
});

export const projectArchiveSchema = z.object({ archived: z.boolean() });

export const repositoryCreateSchema = z.object({
  url: z.string().trim().min(3).max(500),
  token: z.string().max(1000).optional().default(''),
});

export const repositoryUpdateSchema = z.object({
  token: z.string().max(1000).nullable(),
});

export const repositorySyncSchema = z.object({
  since: isoDateTime.optional(),
});

export const columnCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  isDone: z.boolean().optional().default(false),
  position: z.number().int().min(0).max(500).optional(),
});

export const columnUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  isDone: z.boolean().optional(),
  position: z.number().int().min(0).max(500).optional(),
});

// ── Objects, tags, links ────────────────────────────────────────────────
export const objectTypeSchema = z.enum(OBJECT_TYPES);

export const objectUpdateSchema = z.object({
  favorite: z.boolean().optional(),
  projectId: z.union([id, z.null()]).optional(),
});

export const linkCreateSchema = z.object({
  targetId: id,
  kind: z.enum(LINK_KINDS).optional().default('relates'),
  anchor: z.string().max(500).optional(),
});

export const tagsReplaceSchema = z.object({
  tagIds: z.array(id).max(30),
});

export const tagCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[^#,\s].*$/, 'Tag cannot start with # or contain commas')
    .refine((v) => !v.includes(','), 'Tag cannot contain commas'),
  color: z.enum(PALETTES).optional().default('lavender'),
});

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: z.enum(PALETTES).optional(),
});

export const objectListQuerySchema = paginationSchema.extend({
  type: objectTypeSchema.optional(),
  projectId: z.union([id, z.literal('global')]).optional(),
  tag: z.string().max(40).optional(),
  favorite: z.coerce.boolean().optional(),
  status: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
});

// ── Notes ───────────────────────────────────────────────────────────────
export const blockSchema = z.object({
  id: z.string().min(3).max(64).optional(),
  type: z.enum(NOTE_BLOCK_TYPES),
  text: z.string().max(100_000).default(''),
  meta: z
    .object({
      checked: z.boolean().optional(),
      language: z.string().max(30).optional(),
      tone: z.enum(['info', 'success', 'warn']).optional(),
      refId: id.optional(),
      taskId: id.optional(),
    })
    .optional(),
});

export const noteCreateSchema = z.object({
  title: z.string().trim().max(300).optional().default(''),
  template: z.enum(NOTE_TEMPLATES).optional().default('research'),
  projectId: z.union([id, z.null()]).optional().default(null),
  blocks: z.array(blockSchema).max(2000).optional(),
  pinned: z.boolean().optional().default(false),
});

export const noteUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  blocks: z.array(blockSchema).max(2000).optional(),
  pinned: z.boolean().optional(),
  expectedVersion: z.number().int().min(0).optional(),
  force: z.boolean().optional().default(false),
});

export const noteListQuerySchema = paginationSchema.extend({
  projectId: id.optional(),
  template: z.enum(NOTE_TEMPLATES).optional(),
  pinned: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});

// ── Tasks ───────────────────────────────────────────────────────────────
const checklistItemSchema = z.object({
  id: z.string().min(3).max(64),
  text: z.string().max(500),
  done: z.boolean(),
});

const metricSchema = z.object({
  name: z.string().trim().min(1).max(80),
  value: z.number(),
  unit: z.string().max(20).optional(),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).optional().default(''),
  projectId: id,
  columnId: id.optional(),
  priority: z.enum(PRIORITIES).optional().default('normal'),
  dueDate: nullableDate,
  startDate: nullableDate,
  checklist: z.array(checklistItemSchema).max(100).optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  metrics: z.array(metricSchema).max(50).optional(),
});

export const taskUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  projectId: id.optional(),
  columnId: id.optional(),
  priority: z.enum(PRIORITIES).optional(),
  dueDate: nullableDate,
  startDate: nullableDate,
  checklist: z.array(checklistItemSchema).max(100).optional(),
  estimateMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  metrics: z.array(metricSchema).max(50).optional(),
});

export const taskMoveSchema = z.object({
  columnId: id,
  position: z.number().int().min(0).max(10_000),
});

export const taskCompleteSchema = z.object({ done: z.boolean() });

export const taskListQuerySchema = paginationSchema.extend({
  projectId: id.optional(),
  columnId: id.optional(),
  priority: z.enum(PRIORITIES).optional(),
  due: z.enum(['overdue', 'today', 'week']).optional(),
  q: z.string().max(200).optional(),
});

// ── Literature ──────────────────────────────────────────────────────────
export const referenceCreateSchema = z.object({
  title: z.string().trim().min(1).max(500),
  type: z.enum(REFERENCE_TYPES).optional().default('article'),
  authors: z.array(z.string().trim().max(200)).max(100).optional().default([]),
  year: z.number().int().min(1000).max(2200).nullable().optional(),
  venue: z.string().max(300).optional().default(''),
  doi: z.string().max(300).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  abstract: z.string().max(50_000).optional().default(''),
  publishedAt: z.union([isoDate, z.null()]).optional(),
  readingStatus: z.enum(READING_STATUSES).optional().default('unread'),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  notes: z.string().max(20_000).optional().default(''),
  citeKey: z.string().trim().max(120).optional(),
  projectId: z.union([id, z.null()]).optional().default(null),
  extra: z.record(z.string(), z.unknown()).optional().default({}),
});

export const referenceUpdateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  type: z.enum(REFERENCE_TYPES).optional(),
  authors: z.array(z.string().trim().max(200)).max(100).optional(),
  year: z.number().int().min(1000).max(2200).nullable().optional(),
  venue: z.string().max(300).optional(),
  doi: z.string().max(300).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  abstract: z.string().max(50_000).optional(),
  publishedAt: z.union([isoDate, z.null()]).optional(),
  readingStatus: z.enum(READING_STATUSES).optional(),
  rating: z.number().int().min(0).max(5).nullable().optional(),
  notes: z.string().max(20_000).optional(),
  citeKey: z.string().trim().max(120).optional(),
  projectId: z.union([id, z.null()]).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const pdfMetadataModeSchema = z.enum(PDF_METADATA_MODES);

export const urlIngestSchema = z.object({
  url: z.string().url().max(2048),
  projectId: z.union([id, z.null()]).optional().default(null),
  pdfMode: pdfMetadataModeSchema.optional(),
});

export const urlsIngestSchema = z.object({
  urls: z.array(z.string().url().max(2048)).min(1).max(10),
  projectId: z.union([id, z.null()]).optional().default(null),
  pdfMode: pdfMetadataModeSchema.optional(),
});

export const reextractMetadataSchema = z.object({
  source: z.enum(['pdf', 'url', 'fields']).optional(),
  mode: pdfMetadataModeSchema.optional(),
  apply: z.boolean().optional().default(false),
});

export const bulkReextractMetadataSchema = z.object({
  items: z
    .array(
      z.object({
        id,
        mode: pdfMetadataModeSchema.optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const summarizeReferenceSchema = z.object({
  mode: pdfMetadataModeSchema.optional(),
  instructions: z.string().max(4000).optional().default(''),
});

export const bookmarkCreateSchema = z.object({
  page: z.number().int().min(1).max(50_000),
  note: z.string().max(250).optional().default(''),
});

export const bookmarkUpdateSchema = z.object({
  page: z.number().int().min(1).max(50_000).optional(),
  note: z.string().max(250).optional(),
});

const normalizedCoord = z.number().finite().min(-0.05).max(1.05);
const pdfPointSchema = z.object({ x: normalizedCoord, y: normalizedCoord });
const pdfRectSchema = z.object({
  x: normalizedCoord,
  y: normalizedCoord,
  width: z.number().finite().min(0).max(1.1),
  height: z.number().finite().min(0).max(1.1),
});
const pdfGeometrySchema = z.object({
  rect: pdfRectSchema.optional(),
  rects: z.array(pdfRectSchema).max(200).optional(),
  points: z.array(pdfPointSchema).max(4000).optional(),
});

export const pdfAnnotationCreateSchema = z.object({
  page: z.number().int().min(1).max(50_000),
  kind: z.enum(PDF_ANNOTATION_KINDS),
  color: hexColor.optional().default('#f2c94c'),
  geometry: pdfGeometrySchema,
  text: z.string().max(2000).optional().default(''),
});

export const pdfAnnotationUpdateSchema = z.object({
  color: hexColor.optional(),
  geometry: pdfGeometrySchema.optional(),
  text: z.string().max(2000).optional(),
});

export const bibtexImportSchema = z.object({
  bibtex: z.string().min(1).max(2_000_000),
  projectId: z.union([id, z.null()]).optional().default(null),
});

export const referenceListQuerySchema = paginationSchema.extend({
  projectId: id.optional(),
  q: z.string().max(200).optional(),
  readingStatus: z.enum(READING_STATUSES).optional(),
  year: z.coerce.number().int().min(1000).max(2200).optional(),
  tag: z.string().max(40).optional(),
});

// ── Experiments ─────────────────────────────────────────────────────────
export const experimentCreateSchema = z.object({
  title: z.string().trim().min(1).max(300),
  projectId: z.union([id, z.null()]).optional().default(null),
  objective: z.string().max(20_000).optional().default(''),
  hypothesis: z.string().max(20_000).optional().default(''),
  method: z.string().max(50_000).optional().default(''),
  environment: z.record(z.string(), z.string().max(1000)).optional().default({}),
  results: z.string().max(100_000).optional().default(''),
  metrics: z.array(metricSchema).max(100).optional().default([]),
  status: z.enum(EXPERIMENT_STATUSES).optional().default('planned'),
  startedAt: nullableDate,
  endedAt: nullableDate,
});

export const experimentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  projectId: z.union([id, z.null()]).optional(),
  objective: z.string().max(20_000).optional(),
  hypothesis: z.string().max(20_000).optional(),
  method: z.string().max(50_000).optional(),
  environment: z.record(z.string(), z.string().max(1000)).optional(),
  results: z.string().max(100_000).optional(),
  metrics: z.array(metricSchema).max(100).optional(),
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  startedAt: nullableDate,
  endedAt: nullableDate,
});

// ── Questions ───────────────────────────────────────────────────────────
export const questionCreateSchema = z.object({
  question: z.string().trim().min(1).max(500),
  projectId: z.union([id, z.null()]).optional().default(null),
  context: z.string().max(20_000).optional().default(''),
  status: z.enum(QUESTION_STATUSES).optional().default('open'),
});

export const questionUpdateSchema = z.object({
  question: z.string().trim().min(1).max(500).optional(),
  projectId: z.union([id, z.null()]).optional(),
  context: z.string().max(20_000).optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
});

export const questionAnswerSchema = z.object({
  noteId: id.optional(),
  text: z.string().max(100_000).optional(),
});

// ── Inbox ───────────────────────────────────────────────────────────────
export const inboxCreateSchema = z.object({
  body: z.string().trim().min(1).max(20_000),
  kind: z.enum(INBOX_KINDS).optional().default('idea'),
  projectId: z.union([id, z.null()]).optional().default(null),
});

export const inboxConvertSchema = z.object({
  to: z.enum(['note', 'task', 'reference', 'experiment', 'question']),
  projectId: z.union([id, z.null()]).optional(),
  title: z.string().trim().max(300).optional(),
  overrides: z.record(z.string(), z.unknown()).optional().default({}),
});

// ── AI ──────────────────────────────────────────────────────────────────
export const aiProviderCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['openai', 'fake']).optional().default('openai'),
  baseUrl: z.string().url().max(2048).optional().default('https://api.openai.com/v1'),
  apiKey: z.string().max(500).optional().default(''),
  chatModel: z.string().trim().max(120).optional().default(''),
  embedModel: z.string().trim().max(120).optional().default(''),
  rerankModel: z.string().trim().max(120).optional().default(''),
  isDefault: z.boolean().optional().default(false),
  extra: z.record(z.string(), z.unknown()).optional().default({}),
});

export const aiProviderUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(['openai', 'fake']).optional(),
  baseUrl: z.string().url().max(2048).optional(),
  apiKey: z.string().max(500).optional(),
  chatModel: z.string().trim().max(120).optional(),
  embedModel: z.string().trim().max(120).optional(),
  rerankModel: z.string().trim().max(120).optional(),
  isDefault: z.boolean().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const conversationCreateSchema = z.object({
  scope: z.enum(AI_SCOPES).optional().default('global'),
  projectId: z.union([id, z.null()]).optional().default(null),
  contextObjectIds: z.array(id).max(50).optional().default([]),
  title: z.string().trim().max(200).optional(),
});

export const conversationUpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  scope: z.enum(AI_SCOPES).optional(),
  projectId: z.union([id, z.null()]).optional(),
  contextObjectIds: z.array(id).max(50).optional(),
});

export const chatSendSchema = z.object({
  content: z.string().trim().min(1).max(20_000),
  contextObjectIds: z.array(id).max(50).optional(),
});

export const aiActionSchema = z.object({
  action: z.enum(['summarize', 'compare', 'related']),
  objectIds: z.array(id).min(1).max(20),
  projectId: z.union([id, z.null()]).optional(),
  instruction: z.string().max(2000).optional(),
});

export const messageToNoteSchema = z.object({
  projectId: z.union([id, z.null()]).optional().default(null),
  title: z.string().trim().max(300).optional(),
});

export const messageExtractTasksSchema = z.object({
  projectId: id,
  titles: z.array(z.string().trim().min(1).max(300)).min(1).max(30).optional(),
});

// ── Settings ────────────────────────────────────────────────────────────
export const appearanceUpdateSchema = z.object({
  mode: z.enum(APPEARANCE_MODES).optional(),
  palette: z.enum(PALETTES).optional(),
  accent: z.union([hexColor, z.literal('')]).optional(),
  density: z.enum(['comfortable', 'compact']).optional(),
});

export const appSettingsUpdateSchema = z.object({
  instanceName: z.string().trim().min(1).max(80).optional(),
  backupRetention: z.number().int().min(1).max(365).optional(),
  digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  maxUploadMb: z.number().int().min(1).max(500).optional(),
  aiDailyTokenBudget: z.number().int().min(0).max(10_000_000).optional(),
  pdfMetadataMode: z.enum(PDF_METADATA_MODES).optional(),
});

export const userSettingsUpdateSchema = z.object({
  digestEnabled: z.boolean().optional(),
  timezone: z.string().min(1).max(80).optional(),
});

// ── Backups / trash / jobs ──────────────────────────────────────────────
export const backupCreateSchema = z.object({ kind: z.enum(['manual']).optional().default('manual') });
export const backupRestoreFieldsSchema = z.object({ confirm: z.literal('RESTORE') });
export const journalGenerateSchema = z.object({ force: z.boolean().optional().default(false) });
export const digestDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const activityQuerySchema = z.object({
  projectId: id.optional(),
  objectId: id.optional(),
  type: z.string().max(40).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  before: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const searchQuerySchema = z.object({
  q: z.string().max(512).optional().default(''),
  type: objectTypeSchema.optional(),
  projectId: z.union([id, z.literal('global')]).optional(),
  tag: z.string().max(40).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  mode: z.enum(['text', 'semantic', 'hybrid']).optional().default('text'),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
});

export type SetupInput = z.infer<typeof setupSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;
export type NoteCreateInput = z.infer<typeof noteCreateSchema>;
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;
export type ReferenceCreateInput = z.infer<typeof referenceCreateSchema>;
export type ExperimentCreateInput = z.infer<typeof experimentCreateSchema>;
export type QuestionCreateInput = z.infer<typeof questionCreateSchema>;
export type AiProviderCreateInput = z.infer<typeof aiProviderCreateSchema>;
export type AppearanceInput = z.infer<typeof appearanceUpdateSchema>;
