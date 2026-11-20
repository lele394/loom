import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { SettingsService } from '../settings/service';
import type { SearchService, RetrievedChunk } from '../search/service';
import type { NoteService } from '../notes/service';
import type { TaskService } from '../tasks/service';
import { AppError, ensureFound, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { parseJson, truncate } from '../../core/text';
import { typeDefinition } from '../../core/registry';
import { createProvider } from '../../ai';
import {
  ACTION_PROMPT_VERSION,
  CHAT_PROMPT_VERSION,
  buildActionMessages,
  buildChatSystemPrompt,
  buildExtractTasksMessages,
  buildSourcesBlock,
} from '../../ai/prompts';
import type { AiProvider } from '../../ai/types';
import type { AiScope } from '../../../shared/constants';
import type {
  AiStatus,
  ChatMessage,
  Citation,
  Conversation,
} from '../../../shared/types';
import { z } from 'zod';

export type ChatEvent =
  | { type: 'user'; messageId: string }
  | { type: 'meta'; assistantMessageId: string; model: string; sources: number; provider: string }
  | { type: 'delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'usage'; inputTokens: number; outputTokens: number; costUsd?: number }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string };

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  scope: AiScope;
  project_id: string | null;
  context_json: string;
  provider_id: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations_json: string;
  usage_json: string;
  provider: string | null;
  model: string | null;
  error: string | null;
  created_at: string;
}

function mapMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    citations: parseJson<Citation[]>(row.citations_json, []),
    usage: parseJson<ChatMessage['usage']>(row.usage_json, null),
    provider: row.provider,
    model: row.model,
    error: row.error,
    createdAt: row.created_at,
  };
}

const MAX_CONTEXT_CHARS = 24_000;
const MAX_SOURCE_CHARS = 4_500;

