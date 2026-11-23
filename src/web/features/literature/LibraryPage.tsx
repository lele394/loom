import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Project, Reference } from '../../../shared/types';
import type { ReadingStatus } from '../../../shared/constants';
import { api } from '../../shared/api';
import { formatDate, useAsync } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Empty, ErrorState, Loading } from '../../shared/ui';

interface LibraryData {
  projects: Project[];
  references: Reference[];
}

type StatusFilter = 'all' | ReadingStatus;
type SortMode = 'recent' | 'title' | 'year';

interface Shelf {
  id: string;
  name: string;
  color?: Project['color'];
  project?: Project;
  references: Reference[];
  allCount: number;
}

async function loadLibrary(): Promise<LibraryData> {
  const referencesRequest = async () => {
    const references: Reference[] = [];
    for (let offset = 0; offset <= 10_000; offset += 200) {
      const page = await api.get<{ references: Reference[] }>(`/references?limit=200&offset=${offset}`);
      references.push(...page.references);
      if (page.references.length < 200) break;
    }
    return references;
  };
  const [{ projects }, references] = await Promise.all([
    api.get<{ projects: Project[] }>('/projects?includeArchived=1'),
    referencesRequest(),
  ]);
  return { projects, references };
}

function statusName(status: ReadingStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function LibraryPage() {
  const library = useAsync(loadLibrary, []);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortMode>('recent');
  const [showEmptyShelves, setShowEmptyShelves] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const projects = library.data?.projects ?? [];
  const references = library.data?.references ?? [];
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const visibleReferences = useMemo(() => {
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const filtered = references.filter((reference) => {
      if (status !== 'all' && reference.readingStatus !== status) return false;
      if (!normalizedQuery) return true;
      const projectName = projectNames.get(reference.projectId ?? '') ?? 'unassigned';
      const searchText = [
        reference.title,
        reference.authors.join(' '),
        reference.year,
        reference.venue,
        reference.doi,
        reference.abstract,
        projectName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      return searchText.includes(normalizedQuery);
    });
    return filtered.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      if (sort === 'year') return (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title);
      return b.addedAt.localeCompare(a.addedAt);
    });
  }, [normalizedQuery, projects, references, sort, status]);

  const shelves = useMemo<Shelf[]>(() => {
    const byProject = new Map<string, Reference[]>();
    const allByProject = new Map<string, number>();
    for (const reference of references) {
      const key = reference.projectId ?? '__unassigned__';
      allByProject.set(key, (allByProject.get(key) ?? 0) + 1);
    }
    for (const reference of visibleReferences) {
      const key = reference.projectId ?? '__unassigned__';
      const items = byProject.get(key) ?? [];
      items.push(reference);
      byProject.set(key, items);
    }
    const projectShelves: Shelf[] = projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        color: project.color,
        project,
        references: byProject.get(project.id) ?? [],
        allCount: allByProject.get(project.id) ?? 0,
      }))
      .filter((shelf) => showEmptyShelves || shelf.references.length > 0);
    const unassigned = byProject.get('__unassigned__');
    if (unassigned?.length) {
      projectShelves.push({
        id: '__unassigned__',
        name: 'Unassigned',
        references: unassigned,
        allCount: allByProject.get('__unassigned__') ?? unassigned.length,
      });
    }
    return projectShelves;
  }, [projects, references, showEmptyShelves, visibleReferences]);

  const statusCounts = useMemo(
    () => ({
      all: references.length,
      unread: references.filter((reference) => reference.readingStatus === 'unread').length,
      reading: references.filter((reference) => reference.readingStatus === 'reading').length,
      reviewed: references.filter((reference) => reference.readingStatus === 'reviewed').length,
      archived: references.filter((reference) => reference.readingStatus === 'archived').length,
    }),
    [references],
  );
  const activeProjects = projects.filter((project) => project.status === 'active').length;

  const toggleShelf = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (library.loading) {
    return <div className="page"><Loading rows={7} /></div>;
  }
  if (library.error) {
    return <div className="page"><ErrorState error={library.error} retry={library.reload} /></div>;
  }
  if (!library.data) return null;

  return (
    <div className="page library-page">
      <header className="library-hero">
        <div className="library-hero-copy">
          <div className="library-eyebrow"><Icon name="book" size={14} /> YOUR RESEARCH COLLECTION</div>
          <h1>Library</h1>
          <p>Every paper, gathered into shelves for your projects.</p>
        </div>
        <button className="btn" onClick={library.reload} title="Refresh library">
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </header>

      <div className="library-stats">
        <div className="library-stat">
          <span className="library-stat-icon"><Icon name="book" size={16} /></span>
          <span className="library-stat-value">{references.length}</span>
          <span className="library-stat-label">papers</span>
        </div>
        <div className="library-stat">
          <span className="library-stat-icon"><Icon name="folder" size={16} /></span>
          <span className="library-stat-value">{activeProjects}</span>
          <span className="library-stat-label">active shelves</span>
        </div>
        <div className="library-stat">
          <span className="library-stat-icon unread"><Icon name="book" size={16} /></span>
          <span className="library-stat-value">{statusCounts.unread}</span>
          <span className="library-stat-label">to read</span>
        </div>
      </div>

      <section className="library-tools" aria-label="Library filters">
        <label className="library-search">
          <Icon name="search" size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search papers, authors, DOI, or shelf…"
            aria-label="Search the library"
          />
          {query ? (
            <button className="icon-btn sm" onClick={() => setQuery('')} aria-label="Clear search">
              <Icon name="close" size={13} />
            </button>
          ) : null}
        </label>
        <select
          className="select library-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortMode)}
          aria-label="Sort papers"
        >
          <option value="recent">Recently added</option>
          <option value="title">Title A–Z</option>
          <option value="year">Newest publication year</option>
        </select>
      </section>

      <div className="library-filter-row" role="group" aria-label="Filter by reading status">
        {([
          ['all', 'All papers', statusCounts.all],
          ['unread', 'To read', statusCounts.unread],
          ['reading', 'Reading', statusCounts.reading],
          ['reviewed', 'Reviewed', statusCounts.reviewed],
          ['archived', 'Archived', statusCounts.archived],
        ] as [StatusFilter, string, number][]).map(([value, label, count]) => (
          <button
            key={value}
            className={`library-filter ${status === value ? 'active' : ''}`}
            onClick={() => setStatus(value)}
          >
            {label}<span>{count}</span>
          </button>
        ))}
        <label className="library-empty-toggle">
          <input
            type="checkbox"
            checked={showEmptyShelves}
            onChange={(event) => setShowEmptyShelves(event.target.checked)}
          />
          Show empty shelves
        </label>
      </div>

      {shelves.length > 1 ? (
        <nav className="library-shelf-jump" aria-label="Jump to a shelf">
          <span className="tiny faint">JUMP TO</span>
          {shelves.map((shelf) => (
            <a key={shelf.id} href={`#shelf-${shelf.id}`}>
              {shelf.name}<span>{shelf.references.length}</span>
            </a>
          ))}
        </nav>
      ) : null}

      <div className="library-results-heading">
        <div>
          <h2>Shelves</h2>
          <span className="small muted">
            {visibleReferences.length} {visibleReferences.length === 1 ? 'paper' : 'papers'}
            {normalizedQuery || status !== 'all' ? ' match your filters' : ' across your projects'}
          </span>
        </div>
      </div>

      {shelves.length ? (
        <div className="library-shelves">
          {shelves.map((shelf) => {
            const isCollapsed = collapsed.has(shelf.id);
            const projectHref = shelf.project ? `/projects/${shelf.project.id}/literature` : null;
            return (
              <section className="library-shelf" key={shelf.id} id={`shelf-${shelf.id}`}>
                <div className="library-shelf-head">
                  <button
                    className="library-shelf-toggle"
                    onClick={() => toggleShelf(shelf.id)}
                    aria-expanded={!isCollapsed}
                    aria-controls={`shelf-content-${shelf.id}`}
                  >
                    <span className="library-shelf-mark" data-color={shelf.color}>
                      <Icon name={shelf.project ? 'folder' : 'inbox'} size={17} />
                    </span>
                    <span className="library-shelf-name">
                      <strong>{shelf.name}</strong>
                      {shelf.project?.status === 'archived' ? <span className="badge">Archived project</span> : null}
                    </span>
                    <span className="library-shelf-count">
                      {shelf.references.length} {shelf.references.length === 1 ? 'paper' : 'papers'}
                    </span>
                    <Icon name="chevron-down" size={15} className={isCollapsed ? 'library-chevron collapsed' : 'library-chevron'} />
                  </button>
                  {projectHref ? (
                  <Link className="library-open-shelf" to={projectHref}>Open shelf <Icon name="chevron-right" size={13} /></Link>
                  ) : null}
                </div>
                {!isCollapsed ? (
                  <div className="library-shelf-content" id={`shelf-content-${shelf.id}`}>
                    {shelf.references.length ? (
                      <div className="library-books">
                        {shelf.references.map((reference) => (
                          <Link className="library-book" to={`/literature/${reference.id}`} key={reference.id}>
                            <span className={`library-book-spine status-${reference.readingStatus}`} aria-hidden="true">
                              <Icon name="book" size={15} />
                            </span>
                            <span className="library-book-main">
                              <strong className="library-book-title">{reference.title}</strong>
                              <span className="library-book-authors">
                                {reference.authors.slice(0, 3).join(', ') || 'Author not recorded'}
                                {reference.authors.length > 3 ? ' et al.' : ''}
                              </span>
                              <span className="library-book-meta">
                                {[reference.year, reference.venue, reference.doi ? `DOI ${reference.doi}` : null]
                                  .filter(Boolean)
                                  .join(' · ') || 'Publication details not recorded'}
                              </span>
                            </span>
                            <span className={`library-status status-${reference.readingStatus}`}>
                              {statusName(reference.readingStatus)}
                            </span>
                            <span className="library-book-added">Added {formatDate(reference.addedAt)}</span>
                            <Icon name="chevron-right" size={15} className="library-book-chevron" />
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="library-shelf-empty">
                        <span className="library-empty-book"><Icon name="book" size={16} /></span>
                        <span>
                          <strong>{shelf.allCount ? 'No papers match the current filters.' : 'This shelf is waiting for its first paper.'}</strong>
                          <span className="small muted">
                            {shelf.allCount
                              ? `${shelf.allCount} ${shelf.allCount === 1 ? 'paper is' : 'papers are'} on this shelf. Adjust the filters to see them.`
                              : 'Add literature from this project to keep the collection organized.'}
                          </span>
                        </span>
                        {projectHref ? <Link className="btn sm" to={projectHref}>Go to project literature</Link> : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="card library-no-results">
          {references.length === 0 ? (
            <Empty title="Your library is ready" icon="book">
              Add literature from any project and it will appear here, organized on its shelf.
            </Empty>
          ) : (
            <Empty title="No papers match these filters" icon="search">
              Try another search or reading status.
            </Empty>
          )}
        </div>
      )}
    </div>
  );
}
