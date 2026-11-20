import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import { badRequest } from '../../core/errors';
import { parseJson } from '../../core/text';
import type { Appearance, GithubCredentialStatus } from '../../../shared/types';
import type { AppConfig } from '../../config';
import type { PdfMetadataMode } from '../../../shared/constants';
import { decryptSecret, deriveContextKey, encryptSecret, maskSecret } from '../../core/crypto';
import { inspectGitHubToken } from '../../core/github';
import { newId } from '../../core/ids';

export interface AppSettings {
  instanceName: string;
  backupRetention: number;
  digestTime: string;
  maxUploadMb: number;
  aiDailyTokenBudget: number;
  pdfMetadataMode: PdfMetadataMode;
}

export interface UserSettings {
  digestEnabled: boolean;
  timezone?: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  kind: 'openai' | 'fake';
  base_url: string;
  api_key_enc: string | null;
  chat_model: string;
  embed_model: string;
  rerank_model: string;
  is_default: number;
  is_chat_default: number;
  is_embedding_default: number;
  extra_json: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: 'openai' | 'fake';
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
  rerankModel: string;
  isDefault: boolean;
  isChatDefault?: boolean;
  isEmbeddingDefault?: boolean;
  extra: Record<string, unknown>;
}

const APP_DEFAULTS: AppSettings = {
  instanceName: 'Loom',
  backupRetention: 14,
  digestTime: '06:00',
  maxUploadMb: 50,
  aiDailyTokenBudget: 0,
  pdfMetadataMode: 'ocr',
};

const APPEARANCE_DEFAULTS: Appearance = {
  mode: 'system',
  palette: 'lavender',
  accent: '',
  density: 'comfortable',
  customPalette: null,
};

