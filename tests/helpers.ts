import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { closeContext, createContext, type Ctx } from '../src/server/ctx';
import { createWorker } from '../src/server/worker/handlers';
import type { Worker } from '../src/server/worker/worker';

export const TEST_PASSWORD = 'test-password-123';

export interface TestHarness {
  dir: string;
  ctx: Ctx;
  app: FastifyInstance;
  worker: Worker;
  userId: string;
  projectId: string;
  request: (
    method: string,
    url: string,
    payload?: unknown,
  ) => Promise<{ status: number; body: any; text: string; headers: Record<string, unknown> }>;
  login: () => Promise<void>;
  cookieHeader: () => string;
  csrfToken: () => string;
  drain: () => Promise<number>;
  cleanup: () => Promise<void>;
}

export async function createTestHarness(
  options: { username?: string; env?: string; trustProxy?: boolean; allowedOrigins?: string[] } = {},
): Promise<TestHarness> {
  const dir = mkdtempSync(path.join(tmpdir(), 'loom-test-'));
  const config = loadConfig({
    dataDir: dir,
    secret: 'test-secret-for-loom',
    env: options.env ?? 'test',
    logLevel: 'silent',
    workerEnabled: false,
    devWebUrl: null,
    maxUploadMb: 10,
    ...(options.trustProxy !== undefined ? { trustProxy: options.trustProxy } : {}),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
  });
  const logger = pino({ level: 'silent' });
  const ctx = await createContext({ config, logger });
  const app = await buildApp(ctx);
  await app.ready();
  const worker = createWorker(ctx);
  const username = options.username ?? 'tester';

  let cookies = '';
  let csrf = '';

  const request: TestHarness['request'] = async (method, rawUrl, payload) => {
    const url = rawUrl.startsWith('/api/') ? rawUrl : `/api/v1${rawUrl}`;
    const headers: Record<string, string> = {};
    if (cookies) headers.cookie = cookies;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['x-csrf-token'] = csrf;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const response = await app.inject({
      method: method as 'GET',
      url,
      headers,
      ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    });
    const contentType = String(response.headers['content-type'] ?? '');
    const text = response.body;
    let body: unknown = text;
    if (contentType.includes('application/json')) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: response.statusCode, body, text, headers: response.headers as Record<string, unknown> };
  };

  const setup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: {
      username,
      password: TEST_PASSWORD,
      displayName: 'Test Researcher',
      timezone: 'UTC',
      starterProject: true,
    },
  });
  if (setup.statusCode !== 201) throw new Error(`Setup failed: ${setup.statusCode} ${setup.body}`);
  const setupBody = setup.json() as { user: { id: string }; csrfToken: string };
  const sessionCookie = setup.cookies.find((cookie) => cookie.name === 'loom_session');
  const csrfCookie = setup.cookies.find((cookie) => cookie.name === 'loom_csrf');
  if (!sessionCookie || !csrfCookie) throw new Error('Setup did not set cookies');
  cookies = `loom_session=${sessionCookie.value}; loom_csrf=${csrfCookie.value}`;
  csrf = setupBody.csrfToken;

  const projects = await request('GET', '/projects');
  const projectId = (projects.body as { projects: { id: string }[] }).projects[0]!.id;

  const login = async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: TEST_PASSWORD },
    });
    const body = response.json() as { csrfToken: string };
    const session = response.cookies.find((cookie) => cookie.name === 'loom_session');
    const csrfCookieValue = response.cookies.find((cookie) => cookie.name === 'loom_csrf');
    cookies = `loom_session=${session!.value}; loom_csrf=${csrfCookieValue!.value}`;
    csrf = body.csrfToken;
  };

  return {
    dir,
    ctx,
    app,
    worker,
    userId: setupBody.user.id,
    projectId,
    request,
    login,
    cookieHeader: () => cookies,
    csrfToken: () => csrf,
    drain: () => worker.drain(),
    cleanup: async () => {
      await app.close();
      closeContext(ctx);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
