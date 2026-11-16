import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate, timeOf } from '../../shared/hooks';
import { ErrorState, Loading } from '../../shared/ui';
import { objectRoute } from '../../shared/components';
import { OBJECT_TYPES } from '../../../shared/constants';
import type { ActivityEvent, Project } from '../../../shared/types';

export function ActivityPage() {
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [projectId, setProjectId] = useState('');
  const [type, setType] = useState('');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '60' });
    if (projectId) params.set('projectId', projectId);
    if (type) params.set('type', type);
    api
      .get<{ events: ActivityEvent[] }>(`/activity?${params.toString()}`)
      .then((data) => !cancelled && setEvents(data.events))
      .catch((err: Error) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, type, reloadTick]);

  const loadMore = async () => {
    if (!events.length) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ limit: '60', before: String(events[events.length - 1]!.seq) });
      if (projectId) params.set('projectId', projectId);
      if (type) params.set('type', type);
      const data = await api.get<{ events: ActivityEvent[] }>(`/activity?${params.toString()}`);
      setEvents((current) => [...current, ...data.events]);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  };

  const projectNames = new Map((projects.data ?? []).map((project) => [project.id, project.name]));

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="page-sub">Every mutation is recorded by the server, append-only.</p>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <select className="select" style={{ width: 210 }} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
          <option value="">All projects</option>
          {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
        <select className="select" style={{ width: 150 }} value={type} onChange={(event) => setType(event.target.value)}>
          <option value="">All types</option>
          {OBJECT_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <Link className="btn sm" to="/journal">Journal →</Link>
      </div>

      {loading ? <Loading rows={6} /> : null}
      {error ? <ErrorState error={error} retry={() => setReloadTick((value) => value + 1)} /> : null}

      {!loading && !error ? (
        <div className="card">
          {events.length === 0 ? <div className="empty"><strong>No activity</strong><span className="small">Actions will appear here.</span></div> : null}
          <div className="timeline">
            {events.map((event) => (
              <div className="timeline-row" key={event.id}>
                <div className="when">{timeOf(event.occurredAt)}</div>
                <div className="what">
                  <span className="timeline-dot" />
                  {event.objectId ? (
                    <Link to={objectRoute(event.objectType ?? 'note', event.objectId)}>{event.summary}</Link>
                  ) : event.summary}
                  {event.projectId && projectNames.get(event.projectId) ? (
                    <span className="tiny faint"> · {projectNames.get(event.projectId)}</span>
                  ) : null}
                  <div className="tiny faint" style={{ marginLeft: 14 }}>{formatDate(event.occurredAt)}</div>
                </div>
              </div>
            ))}
          </div>
          {events.length >= 60 ? (
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more'}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