export class SettingsService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly config: AppConfig,
  ) {}

  getApp(): AppSettings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as {
      key: string;
      value_json: string;
    }[];
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = parseJson(row.value_json, null);
    return { ...APP_DEFAULTS, ...(stored as Partial<AppSettings>) };
  }

  updateApp(patch: Partial<AppSettings>): AppSettings {
    const now = this.clock.iso();
    const upsert = this.db.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    );
    const tx = this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) upsert.run(key, JSON.stringify(value), now);
      }
    });
    tx();
    return this.getApp();
  }

  getUserSettings(userId: string): UserSettings {
    const row = this.db
      .prepare('SELECT value_json FROM user_settings WHERE user_id = ? AND key = ?')
      .get(userId, 'preferences') as { value_json: string } | undefined;
    return { digestEnabled: true, ...parseJson<Partial<UserSettings>>(row?.value_json, {}) };
  }

  updateUserSettings(userId: string, patch: Partial<UserSettings>): UserSettings {
    const current = this.getUserSettings(userId);
    const next = { ...current, ...patch };
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, key, value_json, updated_at) VALUES (?, 'preferences', ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(next), this.clock.iso());
    return next;
  }

  private githubKey(userId: string): Buffer {
    return deriveContextKey(this.config.masterKey, `github-token:${userId}`);
  }

  getGithubCredential(userId: string): GithubCredentialStatus {
    const row = this.db
      .prepare('SELECT * FROM github_credentials WHERE user_id = ?')
      .get(userId) as
      | {
          token_hint: string;
          login: string | null;
          token_type: 'classic' | 'fine-grained' | 'unknown';
          scopes_json: string;
          updated_at: string;
        }
      | undefined;
    if (!row) {
      return {
        hasToken: false,
        login: null,
        hint: '',
        tokenType: null,
        scopes: [],
        updatedAt: null,
      };
    }
    return {
      hasToken: true,
      login: row.login,
      hint: row.token_hint,
      tokenType: row.token_type,
      scopes: parseJson<string[]>(row.scopes_json, []),
      updatedAt: row.updated_at,
    };
  }

  getGithubToken(userId: string): string {
    const row = this.db
      .prepare('SELECT token_enc FROM github_credentials WHERE user_id = ?')
      .get(userId) as { token_enc: string } | undefined;
    return row ? decryptSecret(row.token_enc, this.githubKey(userId)) : '';
  }

  async saveGithubToken(userId: string, token: string): Promise<GithubCredentialStatus> {
    const trimmed = token.trim();
    const info = await inspectGitHubToken(this.config.githubApiBase, trimmed);
    const now = this.clock.iso();
    const hint = trimmed.length > 4 ? `…${trimmed.slice(-4)}` : '…';
    this.db
      .prepare(
        `INSERT INTO github_credentials
           (user_id, token_enc, token_hint, login, token_type, scopes_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           token_enc = excluded.token_enc,
           token_hint = excluded.token_hint,
           login = excluded.login,
           token_type = excluded.token_type,
           scopes_json = excluded.scopes_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        userId,
        encryptSecret(trimmed, this.githubKey(userId)),
        hint,
        info.login,
        info.tokenType,
        JSON.stringify(info.scopes),
        now,
        now,
      );
    return this.getGithubCredential(userId);
  }

  clearGithubToken(userId: string): GithubCredentialStatus {
    this.db.prepare('DELETE FROM github_credentials WHERE user_id = ?').run(userId);
    return this.getGithubCredential(userId);
  }

  getAppearance(userId: string): Appearance {
    const row = this.db
      .prepare('SELECT value_json FROM user_settings WHERE user_id = ? AND key = ?')
      .get(userId, 'appearance') as { value_json: string } | undefined;
    return { ...APPEARANCE_DEFAULTS, ...parseJson<Partial<Appearance>>(row?.value_json, {}) };
  }

  updateAppearance(userId: string, patch: Partial<Appearance>): Appearance {
    const next = { ...this.getAppearance(userId), ...patch };
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, key, value_json, updated_at) VALUES (?, 'appearance', ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(next), this.clock.iso());
    return next;
  }

  // ── AI providers ────────────────────────────────────────────────────────
  private providerRows(): ProviderRow[] {
    return this.db
      .prepare(
        'SELECT * FROM ai_providers ORDER BY is_chat_default DESC, is_embedding_default DESC, created_at ASC',
      )
      .all() as ProviderRow[];
  }

  private toPublic(row: ProviderRow): {
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
    isChatDefault: boolean;
    isEmbeddingDefault: boolean;
    extra: Record<string, unknown>;
  } {
    const apiKey = decryptSecret(row.api_key_enc, this.config.masterKey);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.base_url,
      hasApiKey: apiKey.length > 0,
      apiKeyMasked: maskSecret(apiKey),
      chatModel: row.chat_model,
      embedModel: row.embed_model,
      rerankModel: row.rerank_model,
      isDefault: row.is_chat_default === 1,
      isChatDefault: row.is_chat_default === 1,
      isEmbeddingDefault: row.is_embedding_default === 1,
      extra: parseJson<Record<string, unknown>>(row.extra_json, {}),
    };
  }

  private toConfig(row: ProviderRow): ProviderConfig {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.base_url,
      apiKey: decryptSecret(row.api_key_enc, this.config.masterKey),
      chatModel: row.chat_model,
      embedModel: row.embed_model,
      rerankModel: row.rerank_model,
      isDefault: row.is_chat_default === 1,
      isChatDefault: row.is_chat_default === 1,
      isEmbeddingDefault: row.is_embedding_default === 1,
      extra: parseJson<Record<string, unknown>>(row.extra_json, {}),
    };
  }

  listProviders() {
    return this.providerRows().map((row) => this.toPublic(row));
  }

  getChatProviderConfig(): ProviderConfig | null {
    const row =
      (this.db
        .prepare('SELECT * FROM ai_providers WHERE is_chat_default = 1 ORDER BY created_at ASC LIMIT 1')
        .get() as ProviderRow | undefined) ??
      (this.db
        .prepare(
          "SELECT * FROM ai_providers WHERE chat_model <> '' OR kind = 'fake' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as ProviderRow | undefined) ??
      this.providerRows()[0];
    return row ? this.toConfig(row) : null;
  }

  getEmbeddingProviderConfig(): ProviderConfig | null {
    const row =
      (this.db
        .prepare(
          'SELECT * FROM ai_providers WHERE is_embedding_default = 1 ORDER BY created_at ASC LIMIT 1',
        )
        .get() as ProviderRow | undefined) ??
      (this.db
        .prepare(
          "SELECT * FROM ai_providers WHERE embed_model <> '' ORDER BY created_at ASC LIMIT 1",
        )
        .get() as ProviderRow | undefined);
    return row ? this.toConfig(row) : null;
  }

  getProviderConfig(id?: string): ProviderConfig | null {
    if (!id) return this.getChatProviderConfig();
    const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as
      | ProviderRow
      | undefined;
    return row ? this.toConfig(row) : null;
  }

  createProvider(input: {
    name: string;
    kind?: 'openai' | 'fake';
    baseUrl?: string;
    apiKey?: string;
    chatModel?: string;
    embedModel?: string;
    rerankModel?: string;
    isDefault?: boolean;
    isChatDefault?: boolean;
    isEmbeddingDefault?: boolean;
    extra?: Record<string, unknown>;
  }) {
    const id = newId('aip');
    const now = this.clock.iso();
    const isFirst = this.providerRows().length === 0;
    const legacyDefault = input.isDefault === true;
    const chatCapable = Boolean(input.chatModel) || input.kind === 'fake';
    const embeddingCapable = Boolean(input.embedModel);
    const chatDefault =
      input.isChatDefault ?? ((legacyDefault || isFirst) && chatCapable);
    const embeddingDefault =
      input.isEmbeddingDefault ?? ((legacyDefault || isFirst) && embeddingCapable);
    const tx = this.db.transaction(() => {
      if (chatDefault) this.db.prepare('UPDATE ai_providers SET is_chat_default = 0').run();
      if (embeddingDefault) this.db.prepare('UPDATE ai_providers SET is_embedding_default = 0').run();
      this.db
        .prepare(
          `INSERT INTO ai_providers
             (id, name, kind, base_url, api_key_enc, chat_model, embed_model, rerank_model,
              is_default, is_chat_default, is_embedding_default, extra_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.kind ?? 'openai',
          input.baseUrl ?? 'https://api.openai.com/v1',
          input.apiKey ? encryptSecret(input.apiKey, this.config.masterKey) : null,
          input.chatModel ?? '',
          input.embedModel ?? '',
          input.rerankModel ?? '',
          chatDefault ? 1 : 0,
          chatDefault ? 1 : 0,
          embeddingDefault ? 1 : 0,
          JSON.stringify(input.extra ?? {}),
          now,
          now,
        );
    });
    tx();
    return id;
  }

  updateProvider(
    id: string,
    input: {
      name?: string;
      kind?: 'openai' | 'fake';
      baseUrl?: string;
      apiKey?: string;
      chatModel?: string;
      embedModel?: string;
      rerankModel?: string;
      isDefault?: boolean;
      isChatDefault?: boolean;
      isEmbeddingDefault?: boolean;
      extra?: Record<string, unknown>;
    },
  ): boolean {
    const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderRow | undefined;
    if (!row) return false;
    const legacyDefault =
      input.isDefault === undefined ? undefined : input.isDefault;
    const chatDefault =
      input.isChatDefault ?? legacyDefault ?? (row.is_chat_default === 1);
    const embeddingDefault =
      input.isEmbeddingDefault ?? legacyDefault ?? (row.is_embedding_default === 1);
    const tx = this.db.transaction(() => {
      if (chatDefault) {
        this.db.prepare('UPDATE ai_providers SET is_chat_default = 0 WHERE id != ?').run(id);
      }
      if (embeddingDefault) {
        this.db.prepare('UPDATE ai_providers SET is_embedding_default = 0 WHERE id != ?').run(id);
      }
      const apiKeyEnc =
        input.apiKey === undefined || input.apiKey === ''
          ? row.api_key_enc
          : encryptSecret(input.apiKey, this.config.masterKey);
      this.db
        .prepare(
          `UPDATE ai_providers SET name = ?, kind = ?, base_url = ?, api_key_enc = ?, chat_model = ?,
             embed_model = ?, rerank_model = ?, is_default = ?, is_chat_default = ?,
             is_embedding_default = ?, extra_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name ?? row.name,
          input.kind ?? row.kind,
          input.baseUrl ?? row.base_url,
          apiKeyEnc,
          input.chatModel ?? row.chat_model,
          input.embedModel ?? row.embed_model,
          input.rerankModel ?? row.rerank_model,
          chatDefault ? 1 : 0,
          chatDefault ? 1 : 0,
          embeddingDefault ? 1 : 0,
          JSON.stringify(input.extra ?? parseJson(row.extra_json, {})),
          this.clock.iso(),
          id,
        );
      if (!chatDefault && row.is_chat_default === 1) {
        const next = this.db
          .prepare(
            "SELECT id FROM ai_providers WHERE id != ? AND (chat_model <> '' OR kind = 'fake') ORDER BY created_at ASC LIMIT 1",
          )
          .get(id) as { id: string } | undefined;
        if (next) this.db.prepare('UPDATE ai_providers SET is_chat_default = 1 WHERE id = ?').run(next.id);
      }
      if (!embeddingDefault && row.is_embedding_default === 1) {
        const next = this.db
          .prepare(
            "SELECT id FROM ai_providers WHERE id != ? AND embed_model <> '' ORDER BY created_at ASC LIMIT 1",
          )
          .get(id) as { id: string } | undefined;
        if (next) {
          this.db.prepare('UPDATE ai_providers SET is_embedding_default = 1 WHERE id = ?').run(next.id);
        }
      }
    });
    tx();
    return true;
  }

  deleteProvider(id: string): boolean {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT is_chat_default, is_embedding_default FROM ai_providers WHERE id = ?').get(id) as
        | { is_chat_default: number; is_embedding_default: number }
        | undefined;
      if (!row) return false;
      this.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
      if (row.is_chat_default === 1) {
        const next = this.db
          .prepare(
            "SELECT id FROM ai_providers WHERE chat_model <> '' OR kind = 'fake' ORDER BY created_at ASC LIMIT 1",
          )
          .get() as { id: string } | undefined;
        if (next) this.db.prepare('UPDATE ai_providers SET is_chat_default = 1 WHERE id = ?').run(next.id);
      }
      if (row.is_embedding_default === 1) {
        const next = this.db
          .prepare(
            "SELECT id FROM ai_providers WHERE embed_model <> '' ORDER BY created_at ASC LIMIT 1",
          )
          .get() as { id: string } | undefined;
        if (next) {
          this.db.prepare('UPDATE ai_providers SET is_embedding_default = 1 WHERE id = ?').run(next.id);
        }
      }
      return true;
    });
    return tx();
  }

  assertUploadSize(bytes: number): void {
    if (bytes > this.config.maxUploadBytes) {
      throw badRequest('The upload exceeds the limit.');
    }
  }
}
