import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, useDebounced, relativeTime } from '../../shared/hooks';
import { useSession } from '../../app/session';
import { Icon } from '../../shared/icons';
import { Empty, ErrorState, Loading } from '../../shared/ui';
import { TypeBadge, objectRoute } from '../../shared/components';
import { OBJECT_TYPES, type ObjectType } from '../../../shared/constants';
import type { ObjectSummary, Project, SearchResponse } from '../../../shared/types';

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span>
      {parts.map((part, index) =>
        part.startsWith('«') && part.endsWith('»') ? <mark key={index}>{part.slice(1, -1)}</mark> : <span key={index}>{part}</span>,
      )}
    </span>
  );
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { meta } = useSession();
  const q = params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const debounced = useDebounced(input, 300);
  const [mode, setMode] = useState<'text' | 'hybrid' | 'semantic'>((params.get('mode') as 'text' | 'hybrid' | 'semantic') ?? 'text');
  const [type, setType] = useState<ObjectType | ''>('');
  const [projectId, setProjectId] = useState('');
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);

  useEffect(() => {
    if (debounced === q) return;
    const next = new URLSearchParams(params);
    if (debounced.trim()) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const results = useAsync(
    async () => {
      if (!debounced.trim()) return null;
      const search = new URLSearchParams({ q: debounced, mode, limit: '50' });
      if (type) search.set('type', type);
      if (projectId) search.set('projectId', projectId);
      return api.get<SearchResponse>(`/search?${search.toString()}`);
    },
    [debounced, mode, type, projectId],
  );

  const recent = useAsync(
    () => api.get<{ objects: ObjectSummary[] }>('/objects?limit=24').then((data) => data.objects),
    [],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Search</h1>
          <p className="page-sub">Across notes, tasks, literature, experiments and questions.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <Icon name="search" />
          <input
            autoFocus
            className="input grow"
            style={{ border: 0, background: 'transparent', fontSize: 17, boxShadow: 'none', paddingLeft: 0 }}
            placeholder="Search your research…"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="seg">
            {(['text', 'hybrid', 'semantic'] as const).map((value) => (
              <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{value}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <select className="select" style={{ width: 160, height: 32 }} value={type} onChange={(event) => setType(event.target.value as ObjectType | '')}>
            <option value="">All types</option>
            {OBJECT_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select className="select" style={{ width: 190, height: 32 }} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">All projects</option>
            <option value="global">Unfiled / global</option>
            {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          {mode !== 'text' && !meta?.capabilities.semanticSearch ? (
            <span className="tiny faint">Semantic index is empty — configure embeddings in Settings.</span>
          ) : null}
        </div>
      </div>

      {results.loading ? <Loading rows={5} /> : null}
      {results.error ? <ErrorState error={results.error} retry={results.reload} /> : null}

      {results.data ? (
        <>
          <div className="meta-line" style={{ marginBottom: 10 }}>
            <span>{results.data.total} result{results.data.total === 1 ? '' : 's'}</span>
            <span>·</span>
            <span>{results.data.tookMs} ms</span>
            {results.data.engines.length ? <><span>·</span><span>engines: {results.data.engines.join(' + ')}</span></> : null}
          </div>
          {results.data.results.length === 0 ? (
            <div className="card">
              <Empty title="No results" icon="search">
                Try a broader query or switch to hybrid retrieval. PDF text is searchable only after extraction.
              </Empty>
            </div>
          ) : (
            <div className="card flush">
              <div className="list">
                {results.data.results.map((result) => (
                  <Link className="list-row" key={result.objectId} to={objectRoute(result.type, result.objectId)}>
                    <Icon name={result.type === 'reference' ? 'book' : result.type === 'task' ? 'task' : result.type === 'experiment' ? 'flask' : 'note'} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="title truncate">{result.title}</span>
                        <TypeBadge type={result.type} />
                        {result.projectName ? <span className="tiny faint">{result.projectName}</span> : null}
                      </div>
                      <div className="small muted" style={{ marginTop: 3 }}>
                        <Snippet text={result.snippet} />
                      </div>
                    </div>
                    <span className="tiny faint">{relativeTime(result.updatedAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {!debounced.trim() ? (
        <>
          <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)', marginBottom: 10 }}>Recently updated</h3>
          {recent.loading ? <Loading rows={4} /> : null}
          {recent.data?.length === 0 ? <div className="card"><Empty title="Nothing here yet" icon="sparkles">Create a note or add a reference to get started.</Empty></div> : null}
          <div className="card flush">
            <div className="list">
              {(recent.data ?? []).map((object) => (
                <button
                  key={object.id}
                  className="list-row"
                  style={{ border: 0, background: 'none', textAlign: 'left', width: '100%', cursor: 'pointer' }}
                  onClick={() => navigate(objectRoute(object.type, object.id))}
                >
                  <Icon name={object.type === 'reference' ? 'book' : object.type === 'task' ? 'task' : 'note'} />
                  <span className="grow">
                    <span className="title" style={{ display: 'block' }}>{object.title}</span>
                    <span className="tiny faint">{object.subtitle || '—'}</span>
                  </span>
                  <TypeBadge type={object.type} />
                  <span className="tiny faint">{relativeTime(object.updatedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