export class AiService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly search: SearchService,
    private readonly activity: ActivityService,
    private readonly notes: NoteService,
    private readonly tasks: TaskService,
  ) {}

  // ── Status and providers ───────────────────────────────────────────────
  status(): AiStatus {
    const providers = this.settings.listProviders();
    const chatConfig = this.settings.getChatProviderConfig();
    const embeddingConfig = this.settings.getEmbeddingProviderConfig();
    const coverage = this.search.embeddingCoverage();
    const reasons: string[] = [];
    if (!chatConfig) reasons.push('No chat provider is configured.');
    else if (!chatConfig.chatModel && chatConfig.kind !== 'fake') reasons.push('No chat model is set.');
    if (!embeddingConfig?.embedModel) {
      reasons.push('No embedding model is set; semantic search is unavailable.');
    }
    return {
      configured: Boolean(chatConfig || embeddingConfig),
      chat: Boolean(chatConfig && (chatConfig.chatModel || chatConfig.kind === 'fake')),
      embeddings: Boolean(embeddingConfig?.embedModel),
      defaultProvider:
        providers.find((provider) => provider.id === chatConfig?.id) ??
        providers.find((provider) => provider.isChatDefault) ??
        null,
      defaultEmbeddingProvider:
        providers.find((provider) => provider.id === embeddingConfig?.id) ?? null,
      providers,
      embeddingCoverage: coverage,
      reasons,
    };
  }

  private provider(providerId?: string | null): { provider: AiProvider; model: string; configId: string } {
    const config = this.settings.getProviderConfig(providerId ?? undefined);
    if (!config) throw new AppError('ai_unavailable', 'No AI provider is configured.');
    if (!config.chatModel && config.kind !== 'fake') {
      throw new AppError('ai_unavailable', 'The AI provider has no chat model configured.');
    }
    return { provider: createProvider(config), model: config.chatModel, configId: config.id };
  }

  async testProvider(id: string): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
    const config = this.settings.getProviderConfig(id);
    if (!config) throw notFound('Provider');
    const provider = createProvider(config);
    const health = await provider.health(AbortSignal.timeout(15_000));
    return {
      ok: health.ok,
      latencyMs: health.latencyMs,
      model: config.chatModel,
      ...(health.error ? { error: health.error } : {}),
    };
  }

  // ── Conversations ──────────────────────────────────────────────────────
  private convRow(id: string): ConversationRow {
    const row = this.db
      .prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL')
      .get(id) as ConversationRow | undefined;
    if (!row) throw notFound('Conversation');
    return row;
  }

  private mapConversation(row: ConversationRow, withMessages = false): Conversation {
    return {
      id: row.id,
      title: row.title,
      scope: row.scope,
      projectId: row.project_id,
      contextObjectIds: parseJson<string[]>(row.context_json, []),
      providerId: row.provider_id,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(withMessages ? { messages: this.messages(row.id) } : {}),
    };
  }

  createConversation(
    userId: string,
    input: { scope?: AiScope; projectId?: string | null; contextObjectIds?: string[]; title?: string },
  ): Conversation {
    const id = newId('cnv');
    const now = this.clock.iso();
    const title =
      input.title?.trim() ||
      (input.scope === 'project' ? 'Project conversation' : input.scope === 'selection' ? 'Selection discussion' : 'New conversation');
    this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, title, scope, project_id, context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        title,
        input.scope ?? 'global',
        input.projectId ?? null,
        JSON.stringify(input.contextObjectIds ?? []),
        now,
        now,
      );
    return this.mapConversation(this.convRow(id), true);
  }

  listConversations(userId: string, limit = 50): Conversation[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM conversations WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?',
      )
      .all(userId, limit) as ConversationRow[];
    return rows.map((row) => this.mapConversation(row));
  }

  getConversation(id: string): Conversation {
    return this.mapConversation(this.convRow(id), true);
  }

  updateConversation(
    id: string,
    input: { title?: string; scope?: AiScope; projectId?: string | null; contextObjectIds?: string[] },
  ): Conversation {
    const row = this.convRow(id);
    this.db
      .prepare(
        'UPDATE conversations SET title = ?, scope = ?, project_id = ?, context_json = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        input.title ?? row.title,
        input.scope ?? row.scope,
        input.projectId === undefined ? row.project_id : input.projectId,
        JSON.stringify(input.contextObjectIds ?? parseJson(row.context_json, [])),
        this.clock.iso(),
        id,
      );
    return this.mapConversation(this.convRow(id), true);
  }

  deleteConversation(id: string): void {
    this.convRow(id);
    this.db.prepare('UPDATE conversations SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
      this.clock.iso(),
      this.clock.iso(),
      id,
    );
  }

  messages(conversationId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC')
      .all(conversationId) as MessageRow[];
    return rows.map(mapMessage);
  }

  private message(id: string): ChatMessage {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
    if (!row) throw notFound('Message');
    return mapMessage(row);
  }

  private checkBudget(): void {
    const budget = this.settings.getApp().aiDailyTokenBudget;
    if (!budget) return;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(
           COALESCE(json_extract(usage_json, '$.inputTokens'), 0) +
           COALESCE(json_extract(usage_json, '$.outputTokens'), 0)
         ), 0) AS tokens FROM messages WHERE created_at >= ?`,
      )
      .get(start.toISOString()) as { tokens: number };
    if (row.tokens >= budget) {
      throw new AppError('budget_exceeded', 'The daily AI token budget has been exhausted.');
    }
  }

  // ── Chat ───────────────────────────────────────────────────────────────
  async *chat(
    conversationId: string,
    content: string,
    options: { contextObjectIds?: string[]; userId: string; signal?: AbortSignal },
  ): AsyncGenerator<ChatEvent> {
    const conversation = this.convRow(conversationId);
    this.checkBudget();
    const providerInfo = this.provider(conversation.provider_id);
    const contextObjectIds = options.contextObjectIds ?? parseJson<string[]>(conversation.context_json, []);
    const project = conversation.project_id
      ? (this.db.prepare('SELECT name FROM projects WHERE id = ?').get(conversation.project_id) as
          | { name: string }
          | undefined)
      : undefined;

    const history = this.db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 10',
      )
      .all(conversationId) as MessageRow[];
    history.reverse();

    const sources = await this.buildSources({
      query: content,
      scope: conversation.scope,
      projectId: conversation.project_id,
      contextObjectIds,
    });

    const userMessageId = newId('msg');
    const now = this.clock.iso();
    this.db
      .prepare(
        'INSERT INTO messages (id, conversation_id, role, content, citations_json, usage_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userMessageId, conversationId, 'user', content, '[]', '{}', now);
    this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .run(now, conversationId);
    if (conversation.title === 'New conversation' || conversation.title === 'Project conversation' || conversation.title === 'Selection discussion') {
      this.db
        .prepare('UPDATE conversations SET title = ? WHERE id = ?')
        .run(truncate(content.replace(/\s+/g, ' '), 60), conversationId);
    }

    const assistantMessageId = newId('msg');
    yield { type: 'user', messageId: userMessageId };
    yield {
      type: 'meta',
      assistantMessageId,
      model: providerInfo.model || 'fake',
      sources: sources.length,
      provider: providerInfo.provider.name,
    };

    const systemPrompt = buildChatSystemPrompt({
      date: this.clock.iso().slice(0, 10),
      projects: (
        this.db.prepare('SELECT name FROM projects WHERE deleted_at IS NULL ORDER BY name').all() as {
          name: string;
        }[]
      ).map((row) => row.name),
      hasSources: sources.length > 0,
      scope: conversation.scope,
    });
    const sourceBlock = buildSourcesBlock(
      sources.map((source, index) => ({
        index: index + 1,
        title: source.title,
        objectType: source.objectType,
        locator: source.locator,
        text: source.text,
      })),
    );
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: sourceBlock },
      ...history.slice(-10).map((row) => ({
        role: row.role,
        content: truncate(row.content, row.role === 'assistant' ? 2000 : 4000),
      })),
      { role: 'user' as const, content },
    ];

    let output = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let failed: AppError | null = null;
    const started = Date.now();
    const timeout = AbortSignal.timeout(180_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    try {
      for await (const chunk of providerInfo.provider.chat({
        model: providerInfo.model,
        messages,
        maxTokens: 1200,
        signal,
      })) {
        if (chunk.type === 'text') {
          output += chunk.text;
          yield { type: 'delta', text: chunk.text };
        } else if (chunk.type === 'usage') {
          inputTokens = chunk.inputTokens;
          outputTokens = chunk.outputTokens;
        }
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'provider_error';
      failed = new AppError(
        (code as AppError['code']) ?? 'provider_error',
        (error as Error).message || 'The AI provider failed.',
      );
    }

    if (failed) {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, content, citations_json, usage_json, provider, model, error, created_at)
           VALUES (?, ?, 'assistant', ?, '[]', '{}', ?, ?, ?, ?)`,
        )
        .run(
          assistantMessageId,
          conversationId,
          output,
          providerInfo.provider.name,
          providerInfo.model,
          `${failed.code}: ${failed.message}`.slice(0, 1000),
          this.clock.iso(),
        );
      yield { type: 'error', code: failed.code, message: failed.message };
      return;
    }

    const citations = mapCitations(output, sources);
    const usage = {
      inputTokens,
      outputTokens,
      grounded: citations.length > 0,
      promptVersion: CHAT_PROMPT_VERSION,
      latencyMs: Date.now() - started,
    };
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, citations_json, usage_json, provider, model, created_at)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assistantMessageId,
        conversationId,
        output,
        JSON.stringify(citations),
        JSON.stringify(usage),
        providerInfo.provider.name,
        providerInfo.model,
        this.clock.iso(),
      );
    this.db
      .prepare('UPDATE conversations SET updated_at = ?, provider_id = ?, model = ? WHERE id = ?')
      .run(this.clock.iso(), providerInfo.configId, providerInfo.model, conversationId);

    yield { type: 'citations', citations };
    yield { type: 'usage', inputTokens, outputTokens };
    yield { type: 'done', messageId: assistantMessageId };
  }

  private async buildSources(options: {
    query: string;
    scope: AiScope;
    projectId: string | null;
    contextObjectIds: string[];
  }): Promise<RetrievedChunk[]> {
    let sources: RetrievedChunk[];
    if (options.scope === 'selection' && options.contextObjectIds.length) {
      sources = this.search.chunksForObjects(options.contextObjectIds, 16);
    } else {
      sources = await this.search.retrieve({
        query: options.query,
        scope: options.scope,
        projectId: options.projectId,
        limit: 8,
      });
    }
    const seen = new Set<string>();
    const deduped: RetrievedChunk[] = [];
    let chars = 0;
    for (const source of sources) {
      if (seen.has(source.objectId)) continue;
      const text = truncate(source.text, MAX_SOURCE_CHARS);
      if (chars + text.length > MAX_CONTEXT_CHARS) break;
      chars += text.length;
      seen.add(source.objectId);
      deduped.push({ ...source, text });
    }
    return deduped;
  }

  // ── Actions ────────────────────────────────────────────────────────────
  async act(input: {
    action: 'summarize' | 'compare' | 'related';
    objectIds: string[];
    instruction?: string;
  }): Promise<{ text: string; citations: Citation[]; model: string }> {
    this.checkBudget();
    const providerInfo = this.provider();
    const chunks = this.search.chunksForObjects(input.objectIds, 20);
    const grouped = new Map<string, RetrievedChunk[]>();
    for (const chunk of chunks) {
      const list = grouped.get(chunk.objectId) ?? [];
      list.push(chunk);
      grouped.set(chunk.objectId, list);
    }
    const objects: {
      id: string;
      title: string;
      type: string;
      text: string;
      locator?: Record<string, unknown>;
    }[] = [];
    for (const objectId of input.objectIds) {
      const object = this.db
        .prepare('SELECT type, title FROM objects WHERE id = ? AND deleted_at IS NULL')
        .get(objectId) as { type: string; title: string } | undefined;
      if (!object) continue;
      const text = (grouped.get(objectId) ?? []).map((chunk) => chunk.text).join('\n\n');
      objects.push({
        id: objectId,
        title: object.title,
        type: object.type,
        text: text || this.fallbackText(objectId),
      });
    }
    if (!objects.length) throw notFound('Object');
    const prompt = buildActionMessages({ action: input.action, objects, instruction: input.instruction });
    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const chunk of providerInfo.provider.chat({
      model: providerInfo.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      maxTokens: 1500,
      signal: AbortSignal.timeout(180_000),
    })) {
      if (chunk.type === 'text') text += chunk.text;
      if (chunk.type === 'usage') {
        inputTokens = chunk.inputTokens;
        outputTokens = chunk.outputTokens;
      }
    }
    const citations: Citation[] = objects.map((object, index) => ({
      index: index + 1,
      objectId: object.id,
      objectType: object.type,
      title: object.title,
      locator: {},
      excerpt: truncate(object.text, 300),
    })).filter((citation) => text.includes(`[${citation.index}]`));
    this.activity.record({
      actorId: this.primaryUserId(),
      action: 'ai.action',
      summary: `AI ${input.action} over ${objects.length} object(s)`,
      source: 'ai',
    });
    return { text, citations, model: providerInfo.model || 'fake' };
  }

  private fallbackText(objectId: string): string {
    const object = this.db.prepare('SELECT type, title FROM objects WHERE id = ?').get(objectId) as
      | { type: string; title: string }
      | undefined;
    if (!object) return '';
    const def = typeDefinition(object.type);
    return def ? def.body(this.db, objectId).text || object.title : object.title;
  }

  private primaryUserId(): string {
    const row = this.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as {
      id: string;
    };
    return row.id;
  }

  messageToNote(
    messageId: string,
    input: { projectId?: string | null; title?: string },
    actorId: string,
  ): { noteId: string } {
    const message = this.message(messageId);
    if (message.role !== 'assistant') throw new AppError('bad_request', 'Only assistant messages can become notes.');
    const lines = message.content.split(/\r?\n/);
    const title =
      input.title?.trim() ||
      truncate(message.content.replace(/[#*_>`\[\]]/g, '').replace(/\s+/g, ' ').trim(), 80) ||
      'AI note';
    const blocks: { type: 'paragraph' | 'h2'; text: string }[] = [];
    for (const line of lines) {
      const heading = /^#{2,3}\s+(.*)$/.exec(line);
      if (heading) blocks.push({ type: 'h2', text: heading[1]! });
      else if (line.trim()) blocks.push({ type: 'paragraph', text: line.replace(/^[-*]\s+/, '• ') });
    }
    if (!blocks.length) blocks.push({ type: 'paragraph', text: message.content });
    const note = this.notes.create(
      {
        title,
        projectId: input.projectId ?? null,
        template: 'research',
        blocks,
      },
      actorId,
    );
    this.activity.record({
      actorId,
      projectId: input.projectId ?? null,
      objectId: note.id,
      objectType: 'note',
      objectTitle: title,
      action: 'note.created',
      summary: `Saved an AI answer as note "${title}"`,
      source: 'ai',
    });
    return { noteId: note.id };
  }

  async extractTasks(
    messageId: string,
    input: { projectId: string; titles?: string[] },
    actorId: string,
  ): Promise<{ created: string[]; drafts: { title: string; description: string; priority: string }[] }> {
    const message = this.message(messageId);
    let drafts: { title: string; description: string; priority: string }[] = [];
    if (input.titles?.length) {
      drafts = input.titles.map((title) => ({ title, description: '', priority: 'normal' }));
    } else {
      const providerInfo = this.provider();
      const prompt = buildExtractTasksMessages(message.content);
      let raw = '';
      for await (const chunk of providerInfo.provider.chat({
        model: providerInfo.model,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        maxTokens: 800,
        json: true,
        signal: AbortSignal.timeout(90_000),
      })) {
        if (chunk.type === 'text') raw += chunk.text;
      }
      const parsedJson = extractJson(raw);
      const schema = z.object({
        tasks: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(300),
              description: z.string().max(5000).optional().default(''),
              priority: z.enum(['low', 'normal', 'high', 'urgent']).optional().default('normal'),
            }),
          )
          .max(10),
      });
      const result = schema.safeParse(parsedJson);
      if (!result.success) {
        throw new AppError('provider_bad_response', 'The AI provider did not return valid tasks.');
      }
      drafts = result.data.tasks;
    }
    const created: string[] = [];
    for (const draft of drafts) {
      const task = this.tasks.create(
        {
          title: draft.title,
          description: draft.description,
          projectId: input.projectId,
          priority: draft.priority as 'low' | 'normal' | 'high' | 'urgent',
        },
        actorId,
      );
      created.push(task.id);
    }
    this.activity.record({
      actorId,
      projectId: input.projectId,
      action: 'task.extracted',
      summary: `Created ${created.length} task(s) from an AI conversation`,
      source: 'ai',
    });
    return { created, drafts };
  }

  getMessage(id: string): ChatMessage {
    return this.message(id);
  }
}

function mapCitations(text: string, sources: RetrievedChunk[]): Citation[] {
  const indices = new Set<number>();
  for (const match of text.matchAll(/\[(\d{1,3})\]/g)) {
    const index = Number(match[1]);
    if (index >= 1 && index <= sources.length) indices.add(index);
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((index) => {
      const source = sources[index - 1]!;
      return {
        index,
        objectId: source.objectId,
        objectType: source.objectType,
        title: source.title,
        locator: source.locator,
        excerpt: truncate(source.text, 400),
      };
    });
}

function extractJson(raw: string): unknown {
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

export { ACTION_PROMPT_VERSION };
