export const APP_NAME = 'Loom';
export const APP_VERSION = '0.1.0';
export const API_PREFIX = '/api/v1';

export const OBJECT_TYPES = ['note', 'task', 'reference', 'experiment', 'question'] as const;
export type ObjectType = (typeof OBJECT_TYPES)[number];

export const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  note: 'Note',
  task: 'Task',
  reference: 'Reference',
  experiment: 'Experiment',
  question: 'Question',
};

export const NOTE_BLOCK_TYPES = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'bullet',
  'numbered',
  'todo',
  'quote',
  'code',
  'callout',
  'divider',
  'equation',
  'reference',
  'task',
] as const;
export type NoteBlockType = (typeof NOTE_BLOCK_TYPES)[number];

export const NOTE_TEMPLATES = [
  'research',
  'literature',
  'experiment',
  'meeting',
  'daily',
  'technical',
  'blank',
] as const;
export type NoteTemplate = (typeof NOTE_TEMPLATES)[number];

export const PALETTES = ['lavender', 'sakura', 'sage', 'ocean', 'midnight', 'graphite'] as const;
export type Palette = (typeof PALETTES)[number];
export const APPEARANCE_MODES = ['light', 'dark', 'system'] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const READING_STATUSES = ['unread', 'reading', 'reviewed', 'archived'] as const;
export const PDF_METADATA_MODES = ['text', 'images', 'ocr'] as const;
export type PdfMetadataMode = (typeof PDF_METADATA_MODES)[number];

export const PDF_ANNOTATION_KINDS = ['highlight', 'ink', 'note'] as const;
export type PdfAnnotationKind = (typeof PDF_ANNOTATION_KINDS)[number];

export const PDF_HIGHLIGHT_COLORS = ['#f2c94c', '#7cc7a0', '#7fb8e6', '#e89ab5'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

export const REFERENCE_TYPES = [
  'article',
  'inproceedings',
  'book',
  'website',
  'report',
  'thesis',
  'preprint',
  'other',
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

export const CALENDAR_ITEM_TYPES = ['deadline', 'meeting', 'event', 'milestone', 'focus'] as const;
export type CalendarItemType = (typeof CALENDAR_ITEM_TYPES)[number];

export const EXPERIMENT_STATUSES = ['planned', 'running', 'completed', 'abandoned'] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const QUESTION_STATUSES = ['open', 'investigating', 'answered', 'parked'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const INBOX_KINDS = ['idea', 'note', 'task', 'reference', 'experiment', 'question'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

export const LINK_KINDS = [
  'relates',
  'mentions',
  'cites',
  'motivates',
  'answers',
  'derived_from',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  relates: 'Related to',
  mentions: 'Mentions',
  cites: 'Cites',
  motivates: 'Motivates',
  answers: 'Answers',
  derived_from: 'Derived from',
};

export const AI_SCOPES = ['global', 'project', 'selection'] as const;
export type AiScope = (typeof AI_SCOPES)[number];

export const LIMITS = {
  title: 300,
  tagName: 40,
  tagsPerObject: 30,
  blocksPerNote: 2000,
  blockChars: 100_000,
  noteDocBytes: 4 * 1024 * 1024,
  citationChars: 500,
  chatChars: 20_000,
  maxUploadMb: 50,
  maxUploadBytes: 50 * 1024 * 1024,
  passwordMin: 10,
} as const;

export const DIGEST_SECTIONS = ['Focus', 'Progress', 'Open threads', 'Next steps'] as const;
