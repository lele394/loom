import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import { badRequest } from '../../core/errors';
import { parseJson } from '../../core/text';
import type { Appearance } from '../../../shared/types';
import type { AppConfig } from '../../config';
import type { PdfMetadataMode } from '../../../shared/constants';
import { decryptSecret, encryptSecret, maskSecret } from '../../core/crypto';
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
    return this.db.prepare('SELECT * FROM ai_providers ORDER BY is_default DESC, created_at ASC').all() as ProviderRow[];
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
      isDefault: row.is_default === 1,
      extra: parseJson<Record<string, unknown>>(row.extra_json, {}),
    };
  }

  listProviders() {
    return this.providerRows().map((row) => this.toPublic(row));
  }

  getProviderConfig(id?: string): ProviderConfig | null {
    const row = id
      ? (this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderRow | undefined)
      : this.providerRows()[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      baseUrl: row.base_url,
      apiKey: decryptSecret(row.api_key_enc, this.config.masterKey),
      chatModel: row.chat_model,
      embedModel: row.embed_model,
      rerankModel: row.rerank_model,
      isDefault: row.is_default === 1,
      extra: parseJson<Record<string, unknown>>(row.extra_json, {}),
    };
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
    extra?: Record<string, unknown>;
  }) {
    const id = newId('aip');
    const now = this.clock.iso();
    const isFirst = this.providerRows().length === 0;
    const shouldDefault = input.isDefault || isFirst;
    const tx = this.db.transaction(() => {
      if (shouldDefault) this.db.prepare('UPDATE ai_providers SET is_default = 0').run();
      this.db
        .prepare(
          `INSERT INTO ai_providers (id, name, kind, base_url, api_key_enc, chat_model, embed_model, rerank_model, is_default, extra_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          shouldDefault ? 1 : 0,
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
      extra?: Record<string, unknown>;
    },
  ): boolean {
    const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderRow | undefined;
    if (!row) return false;
    const tx = this.db.transaction(() => {
      if (input.isDefault) this.db.prepare('UPDATE ai_providers SET is_default = 0').run();
      const apiKeyEnc =
        input.apiKey === undefined || input.apiKey === ''
          ? row.api_key_enc
          : encryptSecret(input.apiKey, this.config.masterKey);
      this.db
        .prepare(
          `UPDATE ai_providers SET name = ?, kind = ?, base_url = ?, api_key_enc = ?, chat_model = ?,
             embed_model = ?, rerank_model = ?, is_default = ?, extra_json = ?, updated_at = ?
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
          input.isDefault === undefined ? row.is_default : input.isDefault ? 1 : 0,
          JSON.stringify(input.extra ?? parseJson(row.extra_json, {})),
          this.clock.iso(),
          id,
        );
      if (input.isDefault === false && row.is_default === 1) {
        const next = this.db
          .prepare('SELECT id FROM ai_providers WHERE id != ? ORDER BY created_at ASC LIMIT 1')
          .get(id) as { id: string } | undefined;
        if (next) this.db.prepare('UPDATE ai_providers SET is_default = 1 WHERE id = ?').run(next.id);
      }
    });
    tx();
    return true;
  }

  deleteProvider(id: string): boolean {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare('SELECT is_default FROM ai_providers WHERE id = ?').get(id) as
        | { is_default: number }
        | undefined;
      if (!row) return false;
      this.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
      if (row.is_default === 1) {
        const next = this.db
          .prepare('SELECT id FROM ai_providers ORDER BY created_at ASC LIMIT 1')
          .get() as { id: string } | undefined;
        if (next) this.db.prepare('UPDATE ai_providers SET is_default = 1 WHERE id = ?').run(next.id);
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
