import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate, todayIso } from '../../shared/hooks';
import { useSession } from '../../app/session';
import { Icon } from '../../shared/icons';
import { ActivityFeed, NewProjectModal } from '../../shared/components';
import { Empty, Loading, ErrorState, useToast } from '../../shared/ui';
import type { DashboardData, Digest, Task } from '../../../shared/types';

function greeting(hour: number): string {
  if (hour < 6) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard() {
  const navigate = useNavigate();
  const { meta } = useSession();
  const { toast } = useToast();
  const dashboard = useAsync(() => api.get<DashboardData>('/dashboard'), []);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => dashboard.reload();
    window.addEventListener('loom:inbox-updated', refresh);
    return () => window.removeEventListener('loom:inbox-updated', refresh);
  }, [dashboard.reload]);

  if (dashboard.loading) {
    return (
      <div className="page">
        <Loading rows={6} />
      </div>
    );
  }
  if (dashboard.error) return <div className="page"><ErrorState error={dashboard.error} retry={dashboard.reload} /></div>;
  if (!dashboard.data) return null;
  const data = dashboard.data;
  const now = new Date();
  const digest: Digest | null = data.yesterdayDigest;

  const completeTask = async (task: Task) => {
    setCompleting(task.id);
    try {
      await api.post(`/tasks/${task.id}/complete`, { done: true });
      dashboard.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCompleting(null);
    }
  };

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>{greeting(now.getHours())}, {data.greetingName || 'researcher'}.</h1>
          <div className="date">{formatDate(now)} · {data.projects.length} active project{data.projects.length === 1 ? '' : 's'}</div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/notes?new=1')}>
            <Icon name="note" size={15} /> New note
          </button>
          <button className="btn primary" onClick={() => setNewProjectOpen(true)}>
            <Icon name="plus" size={15} /> New project
          </button>
        </div>
      </div>

      {!meta?.capabilities.ai ? (
        <div className="banner">
          <Icon name="sparkles" size={16} />
          <span className="grow">AI is off. The notebook, board, search and journal work without it.</span>
          <Link to="/settings?tab=ai" className="small">Configure a provider →</Link>
        </div>
      ) : null}

      <div className="stat-row">
        <div className="stat">
          <div className="value">{data.openTaskCount}</div>
          <div className="label">Open tasks</div>
        </div>
        <div className="stat">
          <div className="value">{data.dueTasks.length}</div>
          <div className="label">Due today / overdue</div>
        </div>
        <div className="stat">
          <div className="value">{data.inboxCount}</div>
          <div className="label">Inbox to triage</div>
        </div>
        <div className="stat">
          <div className="value">{data.openQuestionCount}</div>
          <div className="label">Open questions</div>
        </div>
      </div>

      <section style={{ marginBottom: 24 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 15 }}>Your workspace</h2>
        </div>
        {data.projects.length === 0 ? (
          <div className="card">
            <Empty
              title="No projects yet"
              icon="folder"
              action={<button className="btn primary" onClick={() => setNewProjectOpen(true)}>Create your first project</button>}
            >
              Projects group notes, literature, experiments and tasks around one research direction.
            </Empty>
          </div>
        ) : (
          <div className="grid-auto">
            {data.projects.map((project) => (
              <Link to={`/projects/${project.id}`} className="card project-card" key={project.id}>
                <div className="row">
                  <span className="dot" data-color={project.color} />
                  <span className="name grow">{project.name}</span>
                  <Icon name="chevron-right" size={15} />
                </div>
                <div className="small muted" style={{ minHeight: 34 }}>
                  {project.description || 'No description yet.'}
                </div>
                <div className="meta-line">
                  <span>{project.counts?.notes ?? 0} notes</span>
                  <span>·</span>
                  <span>{project.counts?.openTasks ?? 0} open tasks</span>
                  <span>·</span>
                  <span>{project.counts?.references ?? 0} refs</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="dash-grid">
        <div className="stack">
          <div className="card flush">
            <div className="row between" style={{ padding: '13px 15px', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ fontSize: 14 }}>Today</strong>
              <Link className="small" to="/journal">Open journal →</Link>
            </div>
            {data.dueTasks.length === 0 ? (
              <div className="empty" style={{ padding: '28px 18px' }}>
                <strong>Nothing due today</strong>
                <span className="small">A clear runway. Pick an open question or capture a new idea.</span>
              </div>
            ) : (
              <div className="list">
                {data.dueTasks.map((task) => (
                  <div className="list-row" key={task.id}>
                    <button
                      className="icon-btn sm"
                      aria-label="Complete task"
                      disabled={completing === task.id}
                      onClick={() => void completeTask(task)}
                    >
                      <Icon name="check" size={14} />
                    </button>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="title truncate">{task.title}</div>
                      <div className="tiny faint">
                        {task.dueDate ? `Due ${formatDate(task.dueDate)}` : 'No due date'} · {task.priority}
                      </div>
                    </div>
                    {task.projectId ? (
                      <Link className="badge" to={`/projects/${task.projectId}/board`}>Board</Link>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>Recent activity</strong>
              <Link className="small" to="/activity">All activity →</Link>
            </div>
            <ActivityFeed events={data.recentActivity.slice(0, 8)} projects={data.projects} />
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 14 }}>Yesterday</strong>
              <Link className="small" to={`/journal/${digest?.date ?? todayIso()}`}>Journal →</Link>
            </div>
            {digest ? (
              <>
                <div className="meta-line" style={{ marginBottom: 8 }}>
                  <span>{digest.diff.totals.added} added</span>
                  <span>·</span>
                  <span>{digest.diff.totals.updated} updated</span>
                  <span>·</span>
                  <span>{digest.diff.totals.completed} completed</span>
                </div>
                {digest.summaryMarkdown ? (
                  <div className="small muted" style={{ maxHeight: 150, overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                    {digest.summaryMarkdown.replace(/[#*]/g, '').slice(0, 420)}
                    {digest.summaryMarkdown.length > 420 ? '…' : ''}
                  </div>
                ) : (
                  <p className="small faint">No AI summary yet. The deterministic diff is ready to read.</p>
                )}
              </>
            ) : (
              <p className="small faint">No journal entry for yesterday. Open the journal to generate the diff.</p>
            )}
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: 10 }}>
              <strong style={{ fontSize: 14 }}>Research inbox</strong>
              <Link className="small" to="/inbox">{data.inboxCount} to triage →</Link>
            </div>
            <p className="small muted">
              Capture now, organise later. Press <span className="kbd">Ctrl Shift Space</span> anywhere.
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent('loom:quick-capture'))}>
                <Icon name="plus" size={14} /> Quick capture
              </button>
            </div>
          </div>

          <div className="card">
            <strong style={{ fontSize: 14 }}>Search</strong>
            <p className="small muted" style={{ marginTop: 6 }}>
              Full text always works. Semantic search activates when an embedding model is configured.
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <Link className="btn sm" to="/search"><Icon name="search" size={14} /> Search everything</Link>
            </div>
          </div>
        </div>
      </div>

      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          setNewProjectOpen(false);
          navigate(`/projects/${project.id}`);
        }}
      />
    </div>
  );
}
