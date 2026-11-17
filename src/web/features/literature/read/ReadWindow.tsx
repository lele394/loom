import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ObjectEnvelope, Reference, ReferenceBookmark } from '../../../../shared/types';
import { api } from '../../../shared/api';
import { useAsync, useDocumentTitle } from '../../../shared/hooks';
import { Icon, type IconName } from '../../../shared/icons';
import { ErrorState, Loading } from '../../../shared/ui';
import { AiSummaryPanel } from '../ReferencePanels';
import { PdfAnnotator, type PdfAnnotatorHandle } from './PdfAnnotator';
import { ReadBookmarksPanel } from './ReadBookmarksPanel';
import { ReadChatPanel } from './ReadChatPanel';
import { ReadNotesPanel } from './ReadNotesPanel';
import { openReadWindow } from './readWindow';
import {
  mergeSaveStatus,
  SAVE_STATUS_LABEL,
  type ReadSaveStatus,
} from './status';

type PanelId = 'notes' | 'bookmarks' | 'summary' | 'chat';
type DockSide = 'left' | 'right';

interface PanelLayout {
  open: boolean;
  dock: DockSide;
  collapsed: boolean;
}

type LayoutState = Record<PanelId, PanelLayout>;
type PanelWeights = Record<PanelId, number>;

const PANELS: Record<PanelId, { title: string; icon: IconName }> = {
  notes: { title: 'Personal notes', icon: 'note' },
  bookmarks: { title: 'Bookmarks', icon: 'book' },
  summary: { title: 'AI summary', icon: 'sparkles' },
  chat: { title: 'AI chat', icon: 'sparkles' },
};
const PANEL_ORDER: PanelId[] = ['notes', 'bookmarks', 'summary', 'chat'];

const DEFAULT_LAYOUT: LayoutState = {
  notes: { open: true, dock: 'left', collapsed: false },
  bookmarks: { open: true, dock: 'right', collapsed: false },
  summary: { open: true, dock: 'right', collapsed: true },
  chat: { open: true, dock: 'right', collapsed: true },
};

const MIN_PANEL_SIZE = 1;

