import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { useAi } from '../../shared/aiContext';
import { AttachmentsPanel, LinksPanel, TagEditor, objectRoute } from '../../shared/components';
import { ErrorState, Field, Loading, Modal, useConfirm, useToast } from '../../shared/ui';
import { PRIORITIES, QUESTION_STATUSES, type Priority, type QuestionStatus } from '../../../shared/constants';
import type { ObjectEnvelope, Question, Task } from '../../../shared/types';

export function ObjectPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${id}`), [id]);

  useEffect(() => {
    const type = envelope.data?.object.type;
    if (type && type !== 'task' && type !== 'question') {
      navigate(objectRoute(type, id!), { replace: true });
    }
  }, [envelope.data, id, navigate]);

  if (envelope.loading) return <div className="page"><Loading rows={4} /></div>;
  if (envelope.error) return <div className="page"><ErrorState error={envelope.error} retry={envelope.reload} /></div>;
  if (!envelope.data) return null;
  if (envelope.data.object.type === 'task') return <TaskDetail envelope={envelope.data} onReload={envelope.reload} />;
  if (envelope.data.object.type === 'question') return <QuestionDetail envelope={envelope.data} onReload={envelope.reload} />;
  return <div className="page"><Loading /></div>;
}

function TaskDetail({ envelope, onReload }: { envelope: ObjectEnvelope; onReload: () => void }) {
  const navigate = useNavigate();
  const ai = useAi();
  const { toast } = useToast();
  const confirm = useConfirm();
  const state = useAsync(() => api.get<Task>(`/tasks/${envelope.object.id}`), [envelope.object.id]);
  const [form, setForm] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) setForm(state.data);
  }, [state.data]);

  if (state.loading) return <div className="page"><Loading rows={3} /></div>;
  if (state.error) return <div className="page"><ErrorState error={state.error} retry={state.reload} /></div>;
  if (!form) return null;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Task>(`/tasks/${form.id}`, {
        title: form.title,
        description: form.description,
        priority: form.priority,
        dueDate: form.dueDate,
        startDate: form.startDate,
        estimateMinutes: form.estimateMinutes,
      });
      setForm(updated);
      onReload();
      toast('Task saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    try {
      const updated = await api.post<Task>(`/tasks/${form.id}/complete`, { done: !form.completedAt });
      setForm(updated);
      onReload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete task?', message: 'It moves to trash.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/tasks/${form.id}`);
      navigate(`/projects/${form.projectId}/board`);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}><Icon name="chevron-left" size={15} /> Back</button>
        <div className="row">
          <Link className="btn sm" to={`/projects/${form.projectId}/board`}>Open board</Link>
          <button className="btn sm" onClick={() => ai.askAbout({ id: form.id, title: form.title, type: 'task' }, 'Help me break this task down.')}>
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
          <button className="btn danger sm" onClick={() => void remove()}>Delete</button>
        </div>
      </div>

      <div className="card stack">
        <div className="row">
          <input className="input grow" style={{ fontSize: 18, fontWeight: 600, border: 0, background: 'transparent', paddingLeft: 0 }} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          <button className={`btn ${form.completedAt ? '' : 'primary'}`} onClick={() => void complete()}>
            <Icon name="check" size={14} /> {form.completedAt ? 'Reopen' : 'Complete'}
          </button>
        </div>
        <div className="grid-2">
          <Field label="Priority">
            <select className="select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as Priority })}>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </Field>
          <Field label="Due date">
            <input className="input" type="date" value={form.dueDate ?? ''} onChange={(event) => setForm({ ...form, dueDate: event.target.value || null })} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="textarea" style={{ minHeight: 180 }} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="row between">
          <span className="tiny faint">
            {form.completedAt ? `Completed ${formatDate(form.completedAt)}` : 'Open'} · created {formatDate(form.createdAt)}
          </span>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Save task</button>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <strong className="small">Tags</strong>
          <div style={{ marginTop: 8 }}><TagEditor objectId={form.id} initialTags={envelope.tags} /></div>
        </div>
        <div className="card"><LinksPanel objectId={form.id} /></div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <AttachmentsPanel objectId={form.id} attachments={envelope.attachments} onChange={onReload} />
      </div>
    </div>
  );
}

function QuestionDetail({ envelope, onReload }: { envelope: ObjectEnvelope; onReload: () => void }) {
  const navigate = useNavigate();
  const ai = useAi();
  const { toast } = useToast();
  const confirm = useConfirm();
  const state = useAsync(() => api.get<Question>(`/questions/${envelope.object.id}`), [envelope.object.id]);
  const [form, setForm] = useState<Question | null>(null);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) setForm(state.data);
  }, [state.data]);

  if (state.loading) return <div className="page"><Loading rows={3} /></div>;
  if (state.error) return <div className="page"><ErrorState error={state.error} retry={state.reload} /></div>;
  if (!form) return null;

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Question>(`/questions/${form.id}`, {
        question: form.title,
        context: form.context,
        status: form.status,
      });
      setForm(updated);
      onReload();
      toast('Question saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const answer = async () => {
    setBusy(true);
    try {
      const updated = await api.post<Question>(`/questions/${form.id}/answer`, { text: answerText });
      setForm(updated);
      setAnswerOpen(false);
      onReload();
      if (updated.answerNoteId) navigate(`/notes/${updated.answerNoteId}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete question?', message: 'It moves to trash.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/questions/${form.id}`);
      navigate(-1);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="page narrow">
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}><Icon name="chevron-left" size={15} /> Back</button>
        <div className="row">
          <button className="btn sm" onClick={() => ai.askAbout({ id: form.id, title: form.title, type: 'question' }, 'What would help me answer this research question?')}>
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
          <button className="btn danger sm" onClick={() => void remove()}>Delete</button>
        </div>
      </div>

      <div className="card stack">
        <Field label="Research question">
          <textarea className="textarea" style={{ fontSize: 17, minHeight: 80 }} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </Field>
        <Field label="Context / why it matters">
          <textarea className="textarea" style={{ minHeight: 140 }} value={form.context} onChange={(event) => setForm({ ...form, context: event.target.value })} />
        </Field>
        <div className="row between">
          <select className="select" style={{ width: 170 }} value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as QuestionStatus })}>
            {QUESTION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <div className="row">
            {form.answerNoteId ? <Link className="btn" to={`/notes/${form.answerNoteId}`}>Open answer note</Link> : null}
            <button className="btn" onClick={() => setAnswerOpen(true)}>Answer with a note</button>
            <button className="btn primary" disabled={busy} onClick={() => void save()}>Save</button>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card">
          <strong className="small">Tags</strong>
          <div style={{ marginTop: 8 }}><TagEditor objectId={form.id} initialTags={envelope.tags} /></div>
        </div>
        <div className="card"><LinksPanel objectId={form.id} /></div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <AttachmentsPanel objectId={form.id} attachments={envelope.attachments} onChange={onReload} />
      </div>

      {answerOpen ? (
        <Modal
          title="Answer research question"
          onClose={() => setAnswerOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAnswerOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void answer()}>Create answer note</button>
            </>
          }
        >
          <Field label="Answer" help="A note is created, linked to this question, and marked as answered.">
            <textarea className="textarea" style={{ minHeight: 200 }} value={answerText} onChange={(event) => setAnswerText(event.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
