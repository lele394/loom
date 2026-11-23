import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { deriveMasterKey, keyFingerprint } from './core/crypto';

const packageVersion = (JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string }).version;

export interface AppConfig {
  env: string;
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  attachmentsDir: string;
  tmpDir: string;
  backupDir: string;
  masterKey: Buffer;
  keyFingerprint: string;
  secureCookies: boolean;
  trustProxy: boolean;
  allowedOrigins: string[];
  maxUploadBytes: number;
  maxStorageBytes: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  workerEnabled: boolean;
  devWebUrl: string | null;
  githubApiBase: string;
  appVersion: string;
}

export interface ConfigOverrides {
  env?: string;
  port?: number;
  host?: string;
  dataDir?: string;
  dbPath?: string;
  backupDir?: string;
  secret?: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
  allowedOrigins?: string[];
  maxUploadMb?: number;
  maxStorageGb?: number;
  logLevel?: string;
  workerEnabled?: boolean;
  devWebUrl?: string | null;
  githubApiBase?: string;
}

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o750 });
}

function resolveMasterKey(dataDir: string, secret: string | undefined): Buffer {
  if (secret && secret.trim().length > 0) {
    return deriveMasterKey(secret.trim());
  }
  const keyFile = path.join(dataDir, 'master.key');
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, 'utf8').trim();
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
  }
  const created = randomBytes(32);
  writeFileSync(keyFile, created.toString('base64'), { mode: 0o600, flag: 'wx' });
  return created;
}

export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  const env = overrides.env ?? process.env.NODE_ENV ?? 'development';
  const dataDir = path.resolve(overrides.dataDir ?? process.env.LOOM_DATA_DIR ?? './data');
  const dbPath = path.resolve(overrides.dbPath ?? process.env.LOOM_DB_PATH ?? path.join(dataDir, 'loom.db'));
  const attachmentsDir = path.join(dataDir, 'attachments');
  const tmpDir = path.join(dataDir, 'tmp');
  const backupDir = path.resolve(
    overrides.backupDir ?? process.env.LOOM_BACKUP_DIR ?? path.join(dataDir, 'backups'),
  );

  ensureDir(dataDir);
  ensureDir(attachmentsDir);
  ensureDir(tmpDir);
  ensureDir(backupDir);

  const devWebUrl =
    overrides.devWebUrl !== undefined
      ? overrides.devWebUrl
      : process.env.LOOM_DEV_WEB_URL ?? (env === 'development' ? 'http://localhost:5173' : null);
  const extraOrigins = (process.env.LOOM_ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const devOrigins = devWebUrl
    ? [devWebUrl, devWebUrl.replace('//localhost', '//127.0.0.1')]
    : [];
  const allowedOrigins = overrides.allowedOrigins ?? [
    ...new Set([...devOrigins, ...extraOrigins]),
  ];

  const masterKey = resolveMasterKey(dataDir, overrides.secret ?? process.env.LOOM_SECRET);
  const maxUploadMb = overrides.maxUploadMb ?? envNumber(process.env.LOOM_MAX_UPLOAD_MB, 50);
  const maxStorageGb = overrides.maxStorageGb ?? envNumber(process.env.LOOM_MAX_STORAGE_GB, 10);
  const logLevel = (overrides.logLevel ?? process.env.LOOM_LOG_LEVEL ?? 'info') as AppConfig['logLevel'];

  return {
    env,
    port: overrides.port ?? envNumber(process.env.PORT, 8787),
    host: overrides.host ?? process.env.HOST ?? '127.0.0.1',
    dataDir,
    dbPath,
    attachmentsDir,
    tmpDir,
    backupDir,
    masterKey,
    keyFingerprint: keyFingerprint(masterKey),
    secureCookies: overrides.secureCookies ?? envBool(process.env.LOOM_SECURE_COOKIES, false),
    trustProxy: overrides.trustProxy ?? envBool(process.env.LOOM_TRUST_PROXY, false),
    allowedOrigins,
    maxUploadBytes: maxUploadMb * 1024 * 1024,
    maxStorageBytes: maxStorageGb * 1024 * 1024 * 1024,
    logLevel,
    workerEnabled: overrides.workerEnabled ?? envBool(process.env.LOOM_WORKER_ENABLED, true),
    devWebUrl,
    githubApiBase:
      overrides.githubApiBase ??
      process.env.LOOM_GITHUB_API_BASE ??
      'https://api.github.com',
    appVersion: packageVersion,
  };
}

/** Minimal .env loader (KEY=VALUE, # comments, optional quotes). */
export function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
