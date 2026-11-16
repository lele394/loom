import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './session';
import { useAi } from '../shared/aiContext';
import { api } from '../shared/api';
import { useAsync } from '../shared/hooks';
import { Icon, type IconName } from '../shared/icons';
import { Menu, Modal } from '../shared/ui';
import type { Project } from '../../shared/types';
import { CommandPalette } from './CommandPalette';
import { QuickCapture } from './QuickCapture';
import { AiPanel } from './AiPanel';
import { NewProjectModal } from '../shared/components';

const NAV: { to: string; label: string; icon: IconName; exact?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
  { to: '/inbox', label: 'Inbox', icon: 'inbox' },
  { to: '/journal', label: 'Journal', icon: 'journal' },
  { to: '/activity', label: 'Activity', icon: 'activity' },
  { to: '/search', label: 'Search', icon: 'search' },
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl / ⌘ + K', 'Command palette'],
    ['Ctrl / ⌘ + Shift + Space', 'Quick capture'],
    ['N', 'New note in the current project'],
    ['T', 'New task in the current project'],
    ['G then D / I / J / A', 'Dashboard / Inbox / Journal / Activity'],
    ['?', 'This help'],
    ['Esc', 'Close overlays'],
  ];
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} slim>
      <div className="stack sm">
        {rows.map(([keys, action]) => (
          <div className="row between" key={keys}>
            <span className="small muted">{action}</span>
            <span className="kbd">{keys}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, meta, updateAppearance, logout, logoLabel } = useSession();
  const ai = useAi();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), [location.pathname]);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  const currentProjectId = useMemo(() => {
    const match = /^\/projects\/([^/]+)/.exec(location.pathname);
    return match?.[1] ?? null;
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'Space') {
        event.preventDefault();
        setCaptureOpen(true);
        return;
      }
      if (typing) return;
      if (event.key === '?') {
        setHelpOpen(true);
        return;
      }
      if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey) {
        void api
          .post<{ id: string }>('/notes', { title: 'Untitled note', projectId: currentProjectId, template: 'research' })
          .then((note) => navigate(`/notes/${note.id}`))
          .catch(() => navigate('/notes?new=1'));
        return;
      }
      if (event.key.toLowerCase() === 't' && !event.metaKey && !event.ctrlKey) {
        if (currentProjectId) navigate(`/projects/${currentProjectId}/board?new=1`);
        return;
      }
      if (event.key.toLowerCase() === 'g') {
        const timer = window.setTimeout(() => undefined, 900);
        const next = (nextEvent: KeyboardEvent) => {
          window.clearTimeout(timer);
          window.removeEventListener('keydown', next);
          const map: Record<string, string> = { d: '/', i: '/inbox', j: '/journal', a: '/activity' };
          const target = map[nextEvent.key.toLowerCase()];
          if (target) navigate(target);
        };
        window.addEventListener('keydown', next, { once: true });
      }
    };
    const openCapture = () => setCaptureOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('loom:quick-capture', openCapture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('loom:quick-capture', openCapture);
    };
  }, [navigate, currentProjectId]);

  const projectList = projects.data ?? [];
  const aiOpen = ai.open;

  return (
    <div className={`app-shell ${aiOpen ? 'ai-open' : ''}`}>
      <aside className="rail">
        <Link className="rail-brand" to="/" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="mark">◫</span>
          <span>{logoLabel}</span>
        </Link>
        <nav className="stack" style={{ gap: 2 }}>
          {NAV.map((item) => {
            const active = item.exact ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return (
              <Link key={item.to} className={`rail-link ${active ? 'active' : ''}`} to={item.to} title={item.label}>
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="row between" style={{ padding: '14px 10px 2px' }}>
          <span className="rail-section" style={{ padding: 0 }}>Projects</span>
          <button className="icon-btn sm" aria-label="New project" onClick={() => setNewProjectOpen(true)}>
            <Icon name="plus" size={14} />
          </button>
        </div>
        <nav className="stack" style={{ gap: 1 }}>
          {projectList.map((project) => (
            <Link
              key={project.id}
              to={`/projects/${project.id}`}
              className={`rail-project ${currentProjectId === project.id ? 'active' : ''}`}
              title={project.name}
            >
              <span className="dot" data-color={project.color} />
              <span className="name">{project.name}</span>
            </Link>
          ))}
          {projects.loading ? <span className="rail-link"><span className="skeleton" style={{ width: 120, height: 10 }} /></span> : null}
          {!projects.loading && projectList.length === 0 ? (
            <button className="rail-project" style={{ border: 0, background: 'none', width: '100%' }} onClick={() => setNewProjectOpen(true)}>
              <Icon name="plus" size={14} /> <span className="name">Create a project</span>
            </button>
          ) : null}
        </nav>
        <div className="rail-footer">
          <button className="rail-link" style={{ border: 0, background: 'none', width: '100%' }} onClick={() => ai.setOpen(!ai.open)}>
            <Icon name="sparkles" />
            <span>AI assistant</span>
          </button>
          <Link className={`rail-link ${location.pathname.startsWith('/settings') ? 'active' : ''}`} to="/settings" title="Settings">
            <Icon name="settings" />
            <span>Settings</span>
          </Link>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="search-button" onClick={() => setPaletteOpen(true)} aria-label="Search everything">
            <Icon name="search" size={16} />
            <span className="hide-sm">Search your research…</span>
            <span className="hint" style={{ marginLeft: 'auto' }}><span className="kbd">Ctrl K</span></span>
          </button>
          <button className="icon-btn" onClick={() => setCaptureOpen(true)} title="Quick capture (Ctrl+Shift+Space)" aria-label="Quick capture">
            <Icon name="plus" />
          </button>
          <button
            className={`icon-btn ${ai.open ? 'active' : ''}`}
            onClick={() => ai.setOpen(!ai.open)}
            title="AI assistant"
            aria-label="Toggle AI assistant"
            style={ai.open ? { background: 'var(--accent-soft)', color: 'var(--text)' } : undefined}
          >
            <Icon name="sparkles" />
          </button>
          <div className="spacer" />
          <span className="hide-sm small muted">{meta?.app.instanceName}</span>
          <Menu
            trigger={
              <button className="icon-btn" aria-label="Appearance" title="Appearance">
                <Icon name={meta?.appearance.mode === 'dark' ? 'moon' : meta?.appearance.mode === 'light' ? 'sun' : 'monitor'} />
              </button>
            }
            items={[
              { label: 'Light', icon: 'sun', onClick: () => void updateAppearance({ mode: 'light' }) },
              { label: 'Dark', icon: 'moon', onClick: () => void updateAppearance({ mode: 'dark' }) },
              { label: 'System', icon: 'monitor', onClick: () => void updateAppearance({ mode: 'system' }) },
            ]}
          />
          <Menu
            trigger={
              <button className="icon-btn" aria-label="Account" title={user?.displayName}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'var(--accent-soft)',
                    color: 'var(--accent)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {(user?.displayName ?? user?.username ?? '?').slice(0, 1).toUpperCase()}
                </span>
              </button>
            }
            items={[
              { label: 'Settings', icon: 'settings', onClick: () => navigate('/settings') },
              { label: 'Keyboard shortcuts', icon: 'command', onClick: () => setHelpOpen(true) },
              { label: 'Sign out', icon: 'external', onClick: () => void logout() },
            ]}
          />
        </header>
        <main className="content" ref={contentRef}>{children}</main>
      </div>

      {aiOpen ? <AiPanel /> : null}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} projects={projectList} onCapture={() => setCaptureOpen(true)} />
      <QuickCapture open={captureOpen} onClose={() => setCaptureOpen(false)} projects={projectList} defaultProjectId={currentProjectId} />
      <NewProjectModal
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreated={(project) => {
          setNewProjectOpen(false);
          projects.reload();
          navigate(`/projects/${project.id}`);
        }}
      />
      <ShortcutsModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
