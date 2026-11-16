import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api, download } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Empty, ErrorState, Field, Loading, Modal, Spinner, Tabs, useToast } from '../../shared/ui';
import { TypeBadge } from '../../shared/components';
import { PDF_METADATA_MODES, READING_STATUSES, type PdfMetadataMode, type ReadingStatus } from '../../../shared/constants';
import type { ProjectOutlet } from '../../shared/projectContext';
import type { Reference } from '../../../shared/types';
import { useSession } from '../../app/session';
import {
  deleteFinishedPdfQueueItems,
  listPdfQueue,
  savePdfQueueItem,
} from '../../shared/pdfQueueStore';

type AddTab = 'manual' | 'url' | 'bibtex' | 'pdf';

interface QueueItem {
  id: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  title?: string;
  refId?: string;
  error?: string;
  mode?: PdfMetadataMode | null;
}

interface PendingPdfIngest {
  item: QueueItem;
  file: Blob;
  mode?: PdfMetadataMode;
  projectId: string | null;
  createdAt: number;
}

interface ExtractionJob {
  id: string;
  referenceId: string;
  title: string;
  mode: PdfMetadataMode;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const isActiveJob = (job: ExtractionJob): boolean =>
  job.status === 'queued' || job.status === 'processing';


export function LiteraturePage() {
  const outlet = useOutletContext<ProjectOutlet | undefined>();
  const projectId = outlet?.project?.id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { meta } = useSession();
  const [pdfModeOverride, setPdfModeOverride] = useState<'default' | PdfMetadataMode>('default');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ReadingStatus | ''>('');
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<AddTab>('manual');
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [venue, setVenue] = useState('');
  const [doi, setDoi] = useState('');
  const [url, setUrl] = useState('');
  const [abstract, setAbstract] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [bibtex, setBibtex] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const [ingesting, setIngesting] = useState<{ current: number; total: number } | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const pendingRef = useRef<PendingPdfIngest[]>([]);
  const processingRef = useRef(false);
  const [queueProcessing, setQueueProcessing] = useState(false);
  const queueMetaRef = useRef(
    new Map<
      string,
      { mode: PdfMetadataMode | null; projectId: string | null; createdAt: number; blob?: Blob }
    >(),
  );
  const queueRestoredRef = useRef(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkItems, setBulkItems] = useState<{ id: string; title: string; mode: PdfMetadataMode }[]>([]);
  const [extractionJobs, setExtractionJobs] = useState<ExtractionJob[]>([]);
  const extractionPollRef = useRef<number | null>(null);

  useEffect(() => {
    setSelected(new Set());
  }, [query, status, projectId]);

  const references = useAsync(
    () =>
      api.get<{ references: Reference[] }>(
        `/references?limit=200${projectId ? `&projectId=${projectId}` : ''}${status ? `&readingStatus=${status}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`,
      ),
    [projectId, status, query],
  );

  const reset = () => {
    setTitle('');
    setAuthors('');
    setYear('');
    setVenue('');
    setDoi('');
    setUrl('');
    setAbstract('');
    setIngestUrl('');
    setBibtex('');
    setPdfFile(null);
  };

  const createManual = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const reference = await api.post<Reference>('/references', {
        title,
        authors: authors.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
        year: year ? Number(year) : null,
        venue,
        doi: doi || null,
        url: url || null,
        abstract,
        projectId: projectId ?? null,
      });
      reset();
      setAddOpen(false);
      navigate(`/literature/${reference.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pdfMode = pdfModeOverride === 'default' ? undefined : pdfModeOverride;

  const ingestPdfFile = async (
    file: Blob,
    filename: string,
    mode: PdfMetadataMode | undefined,
    targetProjectId: string | null,
  ): Promise<Reference> => {
    const payload = file instanceof File ? file : new File([file], filename, { type: 'application/pdf' });
    const params = new URLSearchParams();
    if (targetProjectId) params.set('projectId', targetProjectId);
    if (mode) params.set('mode', mode);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return api.upload<Reference>(`/references/ingest-pdf${suffix}`, payload);
  };

  const createFromPdf = async () => {
    if (!pdfFile) return;
    setBusy(true);
    try {
      const reference = await ingestPdfFile(pdfFile, pdfFile.name, pdfMode, projectId ?? null);
      reset();
      setAddOpen(false);
      navigate(`/literature/${reference.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateQueueItem = (id: string, patch: Partial<QueueItem>) => {
    setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const persistQueueItem = (item: QueueItem, includeBlob: boolean) => {
    const meta = queueMetaRef.current.get(item.id);
    void savePdfQueueItem({
      id: item.id,
      name: item.name,
      status: item.status,
      ...(item.title ? { title: item.title } : {}),
      ...(item.refId ? { refId: item.refId } : {}),
      ...(item.error ? { error: item.error } : {}),
      mode: meta?.mode ?? null,
      projectId: meta?.projectId ?? null,
      createdAt: meta?.createdAt ?? Date.now(),
      ...(includeBlob && meta?.blob ? { blob: meta.blob } : {}),
    });
  };

  const pumpQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setQueueProcessing(true);
    while (pendingRef.current.length) {
      const entry = pendingRef.current.shift()!;
      updateQueueItem(entry.item.id, { status: 'processing', error: undefined });
      persistQueueItem({ ...entry.item, status: 'processing' }, true);
      try {
        const reference = await ingestPdfFile(entry.file, entry.item.name, entry.mode, entry.projectId);
        const done: QueueItem = { ...entry.item, status: 'done', title: reference.title, refId: reference.id };
        updateQueueItem(entry.item.id, {
          status: 'done',
          title: reference.title,
          refId: reference.id,
          error: undefined,
        });
        const meta = queueMetaRef.current.get(entry.item.id);
        if (meta) meta.blob = undefined;
        persistQueueItem(done, false);
      } catch (error) {
        const message = (error as Error).message;
        updateQueueItem(entry.item.id, { status: 'failed', error: message });
        persistQueueItem({ ...entry.item, status: 'failed', error: message }, true);
      }
    }
    processingRef.current = false;
    setQueueProcessing(false);
    references.reload();
  };

  const retryQueueItem = (id: string) => {
    const item = queue.find((entry) => entry.id === id);
    const meta = queueMetaRef.current.get(id);
    if (!item || !meta?.blob) return;
    const next: QueueItem = { ...item, status: 'queued', refId: undefined, error: undefined };
    updateQueueItem(id, { status: 'queued', refId: undefined, error: undefined });
    persistQueueItem(next, true);
    pendingRef.current.push({
      item: next,
      file: meta.blob,
      ...(meta.mode ? { mode: meta.mode } : {}),
      projectId: meta.projectId,
      createdAt: meta.createdAt,
    });
    void pumpQueue();
  };

  const enqueuePdfFiles = (files: File[]) => {
    const pdfs = files.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (!pdfs.length) {
      toast('Drop PDF files or a URL.', 'error');
      return;
    }
    const mode = pdfMode ?? null;
    const targetProjectId = projectId ?? null;
    const now = Date.now();
    const entries: PendingPdfIngest[] = pdfs.map((file, index) => {
      const createdAt = now + index;
      const item: QueueItem = { id: crypto.randomUUID(), name: file.name, status: 'queued', mode };
      queueMetaRef.current.set(item.id, { mode, projectId: targetProjectId, createdAt, blob: file });
      persistQueueItem(item, true);
      return {
        item,
        file,
        ...(mode ? { mode } : {}),
        projectId: targetProjectId,
        createdAt,
      };
    });
    pendingRef.current.push(...entries);
    setQueue((current) => [...current, ...entries.map((entry) => entry.item)]);
    void pumpQueue();
  };

  const parseUrls = (raw: string): string[] =>
    [...new Set(
      raw
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//i.test(line)),
    )].slice(0, 10);

  const ingestDroppedUrls = async (urls: string[]) => {
    if (!urls.length) return;
    setIngesting({ current: 1, total: urls.length });
    try {
      const result = await api.post<{ created: Reference[]; errors: { url: string; error: string }[] }>(
        '/references/ingest-urls',
        { urls, projectId: projectId ?? null, ...(pdfMode ? { pdfMode } : {}) },
      );
      references.reload();
      if (result.errors.length) toast(`${result.errors[0]!.url}: ${result.errors[0]!.error}`, 'error');
      if (result.created.length === 1) {
        navigate(`/literature/${result.created[0]!.id}`);
      } else if (result.created.length > 1) {
        toast(`Archived ${result.created.length} web pages with metadata`, 'success');
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setIngesting(null);
    }
  };

  const ingest = async () => {
    const urls = parseUrls(ingestUrl);
    if (!urls.length) {
      toast('Enter at least one http(s) URL.', 'error');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ created: Reference[]; errors: { url: string; error: string }[] }>(
        '/references/ingest-urls',
        { urls, projectId: projectId ?? null, ...(pdfMode ? { pdfMode } : {}) },
      );
      reset();
      setAddOpen(false);
      references.reload();
      if (result.errors.length) toast(`${result.errors[0]!.url}: ${result.errors[0]!.error}`, 'error');
      if (result.created.length === 1) {
        navigate(`/literature/${result.created[0]!.id}`);
      } else if (result.created.length > 1) {
        toast(`Archived ${result.created.length} web pages with metadata`, 'success');
      }
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const importBibtex = async () => {
    if (!bibtex.trim()) return;
    setBusy(true);
    try {
      const result = await api.post<{ created: number; skipped: number; errors: string[] }>('/references/import-bibtex', {
        bibtex,
        projectId: projectId ?? null,
      });
      toast(`Imported ${result.created}, skipped ${result.skipped}`, 'success');
      if (result.errors.length) toast(result.errors[0]!, 'error');
      reset();
      setAddOpen(false);
      references.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const refreshExtractionJobs = async (): Promise<ExtractionJob[]> => {
    try {
      const data = await api.get<{ jobs: ExtractionJob[] }>('/references/extraction-jobs');
      setExtractionJobs(data.jobs);
      return data.jobs;
    } catch {
      return [];
    }
  };

  const stopExtractionPolling = () => {
    if (extractionPollRef.current !== null) {
      window.clearInterval(extractionPollRef.current);
      extractionPollRef.current = null;
    }
  };

  const startExtractionPolling = () => {
    if (extractionPollRef.current !== null) return;
    extractionPollRef.current = window.setInterval(() => {
      void refreshExtractionJobs().then((jobs) => {
        if (!jobs.some(isActiveJob)) {
          stopExtractionPolling();
          references.reload();
        }
      });
    }, 2000);
  };

  useEffect(() => {
    if (queueRestoredRef.current) return;
    queueRestoredRef.current = true;

    void (async () => {
      const stored = await listPdfQueue();
      if (!stored.length) return;
      const restored: QueueItem[] = [];
      for (const row of stored) {
        queueMetaRef.current.set(row.id, {
          mode: row.mode,
          projectId: row.projectId,
          createdAt: row.createdAt,
          ...(row.blob ? { blob: row.blob } : {}),
        });
        const item: QueueItem = {
          id: row.id,
          name: row.name,
          status: row.status,
          mode: row.mode,
          ...(row.title ? { title: row.title } : {}),
          ...(row.refId ? { refId: row.refId } : {}),
          ...(row.error ? { error: row.error } : {}),
        };
        if (row.status === 'processing') {
          const message = 'The page reloaded during this upload. Check the library, then retry.';
          const interrupted: QueueItem = { ...item, status: 'failed', error: message };
          restored.push(interrupted);
          persistQueueItem(interrupted, Boolean(row.blob));
        } else {
          restored.push(item);
          if (row.status === 'queued' && row.blob) {
            pendingRef.current.push({
              item,
              file: row.blob,
              ...(row.mode ? { mode: row.mode } : {}),
              projectId: row.projectId,
              createdAt: row.createdAt,
            });
          }
        }
      }
      setQueue((current) => [...restored, ...current]);
      if (pendingRef.current.length) void pumpQueue();
    })();

    void refreshExtractionJobs().then((jobs) => {
      if (jobs.some(isActiveJob)) startExtractionPolling();
    });

    return stopExtractionPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBulkExtraction = () => {
    const items = list
      .filter((reference) => selected.has(reference.id))
      .map((reference) => ({ id: reference.id, title: reference.title, mode: 'ocr' as PdfMetadataMode }));
    setBulkItems(items);
    setBulkOpen(true);
  };

  const startBulkExtraction = async () => {
    setBulkBusy(true);
    try {
      await api.post('/references/reextract-metadata', {
        items: bulkItems.map((item) => ({ id: item.id, mode: item.mode })),
      });
      const queued = bulkItems.length;
      setBulkOpen(false);
      setSelected(new Set());
      const jobs = await refreshExtractionJobs();
      if (jobs.some(isActiveJob)) startExtractionPolling();
      toast(`Queued ${queued} extraction${queued === 1 ? '' : 's'}`, 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const clearFinishedExtractions = async () => {
    try {
      await api.post('/references/extraction-jobs/dismiss');
      setExtractionJobs((current) => current.filter(isActiveJob));
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const clearFinishedPdfQueue = () => {
    setQueue((current) => {
      const remaining = current.filter(
        (item) => item.status === 'queued' || item.status === 'processing',
      );
      for (const item of current) {
        if (item.status !== 'queued' && item.status !== 'processing') {
          queueMetaRef.current.delete(item.id);
        }
      }
      return remaining;
    });
    void deleteFinishedPdfQueueItems();
  };

  const list = references.data?.references ?? [];
  const allSelected = list.length > 0 && list.every((reference) => selected.has(reference.id));
  const someSelected = list.some((reference) => selected.has(reference.id));
  const activeExtractions = extractionJobs.filter(isActiveJob).length;

  return (
    <div
      data-dropzone="literature"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes('Files') && !event.dataTransfer.types.includes('text/uri-list')) return;
        event.preventDefault();
        dragCounter.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragCounter.current = Math.max(0, dragCounter.current - 1);
        if (dragCounter.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragCounter.current = 0;
        setDragging(false);
        const files = [...event.dataTransfer.files];
        if (files.length) {
          enqueuePdfFiles(files);
          return;
        }
        if (ingesting) return;
        const dropped = event.dataTransfer.getData('text/uri-list') || event.dataTransfer.getData('text/plain');
        const urls = parseUrls(dropped);
        if (urls.length) void ingestDroppedUrls(urls);
      }}
    >
      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-card">
            <Icon name="upload" size={28} />
            <strong>Drop PDFs or a URL</strong>
            <span className="small faint">Loom extracts the text, asks the AI for structured metadata, and files the reference.</span>
          </div>
        </div>
      ) : null}

      {ingesting ? (
        <div className="banner">
          <Spinner />
          <span>
            {ingesting.total > 1
              ? `Analyzing PDF ${ingesting.current}/${ingesting.total} and extracting metadata…`
              : 'Fetching the source and extracting metadata with AI…'}
          </span>
        </div>
      ) : null}

      {queue.length ? (
        <div className="card tight" style={{ marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong className="small">
              PDF ingestion {queueProcessing ? '· working…' : ''}
            </strong>
            <div className="row">
              <span className="tiny faint">
                {queue.filter((item) => item.status === 'done').length} done ·{' '}
                {queue.filter((item) => item.status === 'failed').length} failed
              </span>
              <button className="btn sm" onClick={clearFinishedPdfQueue}>
                Clear finished
              </button>
            </div>
          </div>
          <div className="stack sm">
            {queue.map((item) => (
              <div className="row" key={item.id} style={{ gap: 8 }}>
                <span className={`status-dot ${item.status}`} title={item.status} />
                {item.refId ? (
                  <button
                    className="queue-link"
                    onClick={() => navigate(`/literature/${item.refId}`)}
                    title={item.name}
                  >
                    {item.title ?? item.name}
                  </button>
                ) : (
                  <span className="small truncate" title={item.name}>{item.name}</span>
                )}
                {item.mode ? <span className="badge">{item.mode}</span> : null}
                <span className={`tiny queue-status ${item.status}`}>{item.status}</span>
                {item.error ? <span className="tiny error-text truncate" title={item.error}>{item.error}</span> : null}
                {item.status === 'failed' && queueMetaRef.current.get(item.id)?.blob ? (
                  <button className="btn sm" onClick={() => retryQueueItem(item.id)}>Retry</button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {extractionJobs.length ? (
        <div className="card tight" style={{ marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong className="small">
              Metadata re-extraction {activeExtractions ? '· working…' : ''}
            </strong>
            <div className="row">
              <span className="tiny faint">
                {extractionJobs.filter((job) => job.status === 'done').length} done ·{' '}
                {extractionJobs.filter((job) => job.status === 'failed').length} failed
              </span>
              <button className="btn sm" onClick={() => void clearFinishedExtractions()}>
                Clear finished
              </button>
            </div>
          </div>
          <div className="stack sm">
            {extractionJobs.map((job) => (
              <div className="row" key={job.id} style={{ gap: 8 }}>
                <span className={`status-dot ${job.status}`} title={job.status} />
                {job.status === 'done' ? (
                  <button className="queue-link" onClick={() => navigate(`/literature/${job.referenceId}`)}>
                    {job.title}
                  </button>
                ) : (
                  <span className="small truncate" title={job.title}>{job.title}</span>
                )}
                <span className="badge">{job.mode}</span>
                <span className={`tiny queue-status ${job.status}`}>{job.status}</span>
                {job.error ? <span className="tiny error-text truncate" title={job.error}>{job.error}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Literature</h2>
          <p className="small muted">References, PDFs and BibTeX. Drop PDFs or URLs anywhere on this page.</p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => void download(projectId ? `/references.bib?projectId=${projectId}` : '/references.bib', 'loom-references.bib')}>
            <Icon name="download" size={14} /> BibTeX
          </button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>
            <Icon name="plus" size={15} /> Add reference
          </button>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search title, authors, abstract…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="select" style={{ width: 160 }} value={status} onChange={(event) => setStatus(event.target.value as ReadingStatus | '')}>
          <option value="">Any status</option>
          {READING_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <label className="row small muted" style={{ gap: 6, marginLeft: 'auto' }}>
          PDF metadata
          <select
            className="select"
            style={{ width: 185 }}
            value={pdfModeOverride}
            onChange={(event) => setPdfModeOverride(event.target.value as 'default' | PdfMetadataMode)}
            title="Override the default PDF extraction mode for drops and uploads"
          >
            <option value="default">Default ({meta?.app.pdfMetadataMode ?? 'ocr'})</option>
            {PDF_METADATA_MODES.map((mode) => (
              <option key={mode} value={mode}>{mode}</option>
            ))}
          </select>
        </label>
      </div>

      {selected.size ? (
        <div className="banner" style={{ marginBottom: 14 }}>
          <Icon name="book" size={15} />
          <span className="grow">{selected.size} reference{selected.size === 1 ? '' : 's'} selected</span>
          <button className="btn sm" onClick={() => setSelected(new Set())}>Clear</button>
          <button className="btn primary sm" onClick={openBulkExtraction}>
            <Icon name="refresh" size={14} /> Re-run extraction
          </button>
        </div>
      ) : null}

      {references.loading ? <Loading rows={5} /> : null}
      {references.error ? <ErrorState error={references.error} retry={references.reload} /> : null}
      {!references.loading && list.length === 0 ? (
        <div className="card">
          <Empty title="No references yet" icon="book" action={<button className="btn primary" onClick={() => setAddOpen(true)}>Add a paper</button>}>
            Upload a PDF, paste a URL, import BibTeX, or enter metadata manually.
          </Empty>
        </div>
      ) : null}

      {list.length ? (
        <div className="card flush">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all references"
                    checked={allSelected}
                    ref={(element) => {
                      if (element) element.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => {
                      if (allSelected) setSelected(new Set());
                      else setSelected(new Set(list.map((reference) => reference.id)));
                    }}
                  />
                </th>
                <th>Title</th>
                <th className="hide-sm">Authors</th>
                <th>Year</th>
                <th className="hide-sm">Status</th>
                <th className="hide-sm">Added</th>
              </tr>
            </thead>
            <tbody>
              {list.map((reference) => (
                <tr key={reference.id} className="clickable" onClick={() => navigate(`/literature/${reference.id}`)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${reference.title}`}
                      checked={selected.has(reference.id)}
                      onChange={(event) => {
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(reference.id);
                          else next.delete(reference.id);
                          return next;
                        });
                      }}
                    />
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <TypeBadge type="reference" />
                      <span className="truncate" style={{ maxWidth: 420, fontWeight: 500 }}>{reference.title}</span>
                    </div>
                  </td>
                  <td className="hide-sm small muted">{reference.authors.slice(0, 3).join(', ') || '—'}</td>
                  <td className="small">{reference.year ?? '—'}</td>
                  <td className="hide-sm"><span className={`badge ${reference.readingStatus === 'reviewed' ? 'success' : reference.readingStatus === 'reading' ? 'info' : ''}`}>{reference.readingStatus}</span></td>
                  <td className="hide-sm tiny faint">{formatDate(reference.addedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {bulkOpen ? (
        <Modal
          title="Re-run metadata extraction"
          description="Each selected reference is added to the processing list and its metadata is applied automatically."
          onClose={() => setBulkOpen(false)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setBulkOpen(false)}>Cancel</button>
              <button
                className="btn"
                onClick={() => setBulkItems((current) => current.map((item) => ({ ...item, mode: 'ocr' })))}
              >
                Use OCR for all
              </button>
              <button className="btn primary" disabled={!bulkItems.length || bulkBusy} onClick={() => void startBulkExtraction()}>
                {bulkBusy ? 'Queueing…' : `Queue ${bulkItems.length} extraction${bulkItems.length === 1 ? '' : 's'}`}
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="small muted">
              OCR then text is the default. Choose a different mode per item if needed. The server applies the validated
              metadata after each extraction.
            </p>
            <div className="stack sm" style={{ maxHeight: 430, overflowY: 'auto' }}>
              {bulkItems.map((item, index) => (
                <div className="row" key={item.id} style={{ gap: 10 }}>
                  <span className="small grow truncate" title={item.title}>{item.title}</span>
                  <select
                    className="select"
                    style={{ width: 160 }}
                    value={item.mode}
                    onChange={(event) => {
                      const mode = event.target.value as PdfMetadataMode;
                      setBulkItems((current) => current.map((entry, i) => i === index ? { ...entry, mode } : entry));
                    }}
                  >
                    <option value="ocr">OCR then text</option>
                    <option value="text">Extracted text</option>
                    <option value="images">Page images</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      {addOpen ? (
        <Modal
          title="Add a reference"
          onClose={() => setAddOpen(false)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
              {tab === 'manual' ? <button className="btn primary" disabled={busy || !title.trim()} onClick={() => void createManual()}>Add reference</button> : null}
              {tab === 'url' ? <button className="btn primary" disabled={busy || !ingestUrl.trim()} onClick={() => void ingest()}>Analyze &amp; add</button> : null}
              {tab === 'bibtex' ? <button className="btn primary" disabled={busy || !bibtex.trim()} onClick={() => void importBibtex()}>Import</button> : null}
              {tab === 'pdf' ? <button className="btn primary" disabled={busy || !pdfFile} onClick={() => void createFromPdf()}>Analyze &amp; add</button> : null}
            </>
          }
        >
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'manual', label: 'Manual' },
              { value: 'url', label: 'From URL' },
              { value: 'pdf', label: 'PDF upload' },
              { value: 'bibtex', label: 'BibTeX' },
            ]}
          />
          {tab === 'manual' ? (
            <div className="stack">
              <Field label="Title"><input className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
              <div className="grid-2">
                <Field label="Authors" help="Separate with commas or semicolons."><input className="input" value={authors} onChange={(event) => setAuthors(event.target.value)} placeholder="Doe, Jane; Smith, John" /></Field>
                <Field label="Year"><input className="input" type="number" value={year} onChange={(event) => setYear(event.target.value)} /></Field>
                <Field label="Venue"><input className="input" value={venue} onChange={(event) => setVenue(event.target.value)} /></Field>
                <Field label="DOI"><input className="input" value={doi} onChange={(event) => setDoi(event.target.value)} /></Field>
                <Field label="URL"><input className="input" value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
              </div>
              <Field label="Abstract"><textarea className="textarea" value={abstract} onChange={(event) => setAbstract(event.target.value)} /></Field>
            </div>
          ) : null}
          {tab === 'url' ? (
            <div className="stack">
              <Field label="Page URLs" help="One per line, up to 10. Only public HTTP(S) pages are allowed. Each page is fetched, archived locally, parsed and sent to your AI provider for structured metadata.">
                <textarea
                  className="textarea"
                  autoFocus
                  style={{ minHeight: 140, fontFamily: 'var(--font-mono)', fontSize: 12.5 }}
                  value={ingestUrl}
                  onChange={(event) => setIngestUrl(event.target.value)}
                  placeholder={'https://arxiv.org/abs/2401.00001\nhttps://example.org/paper'}
                />
              </Field>
              <p className="small faint">You can also drag one or more links onto the Literature page. Each successful capture stores an HTML archive as an attachment and indexes its text.</p>
            </div>
          ) : null}
          {tab === 'pdf' ? (
            <div className="stack">
              <Field label="PDF file" help="The PDF stays in Loom; only the selected representation is sent to your AI provider.">
                <input className="input" type="file" accept="application/pdf" onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)} />
              </Field>
              <Field label="Metadata source for this upload">
                <select className="select" value={pdfModeOverride} onChange={(event) => setPdfModeOverride(event.target.value as 'default' | PdfMetadataMode)}>
                  <option value="default">Default ({meta?.app.pdfMetadataMode ?? 'ocr'})</option>
                  {PDF_METADATA_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'text' ? 'Extracted text' : mode === 'images' ? 'Page images (vision)' : 'OCR then text'}</option>)}
                </select>
              </Field>
              <p className="small faint">
                Loom extracts the text, detects a DOI, reads the title/authors/venue from the document and asks the AI to fill the metadata fields. You can edit everything afterwards.
              </p>
            </div>
          ) : null}
          {tab === 'bibtex' ? (
            <div className="stack">
              <Field label="BibTeX">
                <textarea className="textarea" style={{ minHeight: 260, fontFamily: 'var(--font-mono)', fontSize: 12.5 }} value={bibtex} onChange={(event) => setBibtex(event.target.value)} placeholder="@article{doe2024,...}" />
              </Field>
              <p className="small faint">Duplicate citation keys are skipped and reported.</p>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