function readLayout(referenceId: string): LayoutState {
  try {
    const raw = localStorage.getItem(`loom-read-layout:${referenceId}`);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      notes: { ...DEFAULT_LAYOUT.notes, ...parsed.notes },
      bookmarks: { ...DEFAULT_LAYOUT.bookmarks, ...parsed.bookmarks },
      summary: { ...DEFAULT_LAYOUT.summary, ...parsed.summary },
      chat: { ...DEFAULT_LAYOUT.chat, ...parsed.chat },
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function readWeights(referenceId: string): PanelWeights {
  try {
    const raw = localStorage.getItem(`loom-read-weights:${referenceId}`);
    if (!raw) return { notes: 1, bookmarks: 1, summary: 1, chat: 1 };
    const parsed = JSON.parse(raw) as Partial<PanelWeights>;
    return {
      notes: parsed.notes ?? 1,
      bookmarks: parsed.bookmarks ?? 1,
      summary: parsed.summary ?? 1,
      chat: parsed.chat ?? 1,
    };
  } catch {
    return { notes: 1, bookmarks: 1, summary: 1, chat: 1 };
  }
}

function readWidths(referenceId: string): { left: number; right: number } {
  try {
    const raw = localStorage.getItem(`loom-read-widths:${referenceId}`);
    if (!raw) return { left: 320, right: 360 };
    const parsed = JSON.parse(raw) as { left?: number; right?: number };
    return {
      left: Number.isFinite(parsed.left) ? Math.max(MIN_PANEL_SIZE, parsed.left!) : 320,
      right: Number.isFinite(parsed.right) ? Math.max(MIN_PANEL_SIZE, parsed.right!) : 360,
    };
  } catch {
    return { left: 320, right: 360 };
  }
}

export function ReadWindow({ referenceId }: { referenceId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const referenceState = useAsync(() => api.get<Reference>(`/references/${referenceId}`), [referenceId]);
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${referenceId}`), [referenceId]);
  const [reference, setReference] = useState<Reference | null>(null);
  const [bookmarks, setBookmarks] = useState<ReferenceBookmark[]>([]);
  const [notes, setNotes] = useState('');
  const [notesStatus, setNotesStatus] = useState<ReadSaveStatus>('saved');
  const [pdfStatus, setPdfStatus] = useState<ReadSaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [layout, setLayout] = useState<LayoutState>(() => readLayout(referenceId));
  const [widths, setWidths] = useState(() => readWidths(referenceId));
  const [weights, setWeights] = useState<PanelWeights>(() => readWeights(referenceId));
  const [currentPage, setCurrentPage] = useState(1);
  const [dropTarget, setDropTarget] = useState<DockSide | null>(null);
  const viewerRef = useRef<PdfAnnotatorHandle | null>(null);
  const notesRef = useRef('');
  const savedNotesRef = useRef('');
  const noteSaveTimer = useRef<number | null>(null);
  const savingNotesRef = useRef(false);
  const initializedRef = useRef(false);

  const initialPage = Math.max(1, Number(params.get('page') ?? 1) || 1);
  useDocumentTitle(reference ? `${reference.title} — Reading` : 'Reading');

  useEffect(() => {
    localStorage.setItem(`loom-read-layout:${referenceId}`, JSON.stringify(layout));
  }, [layout, referenceId]);

  useEffect(() => {
    localStorage.setItem(`loom-read-widths:${referenceId}`, JSON.stringify(widths));
  }, [widths, referenceId]);

  useEffect(() => {
    localStorage.setItem(`loom-read-weights:${referenceId}`, JSON.stringify(weights));
  }, [weights, referenceId]);

  useEffect(() => {
    notesRef.current = notes;
  }, [notes]);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => {
      setOnline(false);
      setNotesStatus('offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!referenceState.data) return;
    const data = referenceState.data;
    setReference(data);
    if (!initializedRef.current) {
      initializedRef.current = true;
      notesRef.current = data.notes;
      savedNotesRef.current = data.notes;
      setNotes(data.notes);
      return;
    }
    if (notesRef.current === savedNotesRef.current) {
      savedNotesRef.current = data.notes;
      notesRef.current = data.notes;
      setNotes(data.notes);
    }
  }, [referenceState.data]);

  const loadBookmarks = useCallback(() => {
    api
      .get<{ bookmarks: ReferenceBookmark[] }>(`/references/${referenceId}/bookmarks`)
      .then((data) => setBookmarks(data.bookmarks))
      .catch(() => setBookmarks([]));
  }, [referenceId]);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const saveNotes = useCallback(async () => {
    if (savingNotesRef.current) return;
    const value = notesRef.current;
    if (value === savedNotesRef.current) {
      setNotesStatus('saved');
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setNotesStatus('offline');
      return;
    }
    savingNotesRef.current = true;
    setNotesStatus('saving');
    try {
      const updated = await api.patch<Reference>(`/references/${referenceId}`, { notes: value });
      const saved = updated.notes;
      savedNotesRef.current = saved;
      setLastSavedAt(new Date().toISOString());
      setReference((current) =>
        current ? { ...current, notes: saved, version: updated.version } : updated,
      );
      setNotesStatus(notesRef.current === saved ? 'saved' : 'dirty');
    } catch {
      setNotesStatus(navigator.onLine ? 'dirty' : 'offline');
    } finally {
      savingNotesRef.current = false;
    }
  }, [referenceId]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (notes === savedNotesRef.current) {
      setNotesStatus(navigator.onLine ? 'saved' : 'offline');
      return;
    }
    setNotesStatus(navigator.onLine ? 'dirty' : 'offline');
    if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = window.setTimeout(() => void saveNotes(), 2000);
    return () => {
      if (noteSaveTimer.current) window.clearTimeout(noteSaveTimer.current);
    };
  }, [notes, online, saveNotes]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (notesRef.current !== savedNotesRef.current) void saveNotes();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [saveNotes]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (notesRef.current === savedNotesRef.current) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const status = useMemo(
    () => (!online ? 'offline' : mergeSaveStatus(notesStatus, pdfStatus)),
    [notesStatus, pdfStatus, online],
  );

  const leftPanels = PANEL_ORDER.filter((id) => layout[id].open && layout[id].dock === 'left');
  const rightPanels = PANEL_ORDER.filter((id) => layout[id].open && layout[id].dock === 'right');

  const updatePanel = (id: PanelId, patch: Partial<PanelLayout>) => {
    const current = layout[id];
    const next = { ...current, ...patch };
    const wasVisible = current.open && !current.collapsed;
    const isVisible = next.open && !next.collapsed;
    const dockChanged = current.dock !== next.dock;
    if (isVisible && (!wasVisible || dockChanged)) {
      const siblings = PANEL_ORDER.filter(
        (candidate) =>
          candidate !== id &&
          layout[candidate].open &&
          !layout[candidate].collapsed &&
          layout[candidate].dock === next.dock,
      );
      const average = siblings.length
        ? siblings.reduce((sum, candidate) => sum + (weights[candidate] ?? 1), 0) / siblings.length
        : 1;
      setWeights((values) => ({ ...values, [id]: average }));
    }
    setLayout((values) => ({ ...values, [id]: { ...values[id], ...patch } }));
  };

  const togglePanel = (id: PanelId) => {
    const panel = layout[id];
    if (!panel.open) updatePanel(id, { open: true, collapsed: false });
    else if (panel.collapsed) updatePanel(id, { collapsed: false });
    else updatePanel(id, { open: false });
  };

  const movePanel = (id: PanelId, dock: DockSide) => {
    updatePanel(id, { dock, open: true });
  };

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
    setWidths({ left: 320, right: 360 });
    setWeights({ notes: 1, bookmarks: 1, summary: 1, chat: 1 });
  };

  const beginResize = (side: DockSide, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = side === 'left' ? widths.left : widths.right;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next = side === 'left' ? startWidth + delta : startWidth - delta;
      setWidths((current) => ({
        ...current,
        [side]: Math.max(MIN_PANEL_SIZE, next),
      }));
    };
    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const beginPanelResize = (
    first: PanelId,
    second: PanelId,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    const dock = event.currentTarget.parentElement;
    if (!dock) return;
    const measured: Partial<PanelWeights> = {};
    for (const element of dock.querySelectorAll<HTMLElement>('.dock-panel.expanded')) {
      const id = element.dataset.panel as PanelId | undefined;
      if (id) measured[id] = Math.round(element.getBoundingClientRect().height);
    }
    setWeights((current) => ({ ...current, ...measured }));
    const startY = event.clientY;
    const startFirst = measured[first] ?? 120;
    const startSecond = measured[second] ?? 120;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextFirst = Math.max(MIN_PANEL_SIZE, startFirst + delta);
      const nextSecond = Math.max(MIN_PANEL_SIZE, startSecond - delta);
      setWeights((current) => ({ ...current, [first]: nextFirst, [second]: nextSecond }));
    };
    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const insertBookmark = (bookmark: ReferenceBookmark) => {
    updatePanel('notes', { open: true, collapsed: false });
    const snippet = `\n> [[p.${bookmark.page}]]${bookmark.note ? ` — ${bookmark.note}` : ''}\n`;
    setNotes((current) => `${current}${current.endsWith('\n') || !current ? '' : '\n'}${snippet}`);
  };

  const goToPage = (page: number) => {
    viewerRef.current?.goToPage(page);
  };

  const handleReferenceUpdate = (updated: Reference) => {
    setReference((current) =>
      current
        ? {
            ...current,
            aiSummary: updated.aiSummary,
            aiSummaryModel: updated.aiSummaryModel,
            aiSummaryAt: updated.aiSummaryAt,
            aiSummaryInstructions: updated.aiSummaryInstructions,
          }
        : updated,
    );
    referenceState.reload();
  };

  if (referenceState.loading) {
    return (
      <div className="read-window read-window-loading">
        <Loading rows={5} />
      </div>
    );
  }
  if (referenceState.error) {
    return (
      <div className="read-window read-window-loading">
        <ErrorState error={referenceState.error} retry={referenceState.reload} />
      </div>
    );
  }
  if (!reference) return null;

  const pdf = envelope.data?.attachments.find((attachment) => attachment.kind === 'pdf');

  const renderPanel = (id: PanelId) => {
    const panel = layout[id];
    const definition = PANELS[id];
    const actions =
      id === 'bookmarks' ? (
        <span className="badge">{bookmarks.length}</span>
      ) : id === 'notes' ? (
        <span
          className={`read-save-dot ${!online ? 'offline' : notesStatus}`}
          title={SAVE_STATUS_LABEL[!online ? 'offline' : notesStatus]}
          aria-hidden
        />
      ) : null;
    return (
      <DockPanel
        key={id}
        id={id}
        title={definition.title}
        icon={definition.icon}
        collapsed={panel.collapsed}
        weight={weights[id] ?? 1}
        actions={actions}
        onToggle={() => updatePanel(id, { collapsed: !panel.collapsed })}
        onClose={() => updatePanel(id, { open: false })}
        onMove={() => movePanel(id, panel.dock === 'left' ? 'right' : 'left')}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-loom-panel', id);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        {id === 'notes' ? (
          <ReadNotesPanel
            value={notes}
            onChange={setNotes}
            onSave={() => void saveNotes()}
            status={!online ? 'offline' : notesStatus}
            lastSavedAt={lastSavedAt}
            bookmarks={bookmarks}
            onOpenPage={goToPage}
          />
        ) : null}
        {id === 'bookmarks' ? (
          <ReadBookmarksPanel
            referenceId={reference.id}
            currentPage={currentPage}
            bookmarks={bookmarks}
            onChanged={loadBookmarks}
            onOpenPage={goToPage}
            onInsert={insertBookmark}
          />
        ) : null}
        {id === 'summary' ? (
          <AiSummaryPanel reference={reference} onUpdated={handleReferenceUpdate} />
        ) : null}
        {id === 'chat' ? (
          <ReadChatPanel reference={reference} onOpenPage={goToPage} />
        ) : null}
      </DockPanel>
    );
  };

  const renderDockPanels = (ids: PanelId[]) => {
    const nodes: ReactNode[] = [];
    let previousExpanded: PanelId | null = null;
    for (const id of ids) {
      const expanded = !layout[id].collapsed;
      if (expanded && previousExpanded) {
        const first = previousExpanded;
        nodes.push(
          <div
            key={`split-${first}-${id}`}
            className="dock-splitter"
            role="separator"
            aria-orientation="horizontal"
            aria-label={`Resize ${PANELS[first].title} and ${PANELS[id].title}`}
            onPointerDown={(event) => beginPanelResize(first, id, event)}
          />,
        );
      }
      nodes.push(renderPanel(id));
      if (expanded) previousExpanded = id;
    }
    return nodes;
  };

  return (
    <div className="read-window">
      <header className="read-topbar">
        <div className="read-topbar-title">
          <span className="read-brand-mark">◫</span>
          <strong className="truncate" title={reference.title}>{reference.title}</strong>
          {reference.year ? <span className="badge">{reference.year}</span> : null}
          <span className="read-page-pill">p. {currentPage}</span>
        </div>

        <div className="read-topbar-status" title={lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}` : undefined}>
          <span className={`read-save-dot ${status}`} aria-hidden />
          <span className="small">{SAVE_STATUS_LABEL[status]}</span>
          <button className="btn ghost sm" disabled={status === 'saved' || status === 'saving'} onClick={() => void saveNotes()}>
            Save now
          </button>
        </div>

        <div className="read-topbar-panels" role="group" aria-label="Reading panels">
          {PANEL_ORDER.map((id) => (
            <button
              key={id}
              className={`read-panel-toggle ${layout[id].open ? 'active' : ''}`}
              aria-pressed={layout[id].open}
              title={`${layout[id].open ? 'Hide' : 'Show'} ${PANELS[id].title.toLowerCase()}`}
              onClick={() => togglePanel(id)}
            >
              <Icon name={PANELS[id].icon} size={14} />
              <span>{PANELS[id].title.replace('Personal ', '').replace('AI ', '')}</span>
            </button>
          ))}
        </div>

        <div className="read-topbar-actions">
          <button className="icon-btn sm" title="Reset panel layout" aria-label="Reset panel layout" onClick={resetLayout}>
            <Icon name="refresh" size={14} />
          </button>
          <button
            className="icon-btn sm"
            title="Open another reading tab"
            aria-label="Open another reading tab"
            onClick={() => openReadWindow(reference.id, { page: currentPage })}
          >
            <Icon name="external" size={14} />
          </button>
          {pdf ? (
            <a
              className="icon-btn sm"
              title="Open the original PDF in a new tab"
              aria-label="Open the original PDF in a new tab"
              href={`/api/v1/attachments/${pdf.id}/download?inline=1#page=${currentPage}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="book" size={14} />
            </a>
          ) : null}
          <button className="btn sm" onClick={() => navigate(`/literature/${reference.id}`)}>
            Reference
          </button>
          <button className="icon-btn sm" title="Close this tab" aria-label="Close this tab" onClick={() => window.close()}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="read-workspace">
        {leftPanels.length ? (
          <>
            <aside
              className={`read-dock ${dropTarget === 'left' ? 'drop-target' : ''}`}
              style={{ width: widths.left }}
              aria-label="Left reading panels"
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget('left');
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                const id = event.dataTransfer.getData('application/x-loom-panel') as PanelId;
                if (id in layout) movePanel(id, 'left');
              }}
            >
              {renderDockPanels(leftPanels)}
            </aside>
            <div className="read-splitter" role="separator" aria-orientation="vertical" onPointerDown={(event) => beginResize('left', event)} />
          </>
        ) : null}

        <main className="read-article">
          {pdf ? (
            <PdfAnnotator
              attachmentId={pdf.id}
              title={reference.title}
              initialPage={initialPage}
              onPageChange={setCurrentPage}
              onStatusChange={setPdfStatus}
              handleRef={viewerRef}
            />
          ) : (
            <div className="read-article-empty">
              <Icon name="book" size={28} />
              <strong>No PDF attached</strong>
              <p className="small muted">Attach a PDF from the reference page to read and annotate it here.</p>
              <button className="btn sm" onClick={() => navigate(`/literature/${reference.id}`)}>Open reference</button>
            </div>
          )}
        </main>

        {rightPanels.length ? (
          <>
            <div className="read-splitter" role="separator" aria-orientation="vertical" onPointerDown={(event) => beginResize('right', event)} />
            <aside
              className={`read-dock ${dropTarget === 'right' ? 'drop-target' : ''}`}
              style={{ width: widths.right }}
              aria-label="Right reading panels"
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget('right');
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                const id = event.dataTransfer.getData('application/x-loom-panel') as PanelId;
                if (id in layout) movePanel(id, 'right');
              }}
            >
              {renderDockPanels(rightPanels)}
            </aside>
          </>
        ) : null}
      </div>
    </div>
  );
}

function DockPanel({
  id,
  title,
  icon,
  collapsed,
  weight,
  actions,
  onToggle,
  onClose,
  onMove,
  onDragStart,
  children,
}: {
  id: PanelId;
  title: string;
  icon: IconName;
  collapsed: boolean;
  weight: number;
  actions?: ReactNode;
  onToggle: () => void;
  onClose: () => void;
  onMove: () => void;
  onDragStart: (event: React.DragEvent<HTMLSpanElement>) => void;
  children: ReactNode;
}) {
  return (
    <section
      className={`dock-panel ${collapsed ? 'collapsed' : 'expanded'}`}
      data-panel={id}
      style={collapsed ? undefined : { flexGrow: weight, flexShrink: 1, flexBasis: 0 }}
    >
      <header className="dock-panel-head">
        <span
          className="dock-grip"
          draggable
          onDragStart={onDragStart}
          title="Drag to the other dock"
          aria-hidden
        >
          ⋮⋮
        </span>
        <button
          type="button"
          className="dock-toggle-zone"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
          <Icon name={icon} size={14} />
          <strong className="dock-title truncate">{title}</strong>
          {actions}
          <span className="grow" />
        </button>
        <button className="icon-btn sm" title="Move to the other side" aria-label="Move panel to the other side" onClick={onMove}>
          <Icon name="panel" size={13} />
        </button>
        <button className="icon-btn sm" title="Close panel" aria-label={`Close ${title}`} onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </header>
      {!collapsed ? <div className="dock-panel-body">{children}</div> : null}
    </section>
  );
}
