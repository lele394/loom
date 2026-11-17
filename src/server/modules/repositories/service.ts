import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { AppConfig } from '../../config';
import { AppError, notFound } from '../../core/errors';
import { newId } from '../../core/ids';
import { decryptSecret, encryptSecret } from '../../core/crypto';
import type { ProjectRepository, RepositoryCommit } from '../../../shared/types';

interface RepositoryRow {
  id: string;
  project_id: string;
  provider: 'github';
  owner: string;
  name: string;
  url: string;
  token_enc: string | null;
  default_branch: string | null;
  is_private: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
  updated_at: string;
}

interface CommitRow {
  id: string;
  repository_id: string;
  project_id: string;
  sha: string;
  message: string;
  author_name: string;
  author_login: string | null;
  author_email: string | null;
  committed_at: string;
  url: string;
  created_at: string;
}

interface GitHubRepo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: { login: string };
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; email: string | null; date: string };
  };
  author: { login: string } | null;
}

const MAX_PAGES = 10;
const PAGE_SIZE = 100;

export function parseGitHubRepository(input: string): { owner: string; name: string; url: string } {
  const trimmed = input.trim().replace(/\.git$/i, '');
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i.exec(trimmed);
  const https = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s?#]+)/i.exec(trimmed);
  const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed);
  const match = https ?? ssh ?? short;
  if (!match) {
    throw new AppError(
      'bad_request',
      'Use a GitHub repository URL such as https://github.com/owner/repository.',
    );
  }
  const owner = match[1]!;
  const name = match[2]!.replace(/\.git$/i, '');
  if (!owner || !name) {
    throw new AppError('bad_request', 'The GitHub repository URL is incomplete.');
  }
  return { owner, name, url: `https://github.com/${owner}/${name}` };
}

