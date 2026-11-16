import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Empty, ErrorState, Field, Loading, Modal, useToast } from '../../shared/ui';
import { EXPERIMENT_STATUSES, type ExperimentStatus } from '../../../shared/constants';
import type { ProjectOutlet } from '../../shared/projectContext';
import type { Experiment } from '../../../shared/types';

export function ExperimentsPage() {
  const outlet = useOutletContext<ProjectOutlet | undefined>();
  const projectId = outlet?.project?.id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const experiments = useAsync(
    () => api.get<{ experiments: Experiment[] }>(`/experiments?limit=100${projectId ? `&projectId=${projectId}` : ''}`),
    [projectId],
  );
  const projects = useAsync(() => api.get<{ projects: { id: string; name: string }[] }>('/projects').then((data) => data.projects), []);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [status, setStatus] = useState<ExperimentStatus>('planned');
  const [selectedProject, setSelectedProject] = useState(projectId ?? '');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const experiment = await api.post<Experiment>('/experiments', {
        title,
        objective,
        status,
        projectId: selectedProject || null,
      });
      setOpen(false);
      setTitle('');
      setObjective('');
      navigate(`/experiments/${experiment.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const list = experiments.data?.experiments ?? [];

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Experiments</h2>
          <p className="small muted">Structured records: objective, environment, results and datasets.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Icon name="plus" size={15} /> New experiment
        </button>
      </div>

      {experiments.loading ? <Loading rows={4} /> : null}
      {experiments.error ? <ErrorState error={experiments.error} retry={experiments.reload} /> : null}
      {!experiments.loading && list.length === 0 ? (
        <div className="card">
          <Empty title="No experiments yet" icon="flask" action={<button className="btn primary" onClick={() => setOpen(true)}>Start an experiment</button>}>
            Record the hypothesis, environment and results, then compare runs with the assistant.
          </Empty>
        </div>
      ) : null}

      {list.length ? (
        <div className="card flush">
          <table className="table">
            <thead>
              <tr><th>Experiment</th><th>Status</th><th className="hide-sm">Objective</th><th className="hide-sm">Updated</th></tr>
            </thead>
            <tbody>
              {list.map((experiment) => (
                <tr key={experiment.id} className="clickable" onClick={() => navigate(`/experiments/${experiment.id}`)}>
                  <td><Link to={`/experiments/${experiment.id}`} style={{ fontWeight: 500 }}>{experiment.title}</Link></td>
                  <td><span className={`badge ${experiment.status === 'completed' ? 'success' : experiment.status === 'running' ? 'info' : experiment.status === 'abandoned' ? 'danger' : ''}`}>{experiment.status}</span></td>
                  <td className="hide-sm small muted truncate" style={{ maxWidth: 420 }}>{experiment.objective || '—'}</td>
                  <td className="hide-sm tiny faint">{formatDate(experiment.startedAt ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {open ? (
        <Modal
          title="New experiment"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy || !title.trim()} onClick={() => void create()}>Create</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Title"><input className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
            <Field label="Objective"><textarea className="textarea" value={objective} onChange={(event) => setObjective(event.target.value)} /></Field>
            <div className="grid-2">
              <Field label="Status">
                <select className="select" value={status} onChange={(event) => setStatus(event.target.value as ExperimentStatus)}>
                  {EXPERIMENT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              {!projectId ? (
                <Field label="Project">
                  <select className="select" value={selectedProject} onChange={(event) => setSelectedProject(event.target.value)}>
                    <option value="">Unfiled</option>
                    {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                </Field>
              ) : null}
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
