import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ProjectRepository, RepositoryCommit } from '../../../shared/types';
import { api } from '../../shared/api';
import { useAsync, formatDate, relativeTime, timeOf } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { useProject } from '../../shared/projectContext';
import { ErrorState, Field, Loading, Modal, Spinner, useConfirm, useToast } from '../../shared/ui';

function commitDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

export function ProjectCodePage() {
  const { project } = useProject();
  const { toast } = useToast();
  const confirm = useConfirm();
  const repositories = useAsync(
    () => api.get<{ repositories: ProjectRepository[] }>(`/projects/${project.id}/repositories`),
    [project.id],
  );
  const commits = useAsync(
    () =>
      api.get<{ commits: RepositoryCommit[] }>(
        `/projects/${project.id}/repository-commits?limit=100`,
      ),
    [project.id],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [tokenRepo, setTokenRepo] = useState<ProjectRepository | null>(null);
  const [replacementToken, setReplacementToken] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const readOnly = project.status === 'archived';

  const reload = () => {
    repositories.reload();
    commits.reload();
  };

  const addRepository = async () => {
    setBusy(true);
    try {
      await api.post(`/projects/${project.id}/repositories`, { url, token });
      toast('Repository linked', 'success');
      setAddOpen(false);
      setUrl('');
      setToken('');
      reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sync = async (repository: ProjectRepository) => {
    setSyncingId(repository.id);
    try {
      const result = await api.post<{ imported: number; scanned: number }>(
        `/repositories/${repository.id}/sync`,
        {},
      );
      toast(
        result.imported
          ? `Imported ${result.imported} new commit${result.imported === 1 ? '' : 's'}`
          : 'No new commits found',
        'success',
      );
      reload();
    } catch (error) {
      toast((error as Error).message, 'error');
      repositories.reload();
    } finally {
      setSyncingId(null);
    }
  };

  const remove = async (repository: ProjectRepository) => {
    const ok = await confirm({
      title: 'Unlink repository?',
      message: `This removes ${repository.fullName} and its imported commit records. Existing audit-log activity remains. The GitHub repository itself is not touched.`,
      confirmLabel: 'Unlink',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/repositories/${repository.id}`);
      toast('Repository unlinked', 'success');
      reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const saveToken = async (clear = false) => {
    if (!tokenRepo) return;
    setTokenBusy(true);
    try {
      await api.patch(`/repositories/${tokenRepo.id}`, {
        token: clear ? null : replacementToken,
      });
      toast(clear ? 'Token removed' : 'Token updated', 'success');
      setTokenRepo(null);
      setReplacementToken('');
      repositories.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setTokenBusy(false);
    }
  };

  const commitGroups = (() => {
    const groups = new Map<string, RepositoryCommit[]>();
    for (const commit of commits.data?.commits ?? []) {
      const day = commitDay(commit.committedAt);
      const bucket = groups.get(day) ?? [];
      bucket.push(commit);
      groups.set(day, bucket);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  })();

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <strong className="small">GitHub repositories</strong>
          <p className="small faint" style={{ marginTop: 4 }}>
            Link public or private repositories. Pulling history imports commit metadata only — no repository files
            are downloaded. Each pull reads up to 1,000 recent commits. Repositories without their own token use the{' '}
            <Link to="/settings?tab=github">account GitHub token</Link>.
          </p>
        </div>
        <button className="btn primary sm" disabled={readOnly} onClick={() => setAddOpen(true)}>
          <Icon name="plus" size={14} /> Link repository
        </button>
      </div>

      {repositories.loading ? <Loading rows={3} /> : null}
      {repositories.error ? (
        <ErrorState error={repositories.error} retry={repositories.reload} />
      ) : null}
      {!repositories.loading && repositories.data?.repositories.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ padding: 28 }}>
            <Icon name="git" size={24} />
            <strong>No repositories linked</strong>
            <span className="small">Connect a GitHub repository to pull its commits into the daily timeline.</span>
            <button className="btn sm" disabled={readOnly} onClick={() => setAddOpen(true)}>
              Link the first repository
            </button>
          </div>
        </div>
      ) : null}

      {(repositories.data?.repositories ?? []).map((repository) => (
        <div className="card stack sm" key={repository.id}>
          <div className="row between" style={{ alignItems: 'flex-start', gap: 10 }}>
            <div className="row" style={{ gap: 8, minWidth: 0 }}>
              <Icon name="git" size={18} />
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <a href={repository.url} target="_blank" rel="noreferrer" className="small truncate">
                    <strong>{repository.fullName}</strong>
                  </a>
                  <span className={`badge ${repository.isPrivate ? 'info' : ''}`}>
                    {repository.isPrivate ? 'private' : 'public'}
                  </span>
                  {repository.hasToken ? <span className="badge success">token</span> : null}
                </div>
                <div className="tiny faint" style={{ marginTop: 4 }}>
                  {repository.defaultBranch ? `${repository.defaultBranch} · ` : ''}
                  {repository.commitCount} commit{repository.commitCount === 1 ? '' : 's'} imported
                  {repository.lastSyncedAt
                    ? ` · pulled ${relativeTime(repository.lastSyncedAt)}`
                    : ' · never pulled'}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 4 }}>
              <a className="btn sm" href={repository.url} target="_blank" rel="noreferrer">
                <Icon name="external" size={13} /> GitHub
              </a>
              <button
                className="btn sm"
                disabled={readOnly || syncingId === repository.id}
                onClick={() => void sync(repository)}
              >
                {syncingId === repository.id ? <Spinner /> : <Icon name="refresh" size={13} />}
                {syncingId === repository.id ? 'Pulling…' : 'Pull commits'}
              </button>
              <button
                className="btn sm"
                disabled={readOnly || syncingId === repository.id}
                onClick={() => {
                  setTokenRepo(repository);
                  setReplacementToken('');
                }}
              >
                Token
              </button>
              <button
                className="icon-btn sm"
                disabled={readOnly || syncingId === repository.id}
                title="Unlink repository"
                aria-label={`Unlink ${repository.fullName}`}
                onClick={() => void remove(repository)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
          {repository.lastSyncError ? (
            <div className="small" style={{ color: 'var(--danger)' }}>
              Last pull failed: {repository.lastSyncError}
            </div>
          ) : null}
        </div>
      ))}

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <div>
            <strong className="small">Commit timeline</strong>
            <div className="tiny faint">Commits also appear in each day’s journal and project activity.</div>
          </div>
          <button className="btn sm" onClick={() => commits.reload()}>Refresh</button>
        </div>
        {commits.loading ? <Loading rows={4} /> : null}
        {commits.error ? <ErrorState error={commits.error} retry={commits.reload} /> : null}
        {!commits.loading && !commitGroups.length ? (
          <div className="empty" style={{ padding: 24 }}>
            <span className="small">No commits imported yet. Pull a repository to build the timeline.</span>
          </div>
        ) : null}
        {commitGroups.map(([day, dayCommits]) => (
          <div key={day} style={{ marginTop: 12 }}>
            <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>
              {formatDate(day)}
            </div>
            {dayCommits.map((commit) => (
              <div className="diff-item" key={commit.id}>
                <Icon name="git" size={13} />
                <a href={commit.url} target="_blank" rel="noreferrer" className="truncate" title={commit.message}>
                  {commit.message.split('\n')[0]}
                </a>
                <span className="tiny faint">
                  {commit.repositoryName} · {commit.shortSha} · {commit.authorName} · {timeOf(commit.committedAt)}
                </span>
              </div>
            ))}
          </div>
        ))}
        {commitGroups.length ? (
          <div className="tiny faint" style={{ marginTop: 12 }}>
            Imported commits are timestamped by their git author date.
          </div>
        ) : null}
      </div>

      {addOpen ? (
        <Modal
          title="Link GitHub repository"
          description="Only commit metadata is imported; the repository is not cloned."
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !url.trim()} onClick={() => void addRepository()}>
                {busy ? 'Checking…' : 'Link repository'}
              </button>
            </>
          }
        >
          <div className="stack">
            <Field label="Repository URL">
              <input
                className="input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                autoFocus
              />
            </Field>
            <Field
              label="Repository-specific token (optional)"
              help="Needed for private repositories unless an account token is set. Read-only fine-grained tokens only; write-capable classic scopes are refused."
            >
              <input
                className="input"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_… or ghp_…"
                autoComplete="off"
              />
            </Field>
            <p className="tiny faint">
              Leave this blank to use the general token in <Link to="/settings?tab=github">Settings → GitHub</Link>.
              Tokens are encrypted at rest and never returned by the API.
            </p>
          </div>
        </Modal>
      ) : null}

      {tokenRepo ? (
        <Modal
          title={`GitHub token — ${tokenRepo.fullName}`}
          onClose={() => setTokenRepo(null)}
          footer={
            <>
              {tokenRepo.hasToken ? (
                <button
                  className="btn danger"
                  style={{ marginRight: 'auto' }}
                  disabled={tokenBusy}
                  onClick={() => void saveToken(true)}
                >
                  Remove token
                </button>
              ) : null}
              <button className="btn" onClick={() => setTokenRepo(null)}>Cancel</button>
              <button
                className="btn primary"
                disabled={tokenBusy || !replacementToken.trim()}
                onClick={() => void saveToken(false)}
              >
                {tokenBusy ? 'Saving…' : 'Save token'}
              </button>
            </>
          }
        >
          <div className="stack sm">
            <Field label="Read-only GitHub token">
              <input
                className="input"
                type="password"
                value={replacementToken}
                onChange={(event) => setReplacementToken(event.target.value)}
                placeholder="ghp_…"
                autoComplete="off"
                autoFocus
              />
            </Field>
            <p className="tiny faint">
              The token is validated against GitHub before saving. Write-capable classic scopes are refused. It is
              encrypted at rest and only sent to the GitHub API when pulling commits or checking the repository.
            </p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
