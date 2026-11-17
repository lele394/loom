import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHarness, type TestHarness } from './helpers';

let harness: TestHarness;
let server: ReturnType<typeof createServer> | null = null;
let authHeaders: string[] = [];

function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

const commits = [
  {
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    html_url: 'https://github.com/example/paper-code/commit/bbbbbbbb',
    author: { login: 'leo' },
    commit: {
      message: 'Add benchmark harness\n\nMore detail in the body.',
      author: { name: 'Leo', email: 'leo@example.com', date: '2026-11-16T15:00:00.000Z' },
    },
  },
  {
    sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    html_url: 'https://github.com/example/paper-code/commit/aaaaaaaa',
    author: { login: 'leo' },
    commit: {
      message: 'Initial plotting script',
      author: { name: 'Leo', email: 'leo@example.com', date: '2026-11-16T09:00:00.000Z' },
    },
  },
];

async function startGitHub() {
  authHeaders = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    authHeaders.push(String(req.headers.authorization ?? ''));
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/user') {
      if (String(req.headers.authorization ?? '').includes('write-token')) {
        res.setHeader('x-oauth-scopes', 'repo, read:user');
      }
      json(res, 200, { login: 'leo' });
      return;
    }
    if (url.pathname === '/rate_limit') {
      json(res, 200, { resources: {} });
      return;
    }
    if (url.pathname === '/repos/example/paper-code') {
      json(res, 200, {
        name: 'paper-code',
        full_name: 'example/paper-code',
        private: true,
        default_branch: 'main',
        html_url: 'https://github.com/example/paper-code',
        owner: { login: 'example' },
      });
      return;
    }
    if (url.pathname === '/repos/example/paper-code/commits') {
      json(res, 200, commits);
      return;
    }
    json(res, 404, { message: 'Not Found' });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

beforeEach(async () => {
  const githubApiBase = await startGitHub();
  harness = await createTestHarness({ githubApiBase });
});

afterEach(async () => {
  await harness.cleanup();
  server?.close();
  server = null;
});

describe('project repositories', () => {
  it('stores an encrypted account token and refuses write-capable classic scopes', async () => {
    const rejected = await harness.request('PUT', '/settings/github', { token: 'write-token' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toContain('write-capable');

    const saved = await harness.request('PUT', '/settings/github', { token: 'secret-token' });
    expect(saved.status).toBe(200);
    expect(saved.body.hasToken).toBe(true);
    expect(JSON.stringify(saved.body)).not.toContain('secret-token');
    const stored = harness.ctx.db
      .prepare('SELECT token_enc FROM github_credentials WHERE user_id = ?')
      .get(harness.userId) as { token_enc: string };
    expect(stored.token_enc).not.toContain('secret-token');
    expect(harness.ctx.services.settings.getGithubToken(harness.userId)).toBe('secret-token');

    const linked = await harness.request('POST', `/projects/${harness.projectId}/repositories`, {
      url: 'https://github.com/example/paper-code',
    });
    expect(linked.status).toBe(201);
    expect(linked.body.hasToken).toBe(false);
    const synced = await harness.request('POST', `/repositories/${linked.body.id}/sync`, {});
    expect(synced.status).toBe(200);
    expect(synced.body.imported).toBe(2);
  });

  it('links a private repository, imports commits once and adds them to the daily journal', async () => {
    const linked = await harness.request('POST', `/projects/${harness.projectId}/repositories`, {
      url: 'https://github.com/example/paper-code',
      token: 'secret-token',
    });
    expect(linked.status).toBe(201);
    expect(linked.body.fullName).toBe('example/paper-code');
    expect(linked.body.hasToken).toBe(true);
    expect(linked.body.isPrivate).toBe(true);
    expect(JSON.stringify(linked.body)).not.toContain('secret-token');
    expect(authHeaders).toContain('Bearer secret-token');

    const synced = await harness.request('POST', `/repositories/${linked.body.id}/sync`, {});
    expect(synced.status).toBe(200);
    expect(synced.body.imported).toBe(2);
    expect(synced.body.scanned).toBe(2);

    const again = await harness.request('POST', `/repositories/${linked.body.id}/sync`, {});
    expect(again.status).toBe(200);
    expect(again.body.imported).toBe(0);

    const list = await harness.request('GET', `/projects/${harness.projectId}/repositories`);
    expect(list.body.repositories).toHaveLength(1);
    expect(list.body.repositories[0].commitCount).toBe(2);
    expect(list.body.repositories[0].lastSyncedAt).toBeTruthy();

    const projectCommits = await harness.request(
      'GET',
      `/projects/${harness.projectId}/repository-commits`,
    );
    expect(projectCommits.body.commits).toHaveLength(2);
    expect(projectCommits.body.commits[0].message).toContain('benchmark');

    const journal = await harness.request('GET', '/journal/2026-11-16');
    expect(journal.status).toBe(200);
    expect(journal.body.diff.commitCount).toBe(2);
    const group = journal.body.diff.byProject.find(
      (item: { projectId: string }) => item.projectId === harness.projectId,
    );
    expect(group.commits).toHaveLength(2);
    expect(group.commits[0].shortSha).toBe('bbbbbbb');
    expect(
      journal.body.events.some((event: { action: string }) => event.action === 'repository.commit'),
    ).toBe(true);

    const removed = await harness.request('DELETE', `/repositories/${linked.body.id}`);
    expect(removed.status).toBe(200);
    const empty = await harness.request('GET', `/projects/${harness.projectId}/repository-commits`);
    expect(empty.body.commits).toHaveLength(0);
  });
});
