import type {
  AiScope,
  CalendarItemType,
  ExperimentStatus,
  InboxKind,
  LinkKind,
  NoteBlockType,
  NoteTemplate,
  ObjectType,
  Palette,
  PdfAnnotationKind,
  Priority,
  QuestionStatus,
  ReadingStatus,
  ReferenceType,
} from './constants';

export interface ApiErrorShape {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  timezone: string;
  isAdmin: boolean;
}

export interface SessionInfo {
  user: PublicUser | null;
  csrfToken: string | null;
  setupRequired: boolean;
}

export interface Capabilities {
  ai: boolean;
  chat: boolean;
  embeddings: boolean;
  semanticSearch: boolean;
  urlIngest: true;
  backup: true;
  version: string;
  limits: {
    maxUploadMb: number;
    maxUploadBytes: number;
    maxStorageGb: number;
  };
}

export interface Appearance {
  mode: 'light' | 'dark' | 'system';
  palette: Palette;
  accent: string;
  density: 'comfortable' | 'compact';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  color: Palette;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  counts?: ProjectCounts;
}

export interface ProjectCounts {
  notes: number;
  tasks: number;
  openTasks: number;
  references: number;
  experiments: number;
  questions: number;
}

export interface GithubCredentialStatus {
  hasToken: boolean;
  login: string | null;
  hint: string;
  tokenType: 'classic' | 'fine-grained' | 'unknown' | null;
  scopes: string[];
  updatedAt: string | null;
}

