import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate, shiftDate, timeOf, todayIso } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Markdown } from '../../shared/markdown';
import { objectRoute, typeIcon } from '../../shared/components';
import { Empty, ErrorState, Field, Loading, Modal, useToast } from '../../shared/ui';
import type { ActivityEvent, DailyDiff, Digest, Project } from '../../../shared/types';

interface JournalResponse {
  digest: Digest | null;
  diff: DailyDiff;
  events: ActivityEvent[];
}

function nextSteps(summary: string | null): string[] {
  if (!summary) return [];
  const lines = summary.split(/\r?\n/);
  let inSection = false;
  const steps: string[] = [];
  for (const line of lines) {
    if (/^##\s+next steps/i.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line.trim())) break;
    if (inSection) {
      const match = /^\s*[-*]\s+(.*)$/.exec(line);
      if (match) steps.push(match[1]!.replace(/\[[ x]\]\s*/i, '').trim());
    }
  }
  return steps.filter(Boolean);
}

export function JournalPage() {
  const { date: routeDate } = useParams<{ date?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const date = routeDate ?? todayIso();
  const state = useAsync(() => api.get<JournalResponse>(`/journal/${date}`), [date]);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [generating, setGenerating] = useState(false);
  const [taskModal, setTaskModal] = useState(false);
  const [steps, setSteps] = useState<{ text: string; checked: boolean }[]>([]);
  const [projectId, setProjectId] = useState('');
  const [creating, setCreating] = useState(false);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<{ id: string; summaryMarkdown: string; model: string | null; createdAt: string }[]>([]);

  useEffect(() => {
    if (!projectId && projects.data?.length) setProjectId(projects.data[0]!.id);
  }, [projects.data, projectId]);

  const generate = async (force: boolean) => {
    setGenerating(true);
    try {
      const { jobId } = await api.post<{ jobId: string | null }>(`/journal/${date}/generate`, { force });
      if (!jobId) {
        toast('Digest already up to date', 'success');
        return;
      }
      toast('Digest queued — this can take up to a minute with a reasoning model.', 'info');
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const job = await api.get<{ status: string; last_error: string | null }>(`/jobs/${jobId}`);
        if (job.status === 'failed' || job.status === 'dead') {
          const fresh = await api.get<JournalResponse>(`/journal/${date}`);
          state.setData(fresh);
          toast(job.last_error ?? 'The journal digest could not be generated.', 'error');
          return;
        }
        if (job.status === 'succeeded') {
          const fresh = await api.get<JournalResponse>(`/journal/${date}`);
          state.setData(fresh);
          toast(fresh.digest?.summaryMarkdown ? 'AI interpretation ready' : 'Journal entry generated', 'success');
          return;
        }
      }
      toast('The digest is still running. Check Settings → Jobs for progress.', 'info');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  if (state.loading) return <div className="page"><Loading rows={6} /></div>;
  if (state.error) return <div className="page"><ErrorState error={state.error} retry={state.reload} /></div>;
  if (!state.data) return null;
  const { digest, diff, events } = state.data;
  const stepsToCreate = nextSteps(digest?.summaryMarkdown ?? null);

  const openRevisions = async () => {
    setRevisionsOpen(true);
    try {
      const data = await api.get<{ revisions: typeof revisions }>(`/journal/${date}/revisions`);
      setRevisions(data.revisions);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const openTasks = () => {
    if (!stepsToCreate.length) {
      toast('No “Next steps” bullets found in the summary.', 'error');
      return;
    }
    setSteps(stepsToCreate.map((text) => ({ text, checked: true })));
    setTaskModal(true);
  };

  const createTasks = async () => {
    if (!projectId) {
      toast('Choose a project first.', 'error');
      return;
    }
    setCreating(true);
    try {
      const selected = steps.filter((step) => step.checked);
      for (const step of selected) {
        await api.post('/tasks', { title: step.text.slice(0, 300), projectId });
      }
      toast(`Created ${selected.length} task(s)`, 'success');
      setTaskModal(false);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Research journal</h1>
          <p className="page-sub">A deterministic diff of the day, interpreted only when AI is configured.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => navigate(`/journal/${shiftDate(date, -1)}`)}><Icon name="chevron-left" size={15} /></button>
          <button className="btn" onClick={() => navigate('/journal')}>Today</button>
          <button className="btn" onClick={() => navigate(`/journal/${shiftDate(date, 1)}`)}><Icon name="chevron-right" size={15} /></button>
          <button className="btn" onClick={() => void openRevisions()}>History</button>
          <button className="btn primary" disabled={generating} onClick={() => void generate(Boolean(digest))}>
            {generating ? 'Generating…' : digest ? 'Regenerate summary' : 'Generate summary'}
          </button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <input className="input" type="date" style={{ width: 170 }} value={date} onChange={(event) => navigate(`/journal/${event.target.value}`)} />
        <span className="small muted">{formatDate(date)}</span>
        {digest?.stale ? <span className="badge warning">Newer activity exists — regenerate</span> : null}
        {digest?.model ? <span className="badge info">{digest.model}</span> : null}
      </div>

      <div className="diff-grid" style={{ marginBottom: 18 }}>
        <div className="diff-stat"><div className="n">{diff.totals.added}</div><div className="label">Added</div></div>
        <div className="diff-stat"><div className="n">{diff.totals.updated}</div><div className="label">Updated</div></div>
        <div className="diff-stat"><div className="n">{diff.totals.completed}</div><div className="label">Completed</div></div>
        <div className="diff-stat"><div className="n">{diff.totals.removed}</div><div className="label">Removed</div></div>
        {diff.commitCount ? <div className="diff-stat"><div className="n">{diff.commitCount}</div><div className="label">Commits</div></div> : null}
      </div>

      <div className="dash-grid" style={{ alignItems: 'start' }}>
        <div className="stack">
          {diff.byProject.length === 0 ? (
            <div className="card"><Empty title="No activity recorded" icon="journal">Nothing was created, changed or completed on this day.</Empty></div>
          ) : null}
          {diff.byProject.map((group) => (
            <div className="diff-group" key={group.projectId ?? 'global'}>
              <div className="row between">
                <h4>{group.projectName}</h4>
                <span className="tiny faint">{group.eventCount} events</span>
              </div>
              {(['added', 'updated', 'completed', 'removed'] as const).map((bucket) => {
                const items = group[bucket];
                if (!items.length) return null;
                return (
                  <div key={bucket} style={{ marginTop: 8 }}>
                    <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{bucket}</div>
                    {items.map((item) => (
                      <div className="diff-item" key={`${bucket}-${item.id}`}>
                        <Icon name={typeIcon[item.type] ?? 'note'} size={13} />
                        <Link to={objectRoute(item.type, item.id)}>{item.title}</Link>
                        {item.fields?.length ? <span className="tiny faint">({item.fields.join(', ')})</span> : null}
                      </div>
                    ))}
                  </div>
                );
              })}
              {group.commits?.length ? (
                <div style={{ marginTop: 8 }}>
                  <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>commits</div>
                  {group.commits.map((commit) => (
                    <div className="diff-item" key={`${commit.repositoryId}-${commit.sha}`}>
                      <Icon name="git" size={13} />
                      <a href={commit.url} target="_blank" rel="noreferrer" title={commit.title}>
                        {commit.title}
                      </a>
                      <span className="tiny faint">
                        {commit.repositoryName} · {commit.shortSha} · {commit.authorName}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 8 }}>
              <strong className="small">AI interpretation</strong>
              {digest?.summaryMarkdown ? <span className="tiny faint">{digest.model ?? ''}</span> : null}
            </div>
            {digest?.status === 'failed' ? (
              <p className="small" style={{ color: 'var(--danger)' }}>
                The last AI generation failed. Check Settings → Jobs for the provider error, then try again.
              </p>
            ) : null}
            {digest?.summaryMarkdown ? (
              <Markdown text={digest.summaryMarkdown} />
            ) : digest?.status !== 'failed' ? (
              <p className="small faint">
                No AI summary. The deterministic diff above is the source of truth; configure a provider to add interpretation.
              </p>
            ) : null}
            {digest?.summaryMarkdown ? (
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn sm" onClick={openTasks}>Next steps → tasks</button>
                <button className="btn sm" onClick={() => void navigator.clipboard.writeText(digest.summaryMarkdown ?? '')}>Copy</button>
              </div>
            ) : null}
            {!digest ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm primary" disabled={generating} onClick={() => void generate(false)}>Generate deterministic entry</button>
              </div>
            ) : null}
          </div>

          <div className="card">
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>Raw activity ({events.length})</summary>
              <div className="timeline" style={{ marginTop: 12 }}>
                {events.map((event) => (
                  <div className="timeline-row" key={event.id}>
                    <div className="when">{timeOf(event.occurredAt)}</div>
                    <div className="what">
                      {event.objectId ? <Link to={objectRoute(event.objectType ?? 'note', event.objectId)}>{event.summary}</Link> : event.summary}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      </div>

      {revisionsOpen ? (
        <Modal title={`Previous summaries — ${date}`} onClose={() => setRevisionsOpen(false)} wide>
          <div className="stack">
            {revisions.length === 0 ? <Empty title="No previous summaries" icon="clock">Regenerating a digest archives the previous interpretation here.</Empty> : null}
            {revisions.map((revision) => (
              <details key={revision.id} className="card tight">
                <summary style={{ cursor: 'pointer', fontSize: 13 }}>
                  {formatDate(revision.createdAt)} · {revision.model ?? 'unknown model'}
                </summary>
                <div style={{ marginTop: 10 }}>
                  <Markdown text={revision.summaryMarkdown} />
                </div>
              </details>
            ))}
          </div>
        </Modal>
      ) : null}

      {taskModal ? (
        <Modal
          title="Create tasks from next steps"
          onClose={() => setTaskModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setTaskModal(false)}>Cancel</button>
              <button className="btn primary" disabled={creating} onClick={() => void createTasks()}>Create selected</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Project">
              <select className="select" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </Field>
            {steps.map((step, index) => (
              <label className="checkbox" key={index} style={{ alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={step.checked}
                  onChange={(event) => setSteps((current) => current.map((item, i) => i === index ? { ...item, checked: event.target.checked } : item))}
                />
                <span>{step.text}</span>
              </label>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
