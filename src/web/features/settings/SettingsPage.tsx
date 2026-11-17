import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, download } from '../../shared/api';
import { useSession } from '../../app/session';
import { useAsync, formatDate, formatDateTime, relativeTime, todayIso } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { PALETTE_META, contrastRatio, contrastText } from '../../shared/theme';
import { Empty, ErrorState, Field, Loading, Modal, Tabs, useConfirm, useToast } from '../../shared/ui';
import { formatBytes, objectRoute, TypeBadge } from '../../shared/components';
import { OBJECT_TYPES, PDF_METADATA_MODES, type PdfMetadataMode } from '../../../shared/constants';
import type { BackupRecord, GithubCredentialStatus, JobRecord, ObjectSummary, Project } from '../../../shared/types';

type Tab = 'appearance' | 'ai' | 'github' | 'data' | 'jobs' | 'account' | 'about';

interface ProviderForm {
  id?: string;
  name: string;
  kind: 'openai' | 'fake';
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embedModel: string;
  rerankModel: string;
  isDefault: boolean;
  hasApiKey?: boolean;
  apiKeyMasked?: string;
}

const emptyProvider: ProviderForm = {
  name: '',
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  chatModel: '',
  embedModel: '',
  rerankModel: '',
  isDefault: false,
};

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { meta, refresh, updateAppearance, user } = useSession();
  const { toast } = useToast();
  const confirm = useConfirm();
  const tab = (params.get('tab') as Tab) || 'appearance';
  const setTab = (value: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };

  if (!meta) return null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Appearance, AI providers, data ownership and maintenance.</p>
        </div>
      </div>
      <div className="settings-grid">
        <nav className="settings-nav">
          {([
            ['appearance', 'Appearance', 'sun'],
            ['ai', 'AI & search', 'sparkles'],
            ['github', 'GitHub', 'git'],
            ['data', 'Data & backup', 'archive'],
            ['jobs', 'Jobs', 'activity'],
            ['account', 'Account', 'settings'],
            ['about', 'About', 'help'],
          ] as const).map(([value, label, icon]) => (
            <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>
              <span className="row" style={{ gap: 8 }}><Icon name={icon} size={15} /> {label}</span>
            </button>
          ))}
        </nav>
        <div>
          {tab === 'appearance' ? <AppearanceSection /> : null}
          {tab === 'ai' ? <AiSection /> : null}
          {tab === 'github' ? <GitHubSection /> : null}
          {tab === 'data' ? <DataSection /> : null}
          {tab === 'jobs' ? <JobsSection /> : null}
          {tab === 'account' ? <AccountSection /> : null}
          {tab === 'about' ? <AboutSection /> : null}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { meta, updateAppearance } = useSession();
  if (!meta) return null;
  const appearance = meta.appearance;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Mode</h3>
        <div className="seg" style={{ width: 'fit-content' }}>
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button key={mode} className={appearance.mode === mode ? 'active' : ''} onClick={() => void updateAppearance({ mode })}>
              {mode === 'light' ? <><Icon name="sun" size={13} /> Light</> : mode === 'dark' ? <><Icon name="moon" size={13} /> Dark</> : <><Icon name="monitor" size={13} /> System</>}
            </button>
          ))}
        </div>
        <p className="small faint">The theme is applied before first paint; no flash of the wrong mode.</p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Palette</h3>
        <div className="swatches">
          {PALETTE_META.map((palette) => (
            <button
              key={palette.id}
              className={`swatch ${appearance.palette === palette.id ? 'selected' : ''}`}
              onClick={() => void updateAppearance({ palette: palette.id })}
            >
              <div className="preview" style={{ background: palette.light, borderColor: palette.accent }}>
                <div style={{ height: '100%', width: 8, background: palette.accent, borderRadius: 4, marginLeft: 8 }} />
              </div>
              {palette.label}
            </button>
          ))}
        </div>
        <p className="small faint">Pastels are used for surfaces and accents; body text stays high-contrast.</p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Custom accent</h3>
        <div className="row">
          <input
            type="color"
            value={appearance.accent || PALETTE_META.find((item) => item.id === appearance.palette)?.accent || '#7c5cbf'}
            onChange={(event) => void updateAppearance({ accent: event.target.value })}
            style={{ width: 48, height: 34, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}
          />
          <input className="input" style={{ width: 130 }} value={appearance.accent} placeholder="Theme default" onChange={(event) => void updateAppearance({ accent: event.target.value })} />
          <button className="btn sm" onClick={() => void updateAppearance({ accent: '' })}>Reset</button>
          <span className={`badge ${contrastRatio(appearance.accent || '#7c5cbf', contrastText(appearance.accent || '#7c5cbf')) < 4.5 ? 'danger' : 'info'}`}>
            text on accent: {contrastText(appearance.accent || '#7c5cbf') === '#ffffff' ? 'white' : 'ink'} ·{' '}
            {contrastRatio(appearance.accent || '#7c5cbf', contrastText(appearance.accent || '#7c5cbf')).toFixed(1)}:1
          </span>
        </div>
        <p className="small faint">Derived hover, soft and contrast tokens are computed from the accent.</p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Density</h3>
        <div className="seg" style={{ width: 'fit-content' }}>
          {(['comfortable', 'compact'] as const).map((density) => (
            <button key={density} className={appearance.density === density ? 'active' : ''} onClick={() => void updateAppearance({ density })}>{density}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AiSection() {
  const { meta, refresh } = useSession();
  const { toast } = useToast();
  const confirm = useConfirm();
  const providers = useAsync(() => api.get<{ providers: ProviderForm[] }>('/ai/providers').then((data) => data.providers), []);
  const [editing, setEditing] = useState<ProviderForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [pdfMode, setPdfMode] = useState<PdfMetadataMode>(
    (meta?.app.pdfMetadataMode as PdfMetadataMode) ?? 'ocr',
  );

  if (!meta) return null;
  const status = meta.ai;

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) {
        await api.patch(`/ai/providers/${editing.id}`, editing);
      } else {
        await api.post('/ai/providers', editing);
      }
      setEditing(null);
      providers.reload();
      await refresh();
      if (editing.embedModel) {
        await api.post('/search/embeddings/rebuild');
      }
      toast('Provider saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (provider: ProviderForm) => {
    const ok = await confirm({ title: `Delete ${provider.name}?`, message: 'Conversations remain; future requests use another provider.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/ai/providers/${provider.id}`);
      providers.reload();
      await refresh();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const test = async (provider: ProviderForm) => {
    setTesting(provider.id!);
    try {
      const result = await api.post<{ ok: boolean; latencyMs: number; error?: string }>(`/ai/providers/${provider.id}/test`);
      toast(result.ok ? `Reachable in ${result.latencyMs} ms` : `Test failed: ${result.error}`, result.ok ? 'success' : 'error');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setTesting(null);
    }
  };

  const addDemo = async () => {
    setBusy(true);
    try {
      await api.post('/ai/providers', {
        name: 'Offline demo',
        kind: 'fake',
        chatModel: '',
        embedModel: 'fake-embed',
        isDefault: true,
      });
      await api.post('/search/embeddings/rebuild');
      providers.reload();
      await refresh();
      toast('Offline demo provider added', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <div className="row between">
          <div>
            <h3 style={{ fontSize: 15 }}>Assistant status</h3>
            <p className="small faint">Chat and embeddings are independent capabilities.</p>
          </div>
          <span className={`badge ${status.chat ? 'success' : 'warning'}`}>{status.chat ? 'chat ready' : 'chat off'}</span>
        </div>
        <div className="grid-3">
          <div><div className="tiny faint">Chat</div><div className="small">{status.chat ? 'available' : 'unavailable'}</div></div>
          <div><div className="tiny faint">Embeddings</div><div className="small">{status.embeddings ? 'configured' : 'not configured'}</div></div>
          <div><div className="tiny faint">Coverage</div><div className="small">{status.embeddingCoverage.embedded}/{status.embeddingCoverage.chunks} chunks</div></div>
        </div>
        {status.reasons.length ? <ul className="small mute" style={{ margin: 0, paddingLeft: 18 }}>{status.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        <div className="row">
          <button className="btn sm" onClick={() => void api.post('/search/reindex').then(() => toast('Reindex queued', 'success'))}>Rebuild index</button>
          <button className="btn sm" onClick={() => void api.post('/search/embeddings/rebuild').then(() => toast('Embedding backfill queued', 'success'))}>Backfill embeddings</button>
          <button className="btn sm" onClick={() => void addDemo()} disabled={busy}>Add offline demo</button>
        </div>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>PDF metadata extraction</h3>
        <p className="small faint">
          How Loom reads dropped PDFs before asking the model for structured metadata. This is the default; the
          Literature page and each PDF submission can override it.
        </p>
        <div className="seg" style={{ width: 'fit-content' }}>
          {PDF_METADATA_MODES.map((mode) => (
            <button
              key={mode}
              className={pdfMode === mode ? 'active' : ''}
              onClick={() => {
                setPdfMode(mode);
                void api
                  .patch('/settings/app', { pdfMetadataMode: mode })
                  .then(() => refresh())
                  .then(() => toast(`PDF metadata mode: ${mode}`, 'success'))
                  .catch((error) => toast((error as Error).message, 'error'));
              }}
            >
              {mode === 'text' ? 'Text extraction' : mode === 'images' ? 'Send page images' : 'OCR then text'}
            </button>
          ))}
        </div>
        <div className="tiny faint">
          {pdfMode === 'text'
            ? 'Fast and private: uses the PDF’s embedded text. Scanned PDFs may yield little or no text.'
            : pdfMode === 'images'
              ? 'Renders the first 3 pages to JPEG and sends them to a vision-capable model. Best for scanned or layout-heavy papers.'
              : 'Renders pages and OCRs them. Uses local Tesseract when installed; otherwise uses the vision model to transcribe. Slower.'}
          {' '}Images/OCR require poppler-utils (`pdftoppm`) on the server.
        </div>
      </div>

      <div className="card stack">
        <div className="row between">
          <h3 style={{ fontSize: 15 }}>Providers</h3>
          <button className="btn primary sm" onClick={() => setEditing({ ...emptyProvider, isDefault: (providers.data ?? []).length === 0 })}>
            <Icon name="plus" size={14} /> Add provider
          </button>
        </div>
        {providers.loading ? <Loading rows={2} /> : null}
        {providers.data?.length === 0 ? (
          <Empty title="No provider configured" icon="sparkles">
            Loom remains fully usable. Add an OpenAI-compatible endpoint or try the offline demo.
          </Empty>
        ) : null}
        {providers.data?.map((provider) => (
          <div className="card tight" key={provider.id}>
            <div className="row between">
              <div>
                <div className="row" style={{ gap: 7 }}>
                  <strong className="small">{provider.name}</strong>
                  {provider.isDefault ? <span className="badge accent">default</span> : null}
                  <span className="badge">{provider.kind}</span>
                  {provider.hasApiKey ? <span className="badge success">key set</span> : null}
                </div>
                <div className="tiny faint" style={{ marginTop: 3 }}>
                  {provider.baseUrl} · chat {provider.chatModel || '—'} · embed {provider.embedModel || '—'}
                </div>
              </div>
              <div className="row" style={{ gap: 5 }}>
                <button className="btn sm" disabled={testing === provider.id} onClick={() => void test(provider)}>{testing === provider.id ? 'Testing…' : 'Test'}</button>
                <button className="btn sm" onClick={() => setEditing({ ...provider, apiKey: '' })}>Edit</button>
                <button className="icon-btn sm" aria-label="Delete provider" onClick={() => void remove(provider)}><Icon name="trash" size={13} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15 }}>Privacy</h3>
        <p className="small muted" style={{ marginTop: 8 }}>
          Chats send the system prompt, retrieved excerpts, recent turns and your message to the configured endpoint.
          Embeddings send chunk text. The offline demo never leaves the machine. Loom has no telemetry.
        </p>
      </div>

      {editing ? (
        <Modal
          title={editing.id ? 'Edit provider' : 'Add provider'}
          onClose={() => setEditing(null)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !editing.name.trim()} onClick={() => void save()}>Save</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid-2">
              <Field label="Name"><input className="input" autoFocus value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></Field>
              <Field label="Kind">
                <select className="select" value={editing.kind} onChange={(event) => setEditing({ ...editing, kind: event.target.value as 'openai' | 'fake' })}>
                  <option value="openai">OpenAI-compatible</option>
                  <option value="fake">Offline demo</option>
                </select>
              </Field>
            </div>
            {editing.kind === 'openai' ? (
              <>
                <Field label="Base URL" help="Include /v1. Examples: https://api.openai.com/v1, http://127.0.0.1:11434/v1">
                  <input className="input" value={editing.baseUrl} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} />
                </Field>
                <Field label="API key" help={editing.id ? 'Leave blank to keep the existing key.' : 'Stored encrypted with AES-GCM.'}>
                  <input className="input" type="password" value={editing.apiKey} onChange={(event) => setEditing({ ...editing, apiKey: event.target.value })} placeholder={editing.id ? '••••••••' : 'sk-…'} />
                </Field>
              </>
            ) : null}
            <div className="grid-2">
              <Field label="Chat model"><input className="input" value={editing.chatModel} onChange={(event) => setEditing({ ...editing, chatModel: event.target.value })} placeholder="llama3.1:8b" /></Field>
              <Field label="Embedding model" help="Required for semantic search."><input className="input" value={editing.embedModel} onChange={(event) => setEditing({ ...editing, embedModel: event.target.value })} placeholder="nomic-embed-text" /></Field>
            </div>
            <label className="checkbox">
              <input type="checkbox" checked={editing.isDefault} onChange={(event) => setEditing({ ...editing, isDefault: event.target.checked })} />
              Use as default provider
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function GitHubSection() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const credential = useAsync(
    () => api.get<{ github: GithubCredentialStatus }>('/settings').then((data) => data.github),
    [],
  );
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const next = await api.put<GithubCredentialStatus>('/settings/github', { token });
      credential.setData(next);
      setToken('');
      toast('GitHub token saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Remove the account GitHub token?',
      message: 'Repositories without their own token will no longer be able to pull private commits.',
      confirmLabel: 'Remove token',
      danger: true,
    });
    if (!ok) return;
    try {
      const next = await api.del<GithubCredentialStatus>('/settings/github');
      credential.setData(next);
      toast('GitHub token removed', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const status = credential.data;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: 15 }}>Account GitHub token</h3>
            <p className="small faint" style={{ marginTop: 4 }}>
              Used by linked repositories that do not have their own token. Public repositories work without a token.
            </p>
          </div>
          <a className="btn sm" href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
            <Icon name="external" size={13} /> Create a token
          </a>
        </div>

        {credential.loading ? <Loading rows={2} /> : null}
        {credential.error ? <ErrorState error={credential.error} retry={credential.reload} /> : null}
        {status ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className={`badge ${status.hasToken ? 'success' : 'warning'}`}>
              {status.hasToken ? 'token configured' : 'no token'}
            </span>
            {status.hasToken ? <span className="badge">…{status.hint.replace(/^…/, '')}</span> : null}
            {status.login ? <span className="badge info">{status.login}</span> : null}
            {status.tokenType ? <span className="badge">{status.tokenType}</span> : null}
            {status.updatedAt ? <span className="tiny faint">updated {relativeTime(status.updatedAt)}</span> : null}
          </div>
        ) : null}

        <Field label={status?.hasToken ? 'Replace token' : 'GitHub token'}>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input grow"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="github_pat_… or ghp_…"
              autoComplete="off"
            />
            <button className="btn primary" disabled={busy || !token.trim()} onClick={() => void save()}>
              {busy ? 'Validating…' : 'Save token'}
            </button>
            {status?.hasToken ? (
              <button className="btn danger" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            ) : null}
          </div>
        </Field>

        <p className="tiny faint">
          Tokens are encrypted at rest with a per-user key derived from the server master key. They are never returned
          by the API. Hashing is not possible here because Loom must send the token to GitHub when pulling commits.
        </p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Recommended permissions</h3>
        <p className="small">
          Use a <strong>fine-grained personal access token</strong> from{' '}
          <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer">
            GitHub → Settings → Personal access tokens
          </a>.
        </p>
        <div className="stack sm">
          <div className="row between"><span className="small">Repository access</span><span className="badge">Only select repositories</span></div>
          <div className="row between"><span className="small">Contents</span><span className="badge success">Read-only</span></div>
          <div className="row between"><span className="small">Metadata</span><span className="badge success">Read-only (required)</span></div>
          <div className="row between"><span className="small">Everything else</span><span className="badge">No access</span></div>
        </div>
        <p className="tiny faint">
          Loom refuses classic tokens that advertise write-capable scopes such as <code>repo</code> or{' '}
          <code>public_repo</code>. For fine-grained tokens GitHub does not expose granted permissions to the token
          itself, so Loom validates the token and repository read access, and relies on you choosing read-only
          permissions. The token is used only for repository metadata and commit history — no clone and no file
          contents.
        </p>
      </div>
    </div>
  );
}

function DataSection() {
  const { meta, refresh } = useSession();
  const { toast } = useToast();
  const confirm = useConfirm();
  const backups = useAsync(() => api.get<{ backups: BackupRecord[] }>('/backups').then((data) => data.backups), []);
  const trash = useAsync(() => api.get<{ objects: ObjectSummary[]; projects: Project[] }>('/trash'), []);
  const [creating, setCreating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreWord, setRestoreWord] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [retention, setRetention] = useState(meta?.app.backupRetention ?? 14);

  const createBackup = async () => {
    setCreating(true);
    try {
      await api.post('/backups', { kind: 'manual' });
      toast('Backup started', 'success');
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const data = await api.get<{ backups: BackupRecord[] }>('/backups');
        if (data.backups.some((backup) => backup.kind === 'manual')) {
          backups.setData(data.backups);
          break;
        }
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const verify = async (backup: BackupRecord) => {
    try {
      const result = await api.post<{ ok: boolean; errors: string[]; checkedFiles: number }>(`/backups/${backup.id}/verify`);
      toast(result.ok ? `Verified ${result.checkedFiles} files` : result.errors[0] ?? 'Verification failed', result.ok ? 'success' : 'error');
      backups.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const removeBackup = async (backup: BackupRecord) => {
    const ok = await confirm({ title: 'Delete backup?', message: 'The archive file is removed from disk.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/backups/${backup.id}`);
      backups.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const openRestore = () => {
    setRestoreFile(null);
    setRestoreWord('');
    setRestoreOpen(true);
  };

  const closeRestore = () => {
    setRestoreOpen(false);
    setRestoreFile(null);
    setRestoreWord('');
  };

  const restore = async () => {
    if (!restoreFile || restoreWord !== 'RESTORE') return;
    setRestoring(true);
    try {
      const result = await api.upload<{ counts: { objects: number }; warnings: string[] }>(
        '/backups/restore?confirm=RESTORE',
        restoreFile,
      );
      toast(`Restored ${result.counts.objects} objects. Signing out…`, 'success');
      if (result.warnings.length) toast(result.warnings[0]!, 'info');
      setTimeout(() => {
        window.location.href = '/';
      }, 1600);
    } catch (error) {
      toast((error as Error).message, 'error');
      setRestoring(false);
    }
  };

  const restoreProject = async (project: Project) => {
    try {
      await api.post(`/projects/${project.id}/restore`);
      trash.reload();
      toast('Project restored', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const purgeProject = async (project: Project) => {
    const ok = await confirm({ title: `Permanently delete “${project.name}”?`, message: 'Its objects and attachments are purged. Activity history is retained. This cannot be undone.', confirmLabel: 'Purge project', danger: true });
    if (!ok) return;
    try {
      await api.del(`/trash/projects/${project.id}`);
      trash.reload();
      toast('Project purged', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const restoreTrash = async (object: ObjectSummary) => {
    try {
      await api.post(`/trash/${object.id}/restore`);
      trash.reload();
      toast('Restored', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const purge = async (object: ObjectSummary) => {
    const ok = await confirm({ title: 'Delete permanently?', message: 'This cannot be undone. Activity events are retained.', confirmLabel: 'Purge', danger: true });
    if (!ok) return;
    try {
      await api.del(`/trash/${object.id}`);
      trash.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Export</h3>
        <p className="small muted">Portable formats: JSONL, Markdown, BibTeX, original files, manifest and checksums.</p>
        <div className="row">
          <button className="btn" onClick={() => void download('/export/workspace.zip', `loom-export-${todayIso()}.zip`)}>
            <Icon name="download" size={14} /> Workspace ZIP
          </button>
          <button className="btn" onClick={() => void download('/references.bib', 'loom-references.bib')}>
            <Icon name="book" size={14} /> All BibTeX
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="row between">
          <div>
            <h3 style={{ fontSize: 15 }}>Backups</h3>
            <p className="small faint">SQLite snapshot + attachments. Restore is verified before any mutation.</p>
          </div>
          <div className="row">
            <button className="btn" onClick={() => backups.reload()}>Refresh</button>
            <button className="btn primary" disabled={creating} onClick={() => void createBackup()}>
              {creating ? 'Creating…' : 'Create backup'}
            </button>
          </div>
        </div>
        <div className="row">
          <span className="small muted">Keep automatic backups:</span>
          <input className="input" type="number" min={1} max={365} style={{ width: 90 }} value={retention} onChange={(event) => setRetention(Number(event.target.value))} />
          <button
            className="btn sm"
            onClick={() => void api.patch('/settings/app', { backupRetention: retention }).then(() => { toast('Retention saved', 'success'); void refresh(); })}
          >
            Save
          </button>
        </div>
        {backups.loading ? <Loading rows={2} /> : null}
        {backups.data?.length === 0 ? <p className="small faint">No backups yet.</p> : null}
        {backups.data?.map((backup) => (
          <div className="list-row" key={backup.id}>
            <Icon name="archive" />
            <div className="grow">
              <div className="small">{backup.filename}</div>
              <div className="tiny faint">{backup.kind} · {formatBytes(backup.size)} · {formatDateTime(backup.createdAt)} · {backup.status}</div>
            </div>
            <button className="btn sm" onClick={() => void verify(backup)}>Verify</button>
            <button className="btn sm" onClick={() => void download(`/backups/${backup.id}/download`, backup.filename)}>Download</button>
            <button className="icon-btn sm" aria-label="Delete backup" onClick={() => void removeBackup(backup)}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        <div className="divider" />
        <div className="row between">
          <span className="small muted">Restore replaces the whole workspace and forces re-login.</span>
          <button className="btn danger" onClick={openRestore}>Restore from backup…</button>
        </div>
        <p className="tiny faint">Backups contain everything and are not encrypted by Loom. Store them encrypted offsite.</p>
      </div>

      <div className="card stack">
        <div className="row between">
          <h3 style={{ fontSize: 15 }}>Trash</h3>
          <button className="btn sm" onClick={() => trash.reload()}>Refresh</button>
        </div>
        {(trash.data?.objects.length ?? 0) === 0 && (trash.data?.projects.length ?? 0) === 0 ? (
          <p className="small faint">Trash is empty.</p>
        ) : null}
        {trash.data?.projects.map((project) => (
          <div className="list-row" key={project.id}>
            <Icon name="folder" />
            <div className="grow">
              <div className="small">{project.name}</div>
              <div className="tiny faint">Deleted project · restores its objects</div>
            </div>
            <button className="btn sm" onClick={() => void restoreProject(project)}>Restore</button>
            {!project.isSystem ? (
              <button className="icon-btn sm" aria-label="Purge project" onClick={() => void purgeProject(project)}><Icon name="trash" size={13} /></button>
            ) : null}
          </div>
        ))}
        {trash.data?.objects.map((object) => (
          <div className="list-row" key={object.id}>
            <TypeBadge type={object.type} />
            <span className="grow small truncate">{object.title}</span>
            <button className="btn sm" onClick={() => void restoreTrash(object)}>Restore</button>
            <button className="icon-btn sm" aria-label="Purge" onClick={() => void purge(object)}><Icon name="trash" size={13} /></button>
          </div>
        ))}
        <div className="row">
          <button
            className="btn sm"
            onClick={() => void confirm({
              title: 'Empty trash?',
              message: 'All trashed objects are permanently removed. Activity history remains.',
              confirmLabel: 'Empty trash',
              danger: true,
            }).then(async (ok) => {
              if (!ok) return;
              await api.post('/trash/empty');
              trash.reload();
              toast('Trash emptied', 'success');
            })}
          >
            Empty trash
          </button>
        </div>
        <p className="tiny faint">Automatic purge removes objects after 30 days. Storage limit: {meta?.capabilities.limits.maxStorageGb} GB.</p>
      </div>

      {restoreOpen ? (
        <Modal
          title="Restore a backup"
          onClose={closeRestore}
          footer={
            <>
              <button className="btn" onClick={closeRestore}>Cancel</button>
              <button className="btn danger" disabled={!restoreFile || restoreWord !== 'RESTORE' || restoring} onClick={() => void restore()}>
                {restoring ? 'Restoring…' : 'Restore workspace'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: 0 }}>
              This replaces all current objects, attachments, settings and conversations. A pre-restore backup is created automatically.
            </div>
            <Field label="Backup ZIP">
              <input className="input" type="file" accept=".zip,application/zip" onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)} />
            </Field>
            <Field label='Type "RESTORE" to confirm'>
              <input className="input" value={restoreWord} onChange={(event) => setRestoreWord(event.target.value)} placeholder="RESTORE" />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function JobsSection() {
  const [status, setStatus] = useState('');
  const jobs = useAsync(() => api.get<{ jobs: JobRecord[] }>(`/jobs${status ? `?status=${status}` : ''}`), [status]);
  const { toast } = useToast();
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between">
          <div>
            <h3 style={{ fontSize: 15 }}>Background jobs</h3>
            <p className="small faint">Extraction, embeddings, digests, backups and maintenance.</p>
          </div>
          <div className="row">
            <select className="select" style={{ width: 150 }} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {['queued', 'running', 'succeeded', 'failed', 'dead'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button className="btn" onClick={() => jobs.reload()}>Refresh</button>
          </div>
        </div>
        {jobs.loading ? <Loading rows={3} /> : null}
        {jobs.error ? <ErrorState error={jobs.error} retry={jobs.reload} /> : null}
        {jobs.data?.jobs.length === 0 ? <Empty title="No jobs" icon="activity" /> : null}
        {jobs.data?.jobs.map((job) => (
          <div className="list-row" key={job.id}>
            <span className={`badge ${job.status === 'dead' || job.status === 'failed' ? 'danger' : job.status === 'succeeded' ? 'success' : job.status === 'running' ? 'info' : ''}`}>{job.status}</span>
            <div className="grow">
              <div className="small">{job.type}</div>
              <div className="tiny faint">
                attempts {job.attempts}/{job.maxAttempts} · created {relativeTime(job.createdAt)}
                {job.lastError ? ` · ${job.lastError.slice(0, 100)}` : ''}
              </div>
            </div>
            {job.status === 'dead' || job.status === 'failed' ? (
              <button className="btn sm" onClick={() => void api.post(`/jobs/${job.id}/retry`).then(() => { jobs.reload(); toast('Retry queued', 'success'); })}>Retry</button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountSection() {
  const { user, meta, refresh } = useSession();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? 'UTC');
  const [digestTime, setDigestTime] = useState(meta?.app.digestTime ?? '06:00');
  const [digestEnabled, setDigestEnabled] = useState(meta?.preferences.digestEnabled ?? true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const save = async () => {
    setBusy(true);
    try {
      await api.patch('/settings/account', { displayName, timezone });
      await refresh();
      toast('Profile saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await api.post('/auth/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      toast('Password changed; other sessions signed out', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Profile</h3>
        <div className="grid-2">
          <Field label="Display name"><input className="input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></Field>
          <Field label="Timezone" help="Daily journal boundaries use this zone."><input className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} /></Field>
        </div>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => void save()}>Save profile</button></div>
        <p className="tiny faint">Username: {user.username} · {user.isAdmin ? 'administrator' : 'member'}</p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Daily journal</h3>
        <p className="small faint">The digest job runs at this local time for yesterday. It only interprets the deterministic diff.</p>
        <div className="row">
          <label className="field">
            <span className="label">Digest time</span>
            <input className="input" type="time" value={digestTime} onChange={(event) => setDigestTime(event.target.value)} />
          </label>
          <label className="checkbox" style={{ marginTop: 18 }}>
            <input type="checkbox" checked={digestEnabled} onChange={(event) => setDigestEnabled(event.target.checked)} />
            Generate daily digests automatically
          </label>
          <button
            className="btn"
            style={{ marginTop: 18 }}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void Promise.all([
                api.patch('/settings/app', { digestTime }),
                api.patch('/settings/preferences', { digestEnabled }),
              ]).then(async () => {
                await refresh();
                toast('Journal schedule saved', 'success');
              }).catch((error) => toast((error as Error).message, 'error')).finally(() => setBusy(false));
            }}
          >
            Save schedule
          </button>
        </div>
        <p className="tiny faint">Timezone: {timezone}. Change it above in Profile.</p>
      </div>

      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Change password</h3>
        <div className="grid-2">
          <Field label="Current password"><input className="input" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></Field>
          <Field label="New password" help="At least 10 characters."><input className="input" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></Field>
        </div>
        <div className="row"><button className="btn" disabled={busy || !currentPassword || newPassword.length < 10} onClick={() => void changePassword()}>Change password</button></div>
      </div>

      <div className="card stack danger-zone">
        <h3 style={{ fontSize: 15 }}>Sessions</h3>
        <p className="small muted">Sign out every browser, including this one.</p>
        <div className="row">
          <button
            className="btn danger"
            onClick={() => void api.post('/auth/logout-all').then(() => { window.location.href = '/'; })}
          >
            Sign out everywhere
          </button>
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const { meta } = useSession();
  return (
    <div className="stack">
      <div className="card stack">
        <h3 style={{ fontSize: 15 }}>Loom {meta?.version}</h3>
        <p className="small muted">
          A personal research OS: projects, Kanban, block notes, literature, experiments, questions, activity, search and a cited AI assistant.
        </p>
        <p className="small muted">Your data lives in a SQLite file and a content-addressed attachment store. Export and backup are core features, not add-ons.</p>
        <div className="row">
          <Link className="btn sm" to="/journal">Open the journal</Link>
          <Link className="btn sm" to="/activity">Activity timeline</Link>
        </div>
      </div>
      <div className="card">
        <h3 style={{ fontSize: 15 }}>Keyboard</h3>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="kbd">Ctrl/⌘ K</span><span className="small muted">command palette</span>
          <span className="kbd">Ctrl/⌘ Shift Space</span><span className="small muted">quick capture</span>
          <span className="kbd">?</span><span className="small muted">shortcuts</span>
        </div>
      </div>
    </div>
  );
}
