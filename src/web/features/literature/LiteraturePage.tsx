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

type AddTab = 'manual' | 'url' | 'bibtex' | 'pdf';

interface QueueItem {
  id: string;
  name: string;
  status: 'queued' | 'processing' | 'done' | 'failed';
  title?: string;
  refId?: string;
  error?: string;
}

interface MetadataQueueItem {
  queueId: string;
  referenceId: string;
  title: string;
  mode: PdfMetadataMode;
  status: 'queued' | 'processing' | 'done' | 'failed';
  error?: string;
}

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
  const pendingRef = useRef<{ item: QueueItem; file: File; mode?: PdfMetadataMode }[]>([]);
  const processingRef = useRef(false);
  const [queueProcessing, setQueueProcessing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkItems, setBulkItems] = useState<{ id: string; title: string; mode: PdfMetadataMode }[]>([]);
  const [metadataQueue, setMetadataQueue] = useState<MetadataQueueItem[]>([]);
  const metadataPendingRef = useRef<MetadataQueueItem[]>([]);
  const metadataProcessingRef = useRef(false);
  const [metadataProcessing, setMetadataProcessing] = useState(false);

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

  const ingestPdfFile = async (file: File, modeOverride?: PdfMetadataMode): Promise<Reference> => {
    const mode = modeOverride ?? pdfMode;
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (mode) params.set('mode', mode);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return api.upload<Reference>(`/references/ingest-pdf${suffix}`, file);
  };

  const createFromPdf = async () => {
    if (!pdfFile) return;
    setBusy(true);
    try {
      const reference = await ingestPdfFile(pdfFile, pdfMode);
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

  const pumpQueue = async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setQueueProcessing(true);
    while (pendingRef.current.length) {
      const entry = pendingRef.current.shift()!;
      updateQueueItem(entry.item.id, { status: 'processing' });
      try {
        const reference = await ingestPdfFile(entry.file, entry.mode);
        updateQueueItem(entry.item.id, {
          status: 'done',
          title: reference.title,
          refId: reference.id,
        });
      } catch (error) {
        updateQueueItem(entry.item.id, {
          status: 'failed',
          error: (error as Error).message,
        });
      }
    }
    processingRef.current = false;
    setQueueProcessing(false);
    references.reload();
  };

  const enqueuePdfFiles = (files: File[]) => {
    const pdfs = files.filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (!pdfs.length) {
      toast('Drop PDF files or a URL.', 'error');
      return;
    }
    const entries = pdfs.map((file) => ({
      item: { id: crypto.randomUUID(), name: file.name, status: 'queued' as const },
      file,
      mode: pdfMode,
    }));
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

  const updateMetadataItem = (queueId: string, patch: Partial<MetadataQueueItem>) => {
    setMetadataQueue((current) => current.map((item) => (item.queueId === queueId ? { ...item, ...patch } : item)));
  };

  const pumpMetadataQueue = async () => {
    if (metadataProcessingRef.current) return;
    metadataProcessingRef.current = true;
    setMetadataProcessing(true);
    while (metadataPendingRef.current.length) {
      const item = metadataPendingRef.current.shift()!;
      updateMetadataItem(item.queueId, { status: 'processing', error: undefined });
      try {
        const result = await api.post<{ reference?: Reference; error?: string }>(
          `/references/${item.referenceId}/reextract-metadata`,
          { mode: item.mode, apply: true },
        );
        if (!result.reference) {
          throw new Error(result.error ?? 'No metadata was produced.');
        }
        updateMetadataItem(item.queueId, { status: 'done', title: result.reference.title });
      } catch (error) {
        updateMetadataItem(item.queueId, { status: 'failed', error: (error as Error).message });
      }
    }
    metadataProcessingRef.current = false;
    setMetadataProcessing(false);
    references.reload();
  };

  const openBulkExtraction = () => {
    const items = list
      .filter((reference) => selected.has(reference.id))
      .map((reference) => ({ id: reference.id, title: reference.title, mode: 'ocr' as PdfMetadataMode }));
    setBulkItems(items);
    setBulkOpen(true);
  };

  const startBulkExtraction = () => {
    const queued: MetadataQueueItem[] = bulkItems.map((item) => ({
      queueId: crypto.randomUUID(),
      referenceId: item.id,
      title: item.title,
      mode: item.mode,
      status: 'queued',
    }));
    metadataPendingRef.current.push(...queued);
    setMetadataQueue((current) => [...current, ...queued]);
    setBulkOpen(false);
    setSelected(new Set());
    void pumpMetadataQueue();
  };

  const list = references.data?.references ?? [];
  const allSelected = list.length > 0 && list.every((reference) => selected.has(reference.id));
  const someSelected = list.some((reference) => selected.has(reference.id));

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
              <button
                className="btn sm"
                onClick={() => setQueue((current) => current.filter((item) => item.status === 'queued' || item.status === 'processing'))}
              >
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
                <span className={`tiny queue-status ${item.status}`}>{item.status}</span>
                {item.error ? <span className="tiny error-text truncate" title={item.error}>{item.error}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {metadataQueue.length ? (
        <div className="card tight" style={{ marginBottom: 14 }}>
          <div className="row between" style={{ marginBottom: 8 }}>
            <strong className="small">
              Metadata re-extraction {metadataProcessing ? '· working…' : ''}
            </strong>
            <div className="row">
              <span className="tiny faint">
                {metadataQueue.filter((item) => item.status === 'done').length} done ·{' '}
                {metadataQueue.filter((item) => item.status === 'failed').length} failed
              </span>
              <button
                className="btn sm"
                onClick={() => setMetadataQueue((current) => current.filter((item) => item.status === 'queued' || item.status === 'processing'))}
              >
                Clear finished
              </button>
            </div>
          </div>
          <div className="stack sm">
            {metadataQueue.map((item) => (
              <div className="row" key={item.queueId} style={{ gap: 8 }}>
                <span className={`status-dot ${item.status}`} title={item.status} />
                {item.status === 'done' ? (
                  <button className="queue-link" onClick={() => navigate(`/literature/${item.referenceId}`)}>
                    {item.title}
                  </button>
                ) : (
                  <span className="small truncate">{item.title}</span>
                )}
                <span className="badge">{item.mode}</span>
                <span className={`tiny queue-status ${item.status}`}>{item.status}</span>
                {item.error ? <span className="tiny error-text truncate" title={item.error}>{item.error}</span> : null}
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
              <button className="btn primary" disabled={!bulkItems.length} onClick={startBulkExtraction}>
                Queue {bulkItems.length} extraction{bulkItems.length === 1 ? '' : 's'}
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
