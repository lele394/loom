import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, relativeTime } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { objectRoute, TypeBadge } from '../../shared/components';
import { Empty, ErrorState, Field, Loading, Modal, Tabs, useConfirm, useToast } from '../../shared/ui';
import { INBOX_KINDS, type InboxKind } from '../../../shared/constants';
import type { InboxItem, Project } from '../../../shared/types';

export function InboxPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<'new' | 'triaged' | 'archived'>('new');
  const items = useAsync(() => api.get<{ items: InboxItem[] }>(`/inbox?status=${status}`), [status]);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<InboxKind>('idea');
  const [capturing, setCapturing] = useState(false);
  const [converting, setConverting] = useState<InboxItem | null>(null);
  const [target, setTarget] = useState<'note' | 'task' | 'reference' | 'experiment' | 'question'>('note');
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const refresh = () => items.reload();
    window.addEventListener('loom:inbox-updated', refresh);
    return () => window.removeEventListener('loom:inbox-updated', refresh);
  }, [items.reload]);

  const capture = async () => {
    if (!body.trim()) return;
    setCapturing(true);
    try {
      await api.post('/inbox', { body, kind, projectId: projectId || null });
      setBody('');
      items.reload();
      toast('Captured', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCapturing(false);
    }
  };

  const convert = async () => {
    if (!converting) return;
    setBusy(true);
    try {
      const result = await api.post<{ objectId: string; type: string }>(`/inbox/${converting.id}/convert`, {
        to: target,
        projectId: projectId || null,
        title: title || undefined,
      });
      setConverting(null);
      toast('Converted', 'success');
      navigate(objectRoute(result.type, result.objectId));
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const list = items.data?.items ?? [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub">Capture without deciding where it belongs. Triage later.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea
            className="textarea grow"
            placeholder="A thought, a paper, a task, a question…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void capture();
            }}
          />
          <div className="stack" style={{ width: 190 }}>
            <select className="select" value={kind} onChange={(event) => setKind(event.target.value as InboxKind)}>
              {INBOX_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Unfiled</option>
              {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <button className="btn primary" disabled={capturing || !body.trim()} onClick={() => void capture()}>Capture</button>
          </div>
        </div>
      </div>

      <Tabs
        value={status}
        onChange={setStatus}
        items={[
          { value: 'new', label: 'To triage' },
          { value: 'triaged', label: 'Triaged' },
          { value: 'archived', label: 'Archived' },
        ]}
      />

      {items.loading ? <Loading rows={4} /> : null}
      {items.error ? <ErrorState error={items.error} retry={items.reload} /> : null}
      {!items.loading && list.length === 0 ? (
        <div className="card"><Empty title={status === 'new' ? 'Inbox zero' : 'Nothing here'} icon="inbox">{status === 'new' ? 'New captures will appear here.' : 'Items appear after triage or archiving.'}</Empty></div>
      ) : null}

      <div className="stack">
        {list.map((item) => (
          <div className="card tight" key={item.id}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="badge">{item.kind}</span>
              <div className="grow" style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div>
              <span className="tiny faint">{relativeTime(item.createdAt)}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              {item.status === 'new' ? (
                <>
                  <button className="btn sm primary" onClick={() => {
                    setConverting(item);
                    setTitle(item.body.split(/\r?\n/)[0]?.slice(0, 100) ?? '');
                    setProjectId(item.projectId ?? projectId);
                    setTarget(item.kind === 'task' ? 'task' : item.kind === 'reference' ? 'reference' : item.kind === 'question' ? 'question' : item.kind === 'experiment' ? 'experiment' : 'note');
                  }}>Triage</button>
                  <button className="btn sm" onClick={() => void api.post(`/inbox/${item.id}/archive`).then(() => items.reload())}>Archive</button>
                </>
              ) : item.triagedObjectId ? (
                <span className="tiny faint">Converted to {item.status === 'triaged' ? 'an object' : 'archive'}.</span>
              ) : null}
              <button
                className="icon-btn sm"
                style={{ marginLeft: 'auto' }}
                aria-label="Delete inbox item"
                onClick={() => void confirm({
                  title: 'Delete capture?',
                  message: 'The inbox item is removed permanently.',
                  confirmLabel: 'Delete',
                  danger: true,
                }).then((ok) => ok ? api.del(`/inbox/${item.id}`).then(() => items.reload()) : undefined)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {converting ? (
        <Modal
          title="Triage capture"
          onClose={() => setConverting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConverting(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void convert()}>Convert</button>
            </>
          }
        >
          <div className="stack">
            <div className="small muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>{converting.body}</div>
            <Field label="Convert to">
              <select className="select" value={target} onChange={(event) => setTarget(event.target.value as typeof target)}>
                <option value="note">Note</option>
                <option value="task">Task</option>
                <option value="reference">Reference</option>
                <option value="experiment">Experiment</option>
                <option value="question">Research question</option>
              </select>
            </Field>
            {target !== 'note' ? (
              <Field label="Project" help={target === 'task' ? 'Tasks require a project.' : undefined}>
                <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  <option value="">{target === 'task' ? 'Choose a project…' : 'Unfiled'}</option>
                  {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Title">
              <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <div className="row"><TypeBadge type={target} /><span className="tiny faint">The inbox item is marked as triaged.</span></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
