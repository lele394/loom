import { Link } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { useProject } from '../../shared/projectContext';
import { Icon } from '../../shared/icons';
import { ActivityFeed, TypeBadge } from '../../shared/components';
import { ErrorState, Loading } from '../../shared/ui';
import type { ActivityEvent, Note, Question, Reference, Task } from '../../../shared/types';

interface Overview {
  counts: {
    notes: number;
    tasks: number;
    openTasks: number;
    references: number;
    experiments: number;
    questions: number;
  };
  dueToday: Task[];
  openQuestions: Question[];
  recentActivity: ActivityEvent[];
}

export function ProjectOverview() {
  const { project, reload } = useProject();
  const overview = useAsync(() => api.get<Overview>(`/projects/${project.id}/overview`), [project.id]);
  const notes = useAsync(() => api.get<{ notes: Note[] }>(`/notes?projectId=${project.id}&limit=5`), [project.id]);
  const references = useAsync(
    () => api.get<{ references: Reference[] }>(`/references?projectId=${project.id}&limit=5`),
    [project.id],
  );

  if (overview.loading) return <Loading rows={4} />;
  if (overview.error) return <ErrorState error={overview.error} retry={overview.reload} />;
  if (!overview.data) return null;
  const data = overview.data;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stat-row">
        <div className="stat"><div className="value">{data.counts.notes}</div><div className="label">Notes</div></div>
        <div className="stat"><div className="value">{data.counts.openTasks}</div><div className="label">Open tasks</div></div>
        <div className="stat"><div className="value">{data.counts.references}</div><div className="label">References</div></div>
        <div className="stat"><div className="value">{data.counts.experiments}</div><div className="label">Experiments</div></div>
      </div>

      <div className="grid-2">
        <div className="card flush">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong className="small">Due today</strong>
            <Link className="small" to={`/projects/${project.id}/board`}>Board →</Link>
          </div>
          {data.dueToday.length === 0 ? (
            <div className="empty" style={{ padding: 26 }}><span className="small">Nothing due today.</span></div>
          ) : (
            <div className="list">
              {data.dueToday.map((task) => (
                <div className="list-row" key={task.id}>
                  <Icon name="task" size={15} />
                  <span className="grow small">{task.title}</span>
                  <span className="badge">{task.priority}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card flush">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong className="small">Open questions</strong>
            <Link className="small" to={`/projects/${project.id}/questions`}>All →</Link>
          </div>
          {data.openQuestions.length === 0 ? (
            <div className="empty" style={{ padding: 26 }}><span className="small">No open research questions.</span></div>
          ) : (
            <div className="list">
              {data.openQuestions.map((question) => (
                <div className="list-row" key={question.id}>
                  <Icon name="help" size={15} />
                  <span className="grow small">{question.title}</span>
                  <span className="badge">{question.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card flush">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong className="small">Recent notes</strong>
            <Link className="small" to={`/projects/${project.id}/notes`}>All →</Link>
          </div>
          {notes.loading ? <Loading rows={2} /> : null}
          {notes.data?.notes.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><span className="small">No notes yet.</span></div>
          ) : (
            <div className="list">
              {notes.data?.notes.map((note) => (
                <Link className="list-row" key={note.id} to={`/notes/${note.id}`}>
                  <Icon name="note" size={15} />
                  <span className="grow small truncate">{note.title}</span>
                  <span className="tiny faint">{formatDate(note.updatedAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card flush">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <strong className="small">Recent literature</strong>
            <Link className="small" to={`/projects/${project.id}/literature`}>All →</Link>
          </div>
          {references.loading ? <Loading rows={2} /> : null}
          {references.data?.references.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><span className="small">No references yet.</span></div>
          ) : (
            <div className="list">
              {references.data?.references.map((reference) => (
                <Link className="list-row" key={reference.id} to={`/literature/${reference.id}`}>
                  <Icon name="book" size={15} />
                  <span className="grow small truncate">{reference.title}</span>
                  <span className="tiny faint">{reference.year ?? ''}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <strong className="small">Project activity</strong>
          <button className="btn sm" onClick={reload}>Refresh</button>
        </div>
        <ActivityFeed events={data.recentActivity.slice(0, 12)} />
      </div>

      <div className="row">
        <TypeBadge type="note" />
        <span className="tiny faint">Tip: write [[Title]] inside a note to link another object automatically.</span>
      </div>
    </div>
  );
}
