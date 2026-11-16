import { useEffect, useState } from 'react';
import { api } from '../shared/api';
import { Modal, useToast } from '../shared/ui';
import type { InboxKind } from '../../shared/constants';
import type { Project } from '../../shared/types';

const KINDS: { value: InboxKind; label: string }[] = [
  { value: 'idea', label: 'Idea' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
  { value: 'reference', label: 'Reference' },
  { value: 'experiment', label: 'Experiment' },
  { value: 'question', label: 'Question' },
];

export function QuickCapture({
  open,
  onClose,
  projects,
  defaultProjectId,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  defaultProjectId?: string | null;
}) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<InboxKind>('idea');
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId ?? null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setProjectId(defaultProjectId ?? null);
      setTimeout(() => document.getElementById('quick-capture-body')?.focus(), 30);
    }
  }, [open, defaultProjectId]);

  const capture = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api.post('/inbox', { body, kind, projectId });
      setBody('');
      toast('Captured to inbox', 'success');
      window.dispatchEvent(new CustomEvent('loom:inbox-updated'));
      onClose();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <Modal
      title="Quick capture"
      description="Write now, organise later. It goes to your inbox."
      onClose={onClose}
      footer={
        <>
          <span className="tiny faint" style={{ marginRight: 'auto' }}>Ctrl/⌘ + Enter to capture</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !body.trim()} onClick={() => void capture()}>
            Capture
          </button>
        </>
      }
    >
      <div className="stack">
        <textarea
          id="quick-capture-body"
          className="textarea"
          style={{ minHeight: 170 }}
          value={body}
          placeholder="A thought, a paper, a question, something to do…"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void capture();
            }
          }}
        />
        <div className="row" style={{ gap: 10 }}>
          <label className="field grow">
            <span className="label">Kind</span>
            <select className="select" value={kind} onChange={(event) => setKind(event.target.value as InboxKind)}>
              {KINDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="field grow">
            <span className="label">Project</span>
            <select className="select" value={projectId ?? ''} onChange={(event) => setProjectId(event.target.value || null)}>
              <option value="">Unfiled</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}
