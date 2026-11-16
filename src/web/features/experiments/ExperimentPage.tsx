import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync } from '../../shared/hooks';
import { useAi } from '../../shared/aiContext';
import { Icon } from '../../shared/icons';
import { AttachmentsPanel, LinksPanel, TagEditor } from '../../shared/components';
import { ErrorState, Field, Loading, useConfirm, useToast } from '../../shared/ui';
import { EXPERIMENT_STATUSES, type ExperimentStatus } from '../../../shared/constants';
import type { Experiment, ObjectEnvelope, Project } from '../../../shared/types';

function environmentToText(environment: Record<string, string>): string {
  return Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n');
}
function textToEnvironment(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}
function metricsToText(metrics: { name: string; value: number; unit?: string }[]): string {
  return metrics.map((metric) => `${metric.name}=${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`).join('\n');
}
function textToMetrics(text: string): { name: string; value: number; unit?: string }[] {
  const result: { name: string; value: number; unit?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const name = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    const match = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(raw);
    if (!name || !match) continue;
    result.push({ name, value: Number(match[1]), ...(match[2] ? { unit: match[2] } : {}) });
  }
  return result;
}

export function ExperimentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const ai = useAi();
  const { toast } = useToast();
  const confirm = useConfirm();
  const state = useAsync(() => api.get<Experiment>(`/experiments/${id}`), [id]);
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${id}`), [id]);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [form, setForm] = useState<Experiment | null>(null);
  const [environmentText, setEnvironmentText] = useState('');
  const [metricsText, setMetricsText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (state.data) {
      setForm(state.data);
      setEnvironmentText(environmentToText(state.data.environment));
      setMetricsText(metricsToText(state.data.metrics));
    }
  }, [state.data]);

  if (state.loading) return <div className="page"><Loading rows={6} /></div>;
  if (state.error) return <div className="page"><ErrorState error={state.error} retry={state.reload} /></div>;
  if (!form) return null;

  const set = <K extends keyof Experiment>(key: K, value: Experiment[K]) => setForm({ ...form, [key]: value });

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Experiment>(`/experiments/${form.id}`, {
        title: form.title,
        status: form.status,
        objective: form.objective,
        hypothesis: form.hypothesis,
        method: form.method,
        results: form.results,
        environment: textToEnvironment(environmentText),
        metrics: textToMetrics(metricsText),
        startedAt: form.startedAt,
        endedAt: form.endedAt,
        projectId: form.projectId,
      });
      setForm(updated);
      envelope.reload();
      toast('Experiment saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete experiment?', message: 'It moves to trash with its links.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/experiments/${form.id}`);
      navigate(-1);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}><Icon name="chevron-left" size={15} /> Back</button>
        <div className="row">
          <span className={`badge ${form.status === 'completed' ? 'success' : form.status === 'running' ? 'info' : ''}`}>{form.status}</span>
          <button className="btn sm" onClick={() => ai.askAbout({ id: form.id, title: form.title, type: 'experiment' }, 'Interpret these results and suggest the next experiment.')}>
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
          <button className="btn danger sm" onClick={() => void remove()}>Delete</button>
        </div>
      </div>

      <input className="note-title-input" value={form.title} onChange={(event) => set('title', event.target.value)} />
      <div className="row" style={{ marginBottom: 18 }}>
        <select className="select" style={{ width: 150 }} value={form.status} onChange={(event) => set('status', event.target.value as ExperimentStatus)}>
          {EXPERIMENT_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
        <select className="select" style={{ width: 200 }} value={form.projectId ?? ''} onChange={(event) => set('projectId', event.target.value || null)}>
          <option value="">Unfiled</option>
          {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <button className="btn primary" disabled={busy} onClick={() => void save()}>Save experiment</button>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="card stack">
          <Field label="Objective"><textarea className="textarea" value={form.objective} onChange={(event) => set('objective', event.target.value)} /></Field>
          <Field label="Hypothesis"><textarea className="textarea" value={form.hypothesis} onChange={(event) => set('hypothesis', event.target.value)} /></Field>
          <Field label="Method"><textarea className="textarea" style={{ minHeight: 140 }} value={form.method} onChange={(event) => set('method', event.target.value)} /></Field>
        </div>
        <div className="stack">
          <div className="card stack">
            <Field label="Environment" help="One key=value per line: hardware, OS, compiler, config.">
              <textarea className="textarea" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }} value={environmentText} onChange={(event) => setEnvironmentText(event.target.value)} placeholder="gpu=A100&#10;cuda=12.4&#10;governor=performance" />
            </Field>
            <Field label="Metrics" help="One per line: name=value [unit].">
              <textarea className="textarea" style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }} value={metricsText} onChange={(event) => setMetricsText(event.target.value)} placeholder="energy_j=1420 J&#10;runtime_s=36.2 s" />
            </Field>
          </div>
          <div className="card stack">
            <Field label="Results"><textarea className="textarea" style={{ minHeight: 130 }} value={form.results} onChange={(event) => set('results', event.target.value)} /></Field>
            <Field label="Dates">
              <div className="row">
                <input className="input" type="date" value={form.startedAt ?? ''} onChange={(event) => set('startedAt', event.target.value || null)} />
                <input className="input" type="date" value={form.endedAt ?? ''} onChange={(event) => set('endedAt', event.target.value || null)} />
              </div>
            </Field>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
        <div className="card stack">
          <strong className="small">Attachments & data</strong>
          {envelope.data ? <AttachmentsPanel objectId={form.id} attachments={envelope.data.attachments} onChange={envelope.reload} /> : null}
        </div>
        <div className="stack">
          <div className="card">
            <strong className="small">Tags</strong>
            <div style={{ marginTop: 8 }}>
              {envelope.data ? <TagEditor objectId={form.id} initialTags={envelope.data.tags} /> : null}
            </div>
          </div>
          <div className="card"><LinksPanel objectId={form.id} /></div>
        </div>
      </div>
    </div>
  );
}
