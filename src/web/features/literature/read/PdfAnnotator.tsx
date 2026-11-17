import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../../../shared/api';
import { Icon } from '../../../shared/icons';
import { Modal, Spinner, useToast } from '../../../shared/ui';
import { PDF_HIGHLIGHT_COLORS, type PdfAnnotationKind } from '../../../../shared/constants';
import type {
  PdfAnnotation,
  PdfAnnotationGeometry,
  PdfPoint,
  PdfRect,
} from '../../../../shared/types';
import type { ReadSaveStatus } from './status';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type Tool = 'select' | 'text' | 'highlight' | 'ink' | 'note' | 'eraser';

type UndoEntry =
  | { kind: 'created'; annotation: PdfAnnotation }
  | { kind: 'deleted'; annotation: PdfAnnotation }
  | { kind: 'updated'; before: PdfAnnotation; after: PdfAnnotation };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

interface AnnotationDraft {
  kind: 'highlight' | 'ink';
  rect?: PdfRect;
  points?: PdfPoint[];
}

interface NoteEditorState {
  annotation: PdfAnnotation | null;
  page: number;
  x: number;
  y: number;
  text: string;
}

export interface PdfAnnotatorHandle {
  goToPage: (page: number) => void;
}

export function PdfAnnotator({
  attachmentId,
  title,
  initialPage,
  onPageChange,
  onStatusChange,
  handleRef,
}: {
  attachmentId: string;
  title: string;
  initialPage: number;
  onPageChange: (page: number) => void;
  onStatusChange: (status: ReadSaveStatus) => void;
  handleRef: RefObject<PdfAnnotatorHandle | null>;
}) {
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const jumpTargetRef = useRef<number | null>(null);
  const currentPageRef = useRef(Math.max(1, initialPage));
  const onPageChangeRef = useRef(onPageChange);
  const onStatusChangeRef = useRef(onStatusChange);
  onPageChangeRef.current = onPageChange;
  onStatusChangeRef.current = onStatusChange;

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(612);
  const [pageAspect, setPageAspect] = useState(1.294);
  const [containerWidth, setContainerWidth] = useState(820);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(Math.max(1, initialPage));
  const [pageDraft, setPageDraft] = useState(String(Math.max(1, initialPage)));
  const [annotations, setAnnotations] = useState<PdfAnnotation[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState<string>(PDF_HIGHLIGHT_COLORS[0]);
  const [noteEditor, setNoteEditor] = useState<NoteEditorState | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const undoRef = useRef<() => Promise<void>>(async () => undefined);

  const setStatus = useCallback((status: ReadSaveStatus) => onStatusChangeRef.current(status), []);

  const pushUndo = useCallback((entry: UndoEntry) => {
    undoStackRef.current.push(entry);
    if (undoStackRef.current.length > 60) undoStackRef.current.shift();
    setCanUndo(true);
  }, []);

  const goToPage = useCallback((target: number) => {
    if (!Number.isFinite(target)) return;
    const page = Math.min(Math.max(1, Math.round(target)), Math.max(1, pageCount || target));
    currentPageRef.current = page;
    setCurrentPage(page);
    setPageDraft(String(page));
    onPageChangeRef.current(page);
    jumpTargetRef.current = page;
    const element = pageRefs.current.get(page);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      jumpTargetRef.current = null;
    }
  }, [pageCount]);

  useImperativeHandle(handleRef, () => ({ goToPage }), [goToPage]);

  useEffect(() => {
    let cancelled = false;
    let documentTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    setLoading(true);
    setError(null);
    setPdf(null);
    try {
      documentTask = pdfjsLib.getDocument({
        url: `/api/v1/attachments/${attachmentId}/download?inline=1`,
        withCredentials: true,
      });
      documentTask.promise
        .then(async (loaded) => {
          if (cancelled) {
            void loaded.loadingTask.destroy();
            return;
          }
          const first = await loaded.getPage(1);
          if (cancelled) return;
          const viewport = first.getViewport({ scale: 1 });
          setPageWidth(viewport.width);
          setPageAspect(viewport.height / viewport.width);
          setPageCount(loaded.numPages);
          setPdf(loaded);
          setLoading(false);
          const target = Math.min(Math.max(1, initialPage), loaded.numPages);
          window.setTimeout(() => {
            if (!cancelled) goToPage(target);
          }, 80);
        })
        .catch((caught: Error) => {
          if (cancelled) return;
          setError(caught.message || 'The PDF could not be opened.');
          setLoading(false);
        });
    } catch (caught) {
      setError((caught as Error).message);
      setLoading(false);
    }
    return () => {
      cancelled = true;
      if (documentTask) void documentTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachmentId]);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ annotations: PdfAnnotation[] }>(`/attachments/${attachmentId}/annotations`)
      .then((data) => {
        if (!cancelled) setAnnotations(data.annotations);
      })
      .catch((caught: Error) => {
        if (!cancelled) toast(`Could not load annotations: ${caught.message}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, toast]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = container.getBoundingClientRect().top;
        let best = currentPageRef.current;
        let distance = Number.POSITIVE_INFINITY;
        for (const [page, element] of pageRefs.current) {
          const next = Math.abs(element.getBoundingClientRect().top - top - 12);
          if (next < distance) {
            distance = next;
            best = page;
          }
        }
        if (best !== currentPageRef.current) {
          currentPageRef.current = best;
          setCurrentPage(best);
          setPageDraft(String(best));
          onPageChangeRef.current(best);
        }
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pageCount]);

  const scale = Math.max(0.2, ((containerWidth - 64) / pageWidth) * zoom);

  const registerPage = useCallback((page: number, element: HTMLDivElement | null) => {
    if (!element) {
      pageRefs.current.delete(page);
      return;
    }
    pageRefs.current.set(page, element);
    if (jumpTargetRef.current === page) {
      requestAnimationFrame(() => {
        element.scrollIntoView({ block: 'start' });
        jumpTargetRef.current = null;
      });
    }
  }, []);

  const createAnnotation = async (
    page: number,
    kind: PdfAnnotationKind,
    geometry: PdfAnnotationGeometry,
    text = '',
  ) => {
    const now = new Date().toISOString();
    const optimistic: PdfAnnotation = {
      id: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      attachmentId,
      page,
      kind,
      color,
      geometry,
      text,
      createdAt: now,
      updatedAt: now,
    };
    setAnnotations((current) => [...current, optimistic]);
    setStatus('saving');
    try {
      const saved = await api.post<PdfAnnotation>(`/attachments/${attachmentId}/annotations`, {
        page,
        kind,
        color,
        geometry,
        text,
      });
      setAnnotations((current) => current.map((item) => (item.id === optimistic.id ? saved : item)));
      pushUndo({ kind: 'created', annotation: saved });
      setStatus('saved');
      return saved;
    } catch (caught) {
      setAnnotations((current) => current.filter((item) => item.id !== optimistic.id));
      setStatus(navigator.onLine === false ? 'offline' : 'dirty');
      toast(`Annotation was not saved: ${(caught as Error).message}`, 'error');
      return null;
    }
  };

  const updateAnnotation = async (annotation: PdfAnnotation, text: string) => {
    setStatus('saving');
    try {
      const saved = await api.patch<PdfAnnotation>(`/annotations/${annotation.id}`, { text });
      setAnnotations((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      pushUndo({ kind: 'updated', before: annotation, after: saved });
      setStatus('saved');
      return saved;
    } catch (caught) {
      setStatus(navigator.onLine === false ? 'offline' : 'dirty');
      toast(`Note was not saved: ${(caught as Error).message}`, 'error');
      return null;
    }
  };

  const deleteAnnotation = async (annotation: PdfAnnotation, recordUndo = true) => {
    const snapshot = annotations;
    setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
    setStatus('saving');
    try {
      await api.del(`/annotations/${annotation.id}`);
      if (recordUndo) pushUndo({ kind: 'deleted', annotation });
      if (noteEditor?.annotation?.id === annotation.id) setNoteEditor(null);
      setStatus('saved');
    } catch (caught) {
      setAnnotations(snapshot);
      setStatus(navigator.onLine === false ? 'offline' : 'dirty');
      toast(`Annotation was not removed: ${(caught as Error).message}`, 'error');
    }
  };

  const undo = async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setCanUndo(undoStackRef.current.length > 0);
    setStatus('saving');
    try {
      if (entry.kind === 'created') {
        await api.del(`/annotations/${entry.annotation.id}`);
        setAnnotations((current) => current.filter((item) => item.id !== entry.annotation.id));
        if (noteEditor?.annotation?.id === entry.annotation.id) setNoteEditor(null);
      } else if (entry.kind === 'deleted') {
        const saved = await api.post<PdfAnnotation>(`/attachments/${attachmentId}/annotations`, {
          page: entry.annotation.page,
          kind: entry.annotation.kind,
          color: entry.annotation.color,
          geometry: entry.annotation.geometry,
          text: entry.annotation.text,
        });
        setAnnotations((current) => [...current, saved]);
        pushUndo({ kind: 'created', annotation: saved });
      } else {
        const saved = await api.patch<PdfAnnotation>(`/annotations/${entry.before.id}`, {
          text: entry.before.text,
          color: entry.before.color,
          geometry: entry.before.geometry,
        });
        setAnnotations((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      }
      setStatus('saved');
    } catch (caught) {
      setStatus(navigator.onLine === false ? 'offline' : 'dirty');
      toast(`Undo failed: ${(caught as Error).message}`, 'error');
    }
  };
  undoRef.current = undo;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if (typing) return;
      if (!undoStackRef.current.length) return;
      event.preventDefault();
      void undoRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const saveNote = async () => {
    if (!noteEditor) return;
    setNoteBusy(true);
    const result = noteEditor.annotation
      ? await updateAnnotation(noteEditor.annotation, noteEditor.text.trim())
      : await createAnnotation(
          noteEditor.page,
          'note',
          { rect: { x: noteEditor.x, y: noteEditor.y, width: 0, height: 0 } },
          noteEditor.text.trim(),
        );
    setNoteBusy(false);
    if (result) setNoteEditor(null);
  };

  const pageScale = scale;
  const viewerWidth = pageWidth * pageScale;

  return (
    <div className="pdf-reader" aria-label={`${title} reader`}>
      <div className="pdf-reader-toolbar">
        <div className="row" style={{ gap: 3 }}>
          <button className="icon-btn sm" aria-label="Previous page" onClick={() => goToPage(currentPage - 1)}>
            <Icon name="chevron-left" size={14} />
          </button>
          <input
            className="input pdf-page-input"
            aria-label="Page"
            value={pageDraft}
            onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => goToPage(Number(pageDraft) || currentPage)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                goToPage(Number(pageDraft) || currentPage);
                (event.target as HTMLInputElement).blur();
              }
            }}
          />
          <span className="tiny faint">/ {pageCount || '—'}</span>
          <button className="icon-btn sm" aria-label="Next page" onClick={() => goToPage(currentPage + 1)}>
            <Icon name="chevron-right" size={14} />
          </button>
        </div>

        <span className="pdf-toolbar-divider" />

        <div className="row" style={{ gap: 2 }} role="group" aria-label="Annotation tool">
          <ToolButton label="Select, scroll and select text" active={tool === 'select'} onClick={() => setTool('select')} text="↖" />
          <ToolButton label="Highlight selected text" active={tool === 'text'} onClick={() => setTool('text')} text="T" />
          <ToolButton label="Highlight an area" active={tool === 'highlight'} onClick={() => setTool('highlight')} text="▮" />
          <ToolButton label="Draw with ink" active={tool === 'ink'} onClick={() => setTool('ink')} text="✎" />
          <ToolButton label="Place a note" active={tool === 'note'} onClick={() => setTool('note')} text="✚" />
          <ToolButton label="Erase an annotation" active={tool === 'eraser'} onClick={() => setTool('eraser')} text="⌫" />
          <button
            className="pdf-tool"
            title="Undo last annotation (Ctrl+Z)"
            aria-label="Undo last annotation"
            disabled={!canUndo}
            onClick={() => void undo()}
          >
            <Icon name="undo" size={15} />
          </button>
        </div>
        {tool === 'text' || tool === 'highlight' || tool === 'ink' ? (
          <div className="pdf-color-row" aria-label="Annotation colour">
            {PDF_HIGHLIGHT_COLORS.map((value) => (
              <button
                key={value}
                className={`pdf-color ${color === value ? 'active' : ''}`}
                style={{ background: value }}
                aria-label={`Use ${value}`}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
        ) : null}

        <span className="grow" />

        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn sm" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}>
            <Icon name="minus" size={14} />
          </button>
          <button className="btn ghost sm" title="Fit width" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn sm" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}>
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div className="pdf-scroll" ref={scrollRef}>
        {loading ? (
          <div className="pdf-loading">
            <Spinner label="Opening the PDF…" />
          </div>
        ) : null}
        {error ? (
          <div className="empty" style={{ margin: 24 }}>
            <strong>The PDF could not be opened</strong>
            <span className="small">{error}</span>
            <a className="btn sm" href={`/api/v1/attachments/${attachmentId}/download?inline=1`} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} /> Open in a new tab
            </a>
          </div>
        ) : null}
        {pdf && !error ? (
          <div className="pdf-pages" style={{ width: viewerWidth }}>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => (
              <PdfPageView
                key={page}
                pdf={pdf}
                pageNumber={page}
                scale={pageScale}
                aspect={pageAspect}
                annotations={annotations.filter((item) => item.page === page)}
                tool={tool}
                color={color}
                registerPage={registerPage}
                onCreate={createAnnotation}
                onDelete={(annotation) => void deleteAnnotation(annotation)}
                onEditNote={(annotation) => {
                  const rect = annotation.geometry.rect;
                  setNoteEditor({
                    annotation,
                    page: annotation.page,
                    x: rect?.x ?? 0.5,
                    y: rect?.y ?? 0.5,
                    text: annotation.text,
                  });
                }}
                onRequestNote={(x, y) => setNoteEditor({ annotation: null, page, x, y, text: '' })}
              />
            ))}
          </div>
        ) : null}
      </div>

      {noteEditor ? (
        <Modal
          title={noteEditor.annotation ? 'Edit note' : 'Add a note'}
          onClose={() => {
            if (!noteBusy) setNoteEditor(null);
          }}
          footer={
            <>
              {noteEditor.annotation ? (
                <button
                  className="btn danger"
                  disabled={noteBusy}
                  onClick={() => {
                    const annotation = noteEditor.annotation;
                    if (!annotation) return;
                    setNoteEditor(null);
                    void deleteAnnotation(annotation);
                  }}
                >
                  Delete
                </button>
              ) : null}
              <button className="btn" disabled={noteBusy} onClick={() => setNoteEditor(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={noteBusy || !noteEditor.text.trim()} onClick={() => void saveNote()}>
                {noteBusy ? 'Saving…' : 'Save note'}
              </button>
            </>
          }
        >
          <div className="stack sm">
            <span className="small muted">Page {noteEditor.page}</span>
            <textarea
              className="textarea"
              autoFocus
              maxLength={2000}
              style={{ minHeight: 150 }}
              placeholder="What do you want to remember about this spot?"
              value={noteEditor.text}
              onChange={(event) => setNoteEditor((current) => (current ? { ...current, text: event.target.value } : current))}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  if (!noteBusy && noteEditor.text.trim()) void saveNote();
                }
              }}
            />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  text,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  text: string;
}) {
  return (
    <button
      className={`pdf-tool ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      <span aria-hidden>{text}</span>
    </button>
  );
}

function PdfPageView({
  pdf,
  pageNumber,
  scale,
  aspect,
  annotations,
  tool,
  color,
  registerPage,
  onCreate,
  onDelete,
  onEditNote,
  onRequestNote,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  aspect: number;
  annotations: PdfAnnotation[];
  tool: Tool;
  color: string;
  registerPage: (page: number, element: HTMLDivElement | null) => void;
  onCreate: (page: number, kind: PdfAnnotationKind, geometry: PdfAnnotationGeometry) => Promise<PdfAnnotation | null>;
  onDelete: (annotation: PdfAnnotation) => void;
  onEditNote: (annotation: PdfAnnotation) => void;
  onRequestNote: (x: number, y: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<{ x: number; y: number; points: PdfPoint[] } | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);
  const [rendered, setRendered] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<AnnotationDraft | null>(null);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '900px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    let textLayer: InstanceType<typeof pdfjsLib.TextLayer> | null = null;

    pdf
      .getPage(pageNumber)
      .then((loaded) => {
        if (cancelled) return;
        page = loaded;
        const viewport = loaded.getViewport({ scale });
        setDimensions({ width: viewport.width, height: viewport.height });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext('2d');
        if (!context) return;
        renderTask = loaded.render({
          canvas,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        return renderTask.promise.then(async () => {
          if (cancelled) return;
          setRendered(true);
          const container = textLayerRef.current;
          if (!container) return;
          container.replaceChildren();
          container.style.setProperty('--total-scale-factor', String(scale));
          container.style.setProperty('--scale-round-x', '1px');
          container.style.setProperty('--scale-round-y', '1px');
          textLayer = new pdfjsLib.TextLayer({
            textContentSource: loaded.streamTextContent(),
            container,
            viewport,
          });
          await textLayer.render();
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      page?.cleanup();
    };
  }, [pdf, pageNumber, scale, visible]);

  const width = dimensions.width || 612 * scale;
  const height = dimensions.height || width * aspect;
  const drawing = tool === 'highlight' || tool === 'ink' || tool === 'note';

  const normalized = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp01((event.clientX - bounds.left) / bounds.width),
      y: clamp01((event.clientY - bounds.top) / bounds.height),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing || event.button !== 0) return;
    const point = normalized(event);
    if (tool === 'note') {
      onRequestNote(point.x, point.y);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = { x: point.x, y: point.y, points: [point] };
    setDraft(
      tool === 'highlight'
        ? { kind: 'highlight', rect: { x: point.x, y: point.y, width: 0, height: 0 } }
        : { kind: 'ink', points: [point] },
    );
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drawingRef.current;
    if (!start) return;
    const point = normalized(event);
    if (tool === 'highlight') {
      setDraft({
        kind: 'highlight',
        rect: {
          x: Math.min(start.x, point.x),
          y: Math.min(start.y, point.y),
          width: Math.abs(point.x - start.x),
          height: Math.abs(point.y - start.y),
        },
      });
      return;
    }
    const last = start.points[start.points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.002) return;
    start.points.push(point);
    if (start.points.length > 2400) start.points.splice(1, 1);
    setDraft({ kind: 'ink', points: [...start.points] });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drawingRef.current;
    if (!start) return;
    drawingRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be released
    }
    const point = normalized(event);
    if (tool === 'highlight') {
      const rect = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      };
      setDraft(null);
      if (rect.width > 0.006 && rect.height > 0.004) {
        void onCreate(pageNumber, 'highlight', { rect });
      }
      return;
    }
    start.points.push(point);
    const points = start.points;
    setDraft(null);
    if (points.length >= 3) void onCreate(pageNumber, 'ink', { points });
  };

  const highlightSelection = () => {
    if (tool !== 'text') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim() || selection.rangeCount === 0) return;
    const element = wrapperRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const rects = Array.from(selection.getRangeAt(0).getClientRects())
      .filter(
        (rect) =>
          rect.width > 1 &&
          rect.height > 1 &&
          rect.right > bounds.left &&
          rect.left < bounds.right &&
          rect.bottom > bounds.top &&
          rect.top < bounds.bottom,
      )
      .map((rect) => {
        const left = Math.max(rect.left, bounds.left);
        const top = Math.max(rect.top, bounds.top);
        const right = Math.min(rect.right, bounds.right);
        const bottom = Math.min(rect.bottom, bounds.bottom);
        return {
          x: clamp01((left - bounds.left) / bounds.width),
          y: clamp01((top - bounds.top) / bounds.height),
          width: clamp01((right - left) / bounds.width),
          height: clamp01((bottom - top) / bounds.height),
        };
      })
      .filter((rect) => rect.width > 0.002 && rect.height > 0.002);
    if (!rects.length) return;
    selection.removeAllRanges();
    void onCreate(pageNumber, 'highlight', { rects });
  };

  return (
    <div
      className={`pdf-page ${rendered ? 'rendered' : ''} tool-${tool}`}
      style={{ width, height }}
      ref={(element) => {
        wrapperRef.current = element;
        registerPage(pageNumber, element);
      }}
      data-page={pageNumber}
      onMouseUp={highlightSelection}
    >
      <canvas ref={canvasRef} className="pdf-page-canvas" />
      <div className="pdf-text-layer" ref={textLayerRef} />
      {!rendered ? <span className="pdf-page-skeleton">Page {pageNumber}</span> : null}

      <svg className="pdf-annotation-layer" width={width} height={height} aria-hidden={!annotations.length}>
        {annotations.map((annotation) => {
          if (annotation.kind === 'ink' && annotation.geometry.points?.length) {
            return (
              <polyline
                key={annotation.id}
                points={annotation.geometry.points.map((point) => `${point.x * width},${point.y * height}`).join(' ')}
                fill="none"
                stroke={annotation.color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ pointerEvents: tool === 'eraser' ? 'stroke' : 'none', cursor: tool === 'eraser' ? 'crosshair' : 'default' }}
                onClick={(event) => {
                  if (tool !== 'eraser') return;
                  event.stopPropagation();
                  onDelete(annotation);
                }}
              />
            );
          }
          if (annotation.kind === 'highlight') {
            const rects = annotation.geometry.rects ?? (annotation.geometry.rect ? [annotation.geometry.rect] : []);
            if (!rects.length) return null;
            return (
              <g key={annotation.id}>
                {rects.map((rect, index) => (
                  <rect
                    key={`${annotation.id}_${index}`}
                    x={rect.x * width}
                    y={rect.y * height}
                    width={rect.width * width}
                    height={rect.height * height}
                    rx={3}
                    fill={annotation.color}
                    fillOpacity={0.32}
                    style={{ pointerEvents: tool === 'eraser' ? 'auto' : 'none', cursor: tool === 'eraser' ? 'crosshair' : 'default' }}
                    onClick={(event) => {
                      if (tool !== 'eraser') return;
                      event.stopPropagation();
                      onDelete(annotation);
                    }}
                  />
                ))}
              </g>
            );
          }
          return null;
        })}
        {draft?.kind === 'highlight' && draft.rect ? (
          <rect
            x={draft.rect.x * width}
            y={draft.rect.y * height}
            width={draft.rect.width * width}
            height={draft.rect.height * height}
            rx={3}
            fill={color}
            fillOpacity={0.28}
            stroke={color}
            strokeDasharray="4 3"
          />
        ) : null}
        {draft?.kind === 'ink' && draft.points?.length ? (
          <polyline
            points={draft.points.map((point) => `${point.x * width},${point.y * height}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      {annotations
        .filter((annotation) => annotation.kind === 'note')
        .map((annotation) => {
          const rect = annotation.geometry.rect;
          const x = (rect?.x ?? 0) * width;
          const y = (rect?.y ?? 0) * height;
          return (
            <button
              key={annotation.id}
              className="pdf-note-marker"
              style={{ left: x, top: y }}
              title={annotation.text || 'Note'}
              onClick={(event) => {
                event.stopPropagation();
                if (tool === 'eraser') onDelete(annotation);
                else onEditNote(annotation);
              }}
              aria-label={annotation.text || 'Open note'}
            >
              {tool === 'eraser' ? '×' : '✎'}
            </button>
          );
        })}

      {drawing ? (
        <div
          className={`pdf-draw-layer tool-${tool}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            drawingRef.current = null;
            setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}