function mapRepository(row: RepositoryRow & { commit_count?: number }): ProjectRepository {
  return {
    id: row.id,
    projectId: row.project_id,
    provider: row.provider,
    owner: row.owner,
    name: row.name,
    fullName: `${row.owner}/${row.name}`,
    url: row.url,
    hasToken: Boolean(row.token_enc),
    defaultBranch: row.default_branch,
    isPrivate: row.is_private === 1,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
    commitCount: row.commit_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCommit(row: CommitRow, repositoryName: string): RepositoryCommit {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    projectId: row.project_id,
    repositoryName,
    sha: row.sha,
    shortSha: row.sha.slice(0, 7),
    message: row.message,
    authorName: row.author_name,
    authorLogin: row.author_login,
    authorEmail: row.author_email,
    committedAt: row.committed_at,
    url: row.url,
    createdAt: row.created_at,
  };
}

export class RepositoryService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly config: AppConfig,
  ) {}

  private requireProject(projectId: string): { id: string; status: string } {
    const row = this.db
      .prepare('SELECT id, status FROM projects WHERE id = ? AND deleted_at IS NULL')
      .get(projectId) as { id: string; status: string } | undefined;
    if (!row) throw notFound('Project');
    if (row.status === 'archived') {
      throw new AppError('project_archived', 'This project is archived and cannot be changed.');
    }
    return row;
  }

  private requireRow(id: string): RepositoryRow {
    const row = this.db
      .prepare('SELECT * FROM project_repositories WHERE id = ?')
      .get(id) as RepositoryRow | undefined;
    if (!row) throw notFound('Repository');
    return row;
  }

  private githubHeaders(token: string): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'Loom/0.1',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
  }

  private async github<T>(path: string, token: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.githubApiBase.replace(/\/+$/, '')}${path}`, {
        headers: this.githubHeaders(token),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError(
        'provider_error',
        `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      let detail = '';
      try {
        const payload = (await response.json()) as { message?: string };
        detail = payload.message ?? '';
      } catch {
        // Keep the HTTP status as the fallback message.
      }
      if (response.status === 401) {
        throw new AppError('provider_error', 'GitHub rejected the access token.');
      }
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new AppError('provider_error', 'GitHub rate limit exceeded. Add a token or try again later.');
      }
      if (response.status === 404) {
        throw new AppError(
          'provider_error',
          'Repository not found. For a private repository, add a GitHub token with read access.',
        );
      }
      throw new AppError(
        'provider_error',
        detail ? `GitHub: ${detail}` : `GitHub returned HTTP ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  }

  list(projectId: string): ProjectRepository[] {
    this.requireProject(projectId);
    const rows = this.db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM repository_commits c WHERE c.repository_id = r.id) AS commit_count
         FROM project_repositories r
         WHERE r.project_id = ?
         ORDER BY r.created_at ASC`,
      )
      .all(projectId) as (RepositoryRow & { commit_count: number })[];
    return rows.map(mapRepository);
  }

  async add(
    projectId: string,
    input: { url: string; token?: string },
    actorId: string,
  ): Promise<ProjectRepository> {
    this.requireProject(projectId);
    const parsed = parseGitHubRepository(input.url);
    const token = input.token?.trim() ?? '';
    const existing = this.db
      .prepare(
        'SELECT id FROM project_repositories WHERE project_id = ? AND lower(owner) = lower(?) AND lower(name) = lower(?)',
      )
      .get(projectId, parsed.owner, parsed.name) as { id: string } | undefined;
    if (existing) throw new AppError('bad_request', 'This repository is already linked to the project.');

    const repo = await this.github<GitHubRepo>(
      `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`,
      token,
    );
    const owner = repo.owner?.login ?? parsed.owner;
    const name = repo.name ?? parsed.name;
    const id = newId('repo');
    const now = this.clock.iso();
    this.db
      .prepare(
        `INSERT INTO project_repositories
           (id, project_id, provider, owner, name, url, token_enc, default_branch, is_private, created_at, updated_at)
         VALUES (?, ?, 'github', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        projectId,
        owner,
        name,
        repo.html_url || `https://github.com/${owner}/${name}`,
        token ? encryptSecret(token, this.config.masterKey) : null,
        repo.default_branch || null,
        repo.private ? 1 : 0,
        now,
        now,
      );
    this.activity.record({
      actorId,
      projectId,
      action: 'repository.linked',
      summary: `Linked GitHub repository ${owner}/${name}`,
      source: 'api',
    });
    return mapRepository({
      ...this.requireRow(id),
      commit_count: 0,
    });
  }

  updateToken(id: string, token: string | null, actorId: string): ProjectRepository {
    const row = this.requireRow(id);
    this.requireProject(row.project_id);
    const clean = token?.trim() ?? '';
    this.db
      .prepare('UPDATE project_repositories SET token_enc = ?, updated_at = ? WHERE id = ?')
      .run(clean ? encryptSecret(clean, this.config.masterKey) : null, this.clock.iso(), id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'repository.updated',
      summary: `${clean ? 'Updated' : 'Removed'} GitHub access token for ${row.owner}/${row.name}`,
      source: 'api',
    });
    const count = this.db
      .prepare('SELECT COUNT(*) AS count FROM repository_commits WHERE repository_id = ?')
      .get(id) as { count: number };
    return mapRepository({ ...this.requireRow(id), commit_count: count.count });
  }

  remove(id: string, actorId: string): void {
    const row = this.requireRow(id);
    this.requireProject(row.project_id);
    this.db.prepare('DELETE FROM project_repositories WHERE id = ?').run(id);
    this.activity.record({
      actorId,
      projectId: row.project_id,
      action: 'repository.unlinked',
      summary: `Unlinked GitHub repository ${row.owner}/${row.name}`,
      source: 'api',
    });
  }

  async sync(
    id: string,
    actorId: string,
    since?: string,
  ): Promise<{ repository: ProjectRepository; imported: number; scanned: number }> {
    const row = this.requireRow(id);
    this.requireProject(row.project_id);
    const token = decryptSecret(row.token_enc, this.config.masterKey);
    const sinceValue =
      since ??
      (row.last_synced_at
        ? new Date(new Date(row.last_synced_at).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
        : undefined);

    try {
      const commits: GitHubCommit[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) });
        if (sinceValue) query.set('since', sinceValue);
        const batch = await this.github<GitHubCommit[]>(
          `/repos/${encodeURIComponent(row.owner)}/${encodeURIComponent(row.name)}/commits?${query.toString()}`,
          token,
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        commits.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }

      commits.sort(
        (a, b) => new Date(a.commit.author.date).getTime() - new Date(b.commit.author.date).getTime(),
      );
      let imported = 0;
      const now = this.clock.iso();
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO repository_commits
           (id, repository_id, project_id, sha, message, author_name, author_login, author_email, committed_at, url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = this.db.transaction(() => {
        for (const commit of commits) {
          const committedAt = commit.commit?.author?.date;
          if (!commit.sha || !committedAt) continue;
          const message = (commit.commit.message ?? '').trim().slice(0, 4000);
          const title = (message.split('\n')[0] ?? '').trim() || commit.sha.slice(0, 7);
          const authorName = commit.commit.author?.name || commit.author?.login || 'Unknown author';
          const result = insert.run(
            newId('cmt'),
            row.id,
            row.project_id,
            commit.sha,
            message,
            authorName,
            commit.author?.login ?? null,
            commit.commit.author?.email ?? null,
            committedAt,
            commit.html_url || `${row.url}/commit/${commit.sha}`,
            now,
          );
          if (!result.changes) continue;
          imported += 1;
          this.activity.record({
            actorId,
            projectId: row.project_id,
            action: 'repository.commit',
            summary: `${row.owner}/${row.name} · ${commit.sha.slice(0, 7)} — ${title.slice(0, 180)}`,
            source: 'api',
            occurredAt: committedAt,
          });
        }
        this.db
          .prepare(
            `UPDATE project_repositories
             SET last_synced_at = ?, last_sync_error = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(now, now, row.id);
      });
      tx();

      const count = this.db
        .prepare('SELECT COUNT(*) AS count FROM repository_commits WHERE repository_id = ?')
        .get(row.id) as { count: number };
      return {
        repository: mapRepository({ ...this.requireRow(row.id), commit_count: count.count }),
        imported,
        scanned: commits.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db
        .prepare('UPDATE project_repositories SET last_sync_error = ?, updated_at = ? WHERE id = ?')
        .run(message.slice(0, 1000), this.clock.iso(), row.id);
      throw error;
    }
  }

  listCommits(options: {
    projectId: string;
    repositoryId?: string;
    limit?: number;
    from?: string;
    to?: string;
  }): RepositoryCommit[] {
    this.requireProject(options.projectId);
    const clauses = ['c.project_id = ?'];
    const params: unknown[] = [options.projectId];
    if (options.repositoryId) {
      clauses.push('c.repository_id = ?');
      params.push(options.repositoryId);
    }
    if (options.from) {
      clauses.push('c.committed_at >= ?');
      params.push(options.from);
    }
    if (options.to) {
      clauses.push('c.committed_at <= ?');
      params.push(options.to);
    }
    const rows = this.db
      .prepare(
        `SELECT c.*, r.owner AS repo_owner, r.name AS repo_name
         FROM repository_commits c
         JOIN project_repositories r ON r.id = c.repository_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY c.committed_at DESC
         LIMIT ?`,
      )
      .all(...params, options.limit ?? 100) as (CommitRow & { repo_owner: string; repo_name: string })[];
    return rows.map((item) => mapCommit(item, `${item.repo_owner}/${item.repo_name}`));
  }
}
