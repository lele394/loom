import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../shared/api';
import { useDebounced } from '../shared/hooks';
import { Icon } from '../shared/icons';
import { objectRoute } from '../shared/components';
import type { ObjectSummary, Project } from '../../shared/types';
import { useSession } from './session';
import { useAi } from '../shared/aiContext';

interface Suggestion {
  objectId: string;
  type: string;
  title: string;
}

interface Action {
  id: string;
  label: string;
  kind: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  projects,
  onCapture,
}: {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onCapture: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { meta, updateAppearance } = useSession();
  const { addContext } = useAi();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const projectId = /^\/projects\/([^/]+)/.exec(location.pathname)?.[1] ?? null;

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSuggestions([]);
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ results: Suggestion[] }>(`/search/suggest?q=${encodeURIComponent(debounced)}`)
      .then((data) => !cancelled && setSuggestions(data.results))
      .catch(() => !cancelled && setSuggestions([]));
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  if (!open) return null;

  const actions: Action[] = [
    {
      id: 'note',
      label: 'New note',
      kind: 'Create',
      icon: 'note',
      run: () => {
        onClose();
        void api
          .post<{ id: string }>('/notes', { title: 'Untitled note', projectId, template: 'research' })
          .then((note) => navigate(`/notes/${note.id}`))
          .catch(() => navigate('/notes'));
      },
    },
    {
      id: 'task',
      label: 'New task',
      kind: 'Create',
      icon: 'task',
      run: () => {
        onClose();
        navigate(projectId ? `/projects/${projectId}/board?new=1` : '/');
      },
    },
    {
      id: 'capture',
      label: 'Quick capture',
      kind: 'Create',
      icon: 'plus',
      run: () => {
        onClose();
        onCapture();
      },
    },
    { id: 'dashboard', label: 'Dashboard', kind: 'Go', icon: 'dashboard', run: () => { onClose(); navigate('/'); } },
    { id: 'library', label: 'Library', kind: 'Go', icon: 'book', run: () => { onClose(); navigate('/library'); } },
    { id: 'inbox', label: 'Inbox', kind: 'Go', icon: 'inbox', run: () => { onClose(); navigate('/inbox'); } },
    { id: 'journal', label: 'Journal', kind: 'Go', icon: 'journal', run: () => { onClose(); navigate('/journal'); } },
    { id: 'activity', label: 'Activity', kind: 'Go', icon: 'activity', run: () => { onClose(); navigate('/activity'); } },
    { id: 'settings', label: 'Settings', kind: 'Go', icon: 'settings', run: () => { onClose(); navigate('/settings'); } },
    {
      id: 'theme',
      label: `Switch to ${meta?.appearance.mode === 'dark' ? 'light' : 'dark'} mode`,
      kind: 'Theme',
      icon: 'moon',
      run: () => {
        void updateAppearance({ mode: meta?.appearance.mode === 'dark' ? 'light' : 'dark' });
        onClose();
      },
    },
    ...projects.slice(0, 6).map((project) => ({
      id: `project-${project.id}`,
      label: project.name,
      kind: 'Project',
      icon: 'folder' as const,
      run: () => {
        onClose();
        navigate(`/projects/${project.id}`);
      },
    })),
  ];

  const filtered = query.trim()
    ? actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
    : actions;
  const items: { id: string; label: string; kind: string; icon: React.ComponentProps<typeof Icon>['name']; run: () => void }[] = [
    ...filtered.map((action) => ({ ...action })),
    ...suggestions.map((suggestion) => ({
      id: suggestion.objectId,
      label: suggestion.title,
      kind: suggestion.type,
      icon: (suggestion.type === 'reference' ? 'book' : suggestion.type === 'task' ? 'task' : 'note') as React.ComponentProps<typeof Icon>['name'],
      run: () => {
        onClose();
        navigate(objectRoute(suggestion.type, suggestion.objectId));
      },
    })),
    ...(query.trim()
      ? [
          {
            id: 'search-all',
            label: `Search everything for “${query.trim()}”`,
            kind: 'Search',
            icon: 'search' as const,
            run: () => {
              onClose();
              navigate(`/search?q=${encodeURIComponent(query.trim())}`);
            },
          },
        ]
      : []),
  ];

  const move = (delta: number) => {
    setActive((current) => (items.length ? (current + delta + items.length) % items.length : 0));
  };

  return (
    <div className="overlay palette-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette">
        <input
          ref={inputRef}
          value={query}
          placeholder="Search or run a command…"
          aria-label="Command palette"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              move(1);
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              move(-1);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              items[active]?.run();
            }
          }}
        />
        <div className="palette-list">
          {items.length === 0 ? <div className="palette-empty">Nothing matches.</div> : null}
          {items.map((item, index) => (
            <div
              key={item.id}
              className={`palette-item ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => item.run()}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              <span className="kind">{item.kind}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
