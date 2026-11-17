import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync } from '../../shared/hooks';
import { useAi } from '../../shared/aiContext';
import { Icon } from '../../shared/icons';
import { ErrorState, Field, Loading, Modal, useConfirm, useToast } from '../../shared/ui';
import { PALETTES, type Palette } from '../../../shared/constants';
import type { Project } from '../../../shared/types';
import type { ProjectOutlet } from '../../shared/projectContext';

export function ProjectLayout() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const ai = useAi();
  const projectState = useAsync(() => api.get<Project>(`/projects/${id}`), [id]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<Palette>('lavender');
  const [busy, setBusy] = useState(false);

  if (projectState.loading) return <div className="page"><Loading rows={5} /></div>;
  if (projectState.error) return <div className="page"><ErrorState error={projectState.error} retry={projectState.reload} /></div>;
  if (!projectState.data) return null;
  const project = projectState.data;

  const openSettings = () => {
    setName(project.name);
    setDescription(project.description);
    setColor(project.color);
    setSettingsOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/projects/${project.id}`, { name, description, color });
      toast('Project updated', 'success');
      setSettingsOpen(false);
      projectState.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    const ok = await confirm({
      title: project.status === 'archived' ? 'Unarchive project?' : 'Archive project?',
      message:
        project.status === 'archived'
          ? 'The project becomes editable again.'
          : 'Archived projects are read-only. Nothing is deleted.',
      confirmLabel: project.status === 'archived' ? 'Unarchive' : 'Archive',
    });
    if (!ok) return;
    try {
      await api.post(`/projects/${project.id}/archive`, { archived: project.status !== 'archived' });
      projectState.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete project?',
      message: 'The project and everything in it move to trash. You can restore them from Settings → Trash.',
      confirmLabel: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/projects/${project.id}`);
      toast('Project moved to trash', 'success');
      navigate('/');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const tabs = [
    { to: `/projects/${project.id}`, label: 'Overview', end: true },
    { to: `/projects/${project.id}/board`, label: 'Board' },
    { to: `/projects/${project.id}/notes`, label: 'Notes' },
    { to: `/projects/${project.id}/literature`, label: 'Literature' },
    { to: `/projects/${project.id}/experiments`, label: 'Experiments' },
    { to: `/projects/${project.id}/questions`, label: 'Questions' },
    { to: `/projects/${project.id}/code`, label: 'Code' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="row" style={{ gap: 8 }}>
            <span className="dot" data-color={project.color} />
            <h1 className="page-title">{project.name}</h1>
            {project.status === 'archived' ? <span className="badge warning">Archived</span> : null}
          </div>
          <p className="page-sub">{project.description || 'No description yet.'}</p>
          <div className="meta-line" style={{ marginTop: 8 }}>
            <span>{project.counts?.notes ?? 0} notes</span>
            <span>·</span>
            <span>{project.counts?.openTasks ?? 0} open tasks</span>
            <span>·</span>
            <span>{project.counts?.references ?? 0} references</span>
            <span>·</span>
            <span>{project.counts?.experiments ?? 0} experiments</span>
          </div>
        </div>
        <div className="actions">
          <button
            className="btn"
            onClick={() => {
              ai.setProjectId(project.id);
              ai.setScope('project');
              ai.setOpen(true);
            }}
          >
            <Icon name="sparkles" size={15} /> Ask AI
          </button>
          <button className="btn" onClick={openSettings}>Project settings</button>
          <button className="btn" onClick={() => void archive()}>
            <Icon name="archive" size={15} /> {project.status === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      <nav className="tabs">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Outlet context={{ project, reload: projectState.reload } satisfies ProjectOutlet} />

      {settingsOpen ? (
        <Modal
          title="Project settings"
          onClose={() => setSettingsOpen(false)}
          footer={
            <>
              <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => void remove()}>Delete project</button>
              <button className="btn" onClick={() => setSettingsOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>Save</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Name">
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field label="Description">
              <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field label="Colour">
              <div className="row" style={{ gap: 7 }}>
                {PALETTES.map((palette) => (
                  <button
                    key={palette}
                    type="button"
                    className="tag"
                    style={{ padding: '4px 9px', borderColor: color === palette ? 'var(--accent)' : undefined }}
                    onClick={() => setColor(palette)}
                  >
                    <span className="dot" data-color={palette} /> {palette}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