export interface ProjectRepository {
  id: string;
  projectId: string;
  provider: 'github';
  owner: string;
  name: string;
  fullName: string;
  url: string;
  hasToken: boolean;
  defaultBranch: string | null;
  isPrivate: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  commitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarItem {
  id: string;
  projectId: string;
  projectName: string;
  projectColor: Palette;
  title: string;
  type: CalendarItemType;
  description: string;
  startsAt: string;
  endsAt: string | null;
  subscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarSubscription {
  id: string;
  projectId: string;
  projectName: string;
  projectColor: Palette;
  name: string;
  url: string;
  itemCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryCommit {
  id: string;
  repositoryId: string;
  projectId: string;
  repositoryName: string;
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorLogin: string | null;
  authorEmail: string | null;
  committedAt: string;
  url: string;
  createdAt: string;
}

export interface BoardColumn {
  id: string;
  projectId: string;
  name: string;
  isDone: boolean;
  position: number;
  taskCount?: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  count?: number;
}

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  kind: LinkKind;
  anchor: string | null;
  createdAt: string;
}

export interface LinkWithObject extends Link {
  object: ObjectSummary;
}

export interface ObjectSummary {
  id: string;
  type: ObjectType;
  title: string;
  subtitle: string;
  projectId: string | null;
  status: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  objectId: string;
  kind: 'pdf' | 'image' | 'csv' | 'data' | 'other';
  filename: string;
  mime: string;
  size: number;
  pageCount: number | null;
  textStatus: 'none' | 'pending' | 'ready' | 'failed';
  textError: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface Block {
  id: string;
  type: NoteBlockType;
  text: string;
  meta?: {
    checked?: boolean;
    language?: string;
    tone?: 'info' | 'success' | 'warn';
    refId?: string;
    taskId?: string;
  };
}

export interface Note {
  id: string;
  title: string;
  blocks: Block[];
  template: NoteTemplate;
  pinned: boolean;
  plainText: string;
  wordCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  version: number;
  title: string;
  reason: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  columnId: string;
  priority: Priority;
  dueDate: string | null;
  startDate: string | null;
  completedAt: string | null;
  position: number;
  checklist: { id: string; text: string; done: boolean }[];
  estimateMinutes: number | null;
  metrics: { name: string; value: number; unit?: string }[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Reference {
  id: string;
  title: string;
  citeKey: string;
  type: ReferenceType;
  authors: string[];
  year: number | null;
  venue: string;
  doi: string | null;
  url: string | null;
  abstract: string;
  publishedAt: string | null;
  readingStatus: ReadingStatus;
  rating: number | null;
  notes: string;
  extra: Record<string, unknown>;
  aiSummary: string;
  aiSummaryModel: string | null;
  aiSummaryAt: string | null;
  aiSummaryInstructions: string;
  addedAt: string;
  projectId: string | null;
  version: number;
}

export interface ReferenceBookmark {
  id: string;
  referenceId: string;
  page: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PdfPoint {
  x: number;
  y: number;
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfAnnotationGeometry {
  rect?: PdfRect;
  rects?: PdfRect[];
  points?: PdfPoint[];
}

export interface PdfAnnotation {
  id: string;
  attachmentId: string;
  page: number;
  kind: PdfAnnotationKind;
  color: string;
  geometry: PdfAnnotationGeometry;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  id: string;
  title: string;
  projectId: string | null;
  objective: string;
  hypothesis: string;
  method: string;
  environment: Record<string, string>;
  results: string;
  metrics: { name: string; value: number; unit?: string }[];
  status: ExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
  version: number;
}

export interface Question {
  id: string;
  title: string;
  projectId: string | null;
  context: string;
  status: QuestionStatus;
  answerNoteId: string | null;
  answeredAt: string | null;
  version: number;
}

export interface InboxItem {
  id: string;
  body: string;
  kind: InboxKind;
  status: 'new' | 'triaged' | 'archived';
  projectId: string | null;
  triagedObjectId: string | null;
  createdAt: string;
  updatedAt: string;
  triagedAt: string | null;
}

export interface ActivityEvent {
  seq: number;
  id: string;
  actorId: string;
  projectId: string | null;
  objectId: string | null;
  objectType: string | null;
  objectTitle: string | null;
  action: string;
  summary: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  source: 'ui' | 'api' | 'job' | 'ai';
  occurredAt: string;
}

export interface DiffItem {
  type: string;
  id: string;
  title: string;
  fields?: string[];
}

export interface DiffCommit {
  repositoryId: string;
  repositoryName: string;
  sha: string;
  shortSha: string;
  title: string;
  authorName: string;
  committedAt: string;
  url: string;
}

export interface DiffProject {
  projectId: string | null;
  projectName: string;
  added: DiffItem[];
  updated: DiffItem[];
  completed: DiffItem[];
  removed: DiffItem[];
  commits?: DiffCommit[];
  eventCount: number;
}

export interface DailyDiff {
  date: string;
  timezone: string;
  totals: { added: number; updated: number; completed: number; removed: number };
  byProject: DiffProject[];
  eventCount: number;
  commitCount?: number;
  eventSeqRange: [number, number] | null;
}

export interface Digest {
  id: string;
  date: string;
  timezone: string;
  diff: DailyDiff;
  summaryMarkdown: string | null;
  model: string | null;
  status: 'pending' | 'ready' | 'failed';
  generatedAt: string | null;
  regeneratedCount: number;
  sourceEventSeq: number | null;
  stale: boolean;
}

export interface Citation {
  index: number;
  objectId: string;
  objectType: string;
  title: string;
  locator: Record<string, unknown>;
  excerpt: string;
  url?: string | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: Citation[];
  usage: { inputTokens?: number; outputTokens?: number; costUsd?: number } | null;
  provider: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  scope: AiScope;
  projectId: string | null;
  contextObjectIds: string[];
  providerId: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

export interface SearchResult {
  objectId: string;
  type: ObjectType;
  title: string;
  projectId: string | null;
  projectName: string | null;
  snippet: string;
  score: number;
  updatedAt: string;
  locator?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  mode: 'text' | 'semantic' | 'hybrid';
  engines: string[];
  tookMs: number;
  results: SearchResult[];
  total: number;
  semanticAvailable: boolean;
}

export interface AiProviderPublic {
  id: string;
  name: string;
  kind: 'openai' | 'fake';
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  chatModel: string;
  embedModel: string;
  rerankModel: string;
  isDefault: boolean;
  extra: Record<string, unknown>;
}

export interface AiStatus {
  configured: boolean;
  chat: boolean;
  embeddings: boolean;
  defaultProvider: AiProviderPublic | null;
  providers: AiProviderPublic[];
  embeddingCoverage: { chunks: number; embedded: number; model: string | null };
  reasons: string[];
}

export interface ObjectEnvelope {
  object: ObjectSummary;
  data: Record<string, unknown>;
  tags: Tag[];
  links: LinkWithObject[];
  backlinks: LinkWithObject[];
  attachments: Attachment[];
}

export interface DashboardData {
  greetingName: string;
  projects: Project[];
  dueTasks: Task[];
  openTaskCount: number;
  inboxCount: number;
  openQuestionCount: number;
  recentActivity: ActivityEvent[];
  yesterdayDigest: Digest | null;
  capabilities: { ai: boolean; semanticSearch: boolean };
}

export interface BackupRecord {
  id: string;
  filename: string;
  kind: string;
  size: number;
  checksum: string;
  status: 'ready' | 'failed' | 'missing';
  createdAt: string;
}

export interface JobRecord {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface TrashItem extends ObjectSummary {
  deletedAt: string;
}
