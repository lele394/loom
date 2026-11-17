import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { useAi } from '../../shared/aiContext';
import { Icon } from '../../shared/icons';
import { Markdown } from '../../shared/markdown';
import { AttachmentsPanel, LinksPanel, TagEditor } from '../../shared/components';
import { ErrorState, Field, Loading, Modal, Spinner, useConfirm, useToast } from '../../shared/ui';
import { AiSummaryPanel, ReferenceNotesPanel } from './ReferencePanels';
import { openReadWindow } from './read/readWindow';
import { PDF_METADATA_MODES, READING_STATUSES, REFERENCE_TYPES, type PdfMetadataMode, type ReadingStatus, type ReferenceType } from '../../../shared/constants';
import type { ObjectEnvelope, Project, Reference } from '../../../shared/types';
import { useSession } from '../../app/session';

export function ReferencePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const ai = useAi();
  const { meta } = useSession();
  const { toast } = useToast();
  const confirm = useConfirm();
  const referenceState = useAsync(() => api.get<Reference>(`/references/${id}`), [id]);
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${id}`), [id]);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [form, setForm] = useState<Reference | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoSource, setRedoSource] = useState<'pdf' | 'url' | 'fields'>('pdf');
  const [redoMode, setRedoMode] = useState<PdfMetadataMode>(meta?.app.pdfMetadataMode ?? 'ocr');
  const [redoBusy, setRedoBusy] = useState(false);
  const [redoResult, setRedoResult] = useState<{
    raw: string | null;
    metadata: Record<string, unknown>;
    model: string | null;
    error: string | null;
    mode: PdfMetadataMode;
    source: 'pdf' | 'url' | 'fields';
    ocrText: string | null;
    imageCount: number;
    textPreview: string;
    metadataOrigin?: 'ai' | 'heuristic';
    prompt?: string | null;
  } | null>(null);

  useEffect(() => {
    if (referenceState.data) setForm(referenceState.data);
  }, [referenceState.data]);

  const pdfStatus = envelope.data?.attachments.find((attachment) => attachment.kind === 'pdf')?.textStatus;
  useEffect(() => {
    if (pdfStatus !== 'pending') return;
    const timer = setInterval(() => envelope.reload(), 2500);
    return () => clearInterval(timer);
  }, [pdfStatus, envelope.reload]);

  if (referenceState.loading) return <div className="page"><Loading rows={6} /></div>;
  if (referenceState.error) return <div className="page"><ErrorState error={referenceState.error} retry={referenceState.reload} /></div>;
  if (!form) return null;

  const set = <K extends keyof Reference>(key: K, value: Reference[K]) => setForm({ ...form, [key]: value });
  const pdf = envelope.data?.attachments.find((attachment) => attachment.kind === 'pdf');
  const page = params.get('page');
  const detectedDoi = (pdf?.meta.detectedDoi as string | undefined) ?? null;

  const openRedo = () => {
    setRedoResult(null);
    setRedoSource(pdf ? 'pdf' : form.url ? 'url' : 'fields');
    setRedoMode(meta?.app.pdfMetadataMode ?? 'ocr');
    setRedoOpen(true);
  };

  const runRedo = async () => {
    setRedoBusy(true);
    setRedoResult(null);
    try {
      const result = await api.post<NonNullable<typeof redoResult>>(`/references/${form.id}/reextract-metadata`, {
        source: redoSource,
        mode: redoMode,
      });
      setRedoResult(result);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setRedoBusy(false);
    }
  };

  const applyRedo = async () => {
    if (!redoResult || !Object.keys(redoResult.metadata).length) return;
    setBusy(true);
    try {
      const updated = await api.patch<Reference>(`/references/${form.id}`, {
        ...redoResult.metadata,
        ...(form.url ? { url: form.url } : {}),
        extra: {
          ...form.extra,
          metadataSource: redoResult.metadataOrigin ?? 'ai',
          metadataMode: redoResult.mode,
          metadataModel: redoResult.model,
          metadataPromptVersion: /\(metadata@\d+\)/.exec(redoResult.model ?? '')?.[0]?.slice(1, -1) ?? 'metadata@2',
        },
      });
      setForm(updated);
      envelope.reload();
      referenceState.reload();
      setRedoOpen(false);
      toast('Metadata applied', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Reference>(`/references/${form.id}`, {
        title: form.title,
        authors: form.authors,
        year: form.year,
        venue: form.venue,
        doi: form.doi,
        url: form.url,
        abstract: form.abstract,
        readingStatus: form.readingStatus,
        rating: form.rating,
        type: form.type,
        projectId: form.projectId,
      });
      setForm(updated);
      envelope.reload();
      referenceState.reload();
      toast('Reference saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Delete reference?', message: 'It moves to trash with its links.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/references/${form.id}`);
      toast('Reference moved to trash', 'success');
      navigate(-1);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const enrich = async () => {
    setBusy(true);
    try {
      const updated = await api.post<Reference>(`/references/${form.id}/enrich`);
      setForm(updated);
      envelope.reload();
      toast('Metadata enriched from Crossref', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyDoi = async () => {
    if (!detectedDoi) return;
    try {
      const updated = await api.patch<Reference>(`/references/${form.id}`, { doi: detectedDoi });
      setForm(updated);
      envelope.reload();
      toast(`DOI ${detectedDoi} applied`, 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const findRelated = async () => {
    setSummaryBusy(true);
    try {
      const result = await api.post<{ text: string }>('/ai/actions', { action: 'related', objectIds: [form.id] });
      setSummary(result.text);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSummaryBusy(false);
    }
  };

  const summarise = async () => {
    setSummaryBusy(true);
    try {
      const result = await api.post<{ text: string }>('/ai/actions', { action: 'summarize', objectIds: [form.id] });
      setSummary(result.text);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
        <div className="row">
          <button className="btn sm" onClick={() => void download(`/references.bib?ids=${form.id}`, `${form.citeKey}.bib`)}>
            <Icon name="download" size={14} /> BibTeX
          </button>
          <button
            className="btn sm"
            onClick={() => openReadWindow(form.id, { page: page ? Number(page) || 1 : 1 })}
            title="Open the reading workspace in a separate window"
          >
            <Icon name="book" size={14} /> Read mode
          </button>
          <button className="btn sm" onClick={() => ai.askAbout({ id: form.id, title: form.title, type: 'reference' }, 'Summarise this paper and relate it to my work.')}>
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
          <button className="btn sm" disabled={summaryBusy} onClick={() => void summarise()}>
            {summaryBusy ? 'Working…' : 'Summarise'}
          </button>
          <button className="btn sm" disabled={summaryBusy} onClick={() => void findRelated()}>Find related</button>
          <button className="btn sm" onClick={openRedo}><Icon name="refresh" size={14} /> Redo metadata</button>
        </div>
      </div>

      <div className="lit-layout">
        <div className="stack" style={{ gap: 18 }}>
          <div>
            <div className="meta-line" style={{ marginBottom: 6 }}>
              <span className="badge">{form.type}</span>
              {form.extra.metadataSource === 'ai' ? (
                <span className="badge accent" title={String(form.extra.metadataModel ?? 'AI extraction')}>
                  AI metadata
                </span>
              ) : form.extra.metadataSource === 'heuristic' ? (
                <span className="badge warning" title={String(form.extra.metadataError ?? 'The model did not return usable metadata.')}>
                  heuristic metadata
                </span>
              ) : null}
              <span>{form.citeKey}</span>
              <span>· added {formatDate(form.addedAt)}</span>
            </div>
            <input
              className="note-title-input"
              style={{ fontSize: 25 }}
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <div className="rating" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button key={value} className={(form.rating ?? 0) >= value ? 'on' : ''} onClick={() => set('rating', value === form.rating ? null : value)} aria-label={`${value} stars`}>★</button>
                ))}
              </div>
              <select
                className="select"
                style={{ width: 150, height: 32 }}
                value={form.readingStatus}
                onChange={(event) => set('readingStatus', event.target.value as ReadingStatus)}
              >
                {READING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
              <button className="btn primary sm" disabled={busy} onClick={() => void save()}>Save</button>
              <button className="btn danger sm" onClick={() => void remove()}>Delete</button>
            </div>
          </div>

          {detectedDoi && !form.doi ? (
            <div className="banner" style={{ marginBottom: 0 }}>
              <Icon name="book" size={15} />
              <span className="grow">A DOI was detected in the PDF: <span className="mono">{detectedDoi}</span></span>
              <button className="btn sm" onClick={() => void applyDoi()}>Apply DOI</button>
            </div>
          ) : null}

          {pdf ? (
            <div>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong className="small">{pdf.filename}</strong>
                <span className="tiny faint">
                  {pdf.textStatus === 'ready' ? `Text extracted${pdf.pageCount ? ` · ${pdf.pageCount} pages` : ''}` : pdf.textStatus === 'failed' ? `Extraction failed: ${pdf.textError ?? ''}` : 'Extracting text…'}
                </span>
              </div>
              <iframe
                className="pdf-frame"
                title={pdf.filename}
                src={`/api/v1/attachments/${pdf.id}/download?inline=1${page ? `#page=${page}` : ''}`}
              />
            </div>
          ) : (
            <div className="card">
              <div className="row between">
                <div>
                  <strong className="small">No PDF attached</strong>
                  <p className="small faint">Attach a PDF to enable page-level citations and full-text retrieval.</p>
                </div>
              </div>
            </div>
          )}

          <div className="card stack">
            <strong className="small">Metadata</strong>
            <div className="grid-2">
              <Field label="Authors" help="Separate with commas.">
                <input className="input" value={form.authors.join(', ')} onChange={(event) => set('authors', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
              </Field>
              <Field label="Year">
                <input className="input" type="number" value={form.year ?? ''} onChange={(event) => set('year', event.target.value ? Number(event.target.value) : null)} />
              </Field>
              <Field label="Venue">
                <input className="input" value={form.venue} onChange={(event) => set('venue', event.target.value)} />
              </Field>
              <Field label="Type">
                <select className="select" value={form.type} onChange={(event) => set('type', event.target.value as ReferenceType)}>
                  {REFERENCE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="DOI">
                <div className="row" style={{ gap: 6 }}>
                  <input className="input grow" value={form.doi ?? ''} onChange={(event) => set('doi', event.target.value || null)} />
                  <button className="btn sm" disabled={!form.doi || busy} onClick={() => void enrich()}>Crossref</button>
                </div>
              </Field>
              <Field label="URL">
                <input className="input" value={form.url ?? ''} onChange={(event) => set('url', event.target.value || null)} />
              </Field>
            </div>
            <Field label="Abstract">
              <textarea className="textarea" style={{ minHeight: 130 }} value={form.abstract} onChange={(event) => set('abstract', event.target.value)} />
            </Field>
            <Field label="Project">
              <select className="select" value={form.projectId ?? ''} onChange={(event) => set('projectId', event.target.value || null)}>
                <option value="">Unfiled / global</option>
                {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </Field>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => void save()}>Save changes</button>
            </div>
          </div>

          {form.abstract ? (
            <div className="card">
              <strong className="small">Abstract</strong>
              <div className="small muted" style={{ marginTop: 8, lineHeight: 1.7 }}>{form.abstract}</div>
            </div>
          ) : null}
        </div>

        <aside className="stack">
          <div className="card stack sm">
            <strong className="small">Tags</strong>
            {envelope.data ? <TagEditor objectId={form.id} initialTags={envelope.data.tags} /> : null}
          </div>
          <div className="card">
            <ReferenceNotesPanel
              reference={form}
              onUpdated={(updated) => {
                setForm((current) => (current ? { ...current, notes: updated.notes } : updated));
                envelope.reload();
              }}
            />
          </div>
          <div className="card">
            <AiSummaryPanel
              reference={form}
              onUpdated={(updated) => {
                setForm((current) =>
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
                envelope.reload();
              }}
            />
          </div>
          <div className="card">
            <LinksPanel objectId={form.id} />
          </div>
          <div className="card">
            {envelope.data ? (
              <AttachmentsPanel objectId={form.id} attachments={envelope.data.attachments} onChange={envelope.reload} />
            ) : null}
          </div>
        </aside>
      </div>

      {summary ? (
        <Modal title="AI analysis" onClose={() => setSummary(null)} wide>
          <Markdown text={summary} />
        </Modal>
      ) : null}

      {redoOpen ? (
        <Modal
          title="Redo metadata extraction"
          description="Run the extraction again and inspect the raw model output before applying it."
          onClose={() => setRedoOpen(false)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setRedoOpen(false)}>Close</button>
              {redoResult && Object.keys(redoResult.metadata).length ? (
                <button className="btn" disabled={busy} onClick={() => void applyRedo()}>Apply metadata</button>
              ) : null}
              <button className="btn primary" disabled={redoBusy} onClick={() => void runRedo()}>
                {redoBusy ? 'Running…' : 'Run extraction'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="grid-2">
              <Field label="Source">
                <select className="select" value={redoSource} onChange={(event) => setRedoSource(event.target.value as 'pdf' | 'url' | 'fields')}>
                  <option value="pdf" disabled={!pdf}>PDF attachment</option>
                  <option value="url" disabled={!form.url}>URL / webpage</option>
                  <option value="fields">Current metadata fields</option>
                </select>
              </Field>
              <Field label="Input mode">
                <select className="select" value={redoMode} onChange={(event) => setRedoMode(event.target.value as PdfMetadataMode)}>
                  {PDF_METADATA_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode === 'text' ? 'Extracted text' : mode === 'images' ? 'Page images (vision)' : 'OCR then text'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {redoBusy ? <Spinner label="Sending the request…" /> : null}
            {redoResult ? (
              <>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`badge ${redoResult.error ? 'danger' : 'success'}`}>{redoResult.error ? 'error' : 'ok'}</span>
                  {redoResult.metadataOrigin ? <span className="badge">{redoResult.metadataOrigin}</span> : null}
                  <span className="badge">{redoResult.source}</span>
                  <span className="badge">{redoResult.mode}</span>
                  {redoResult.model ? <span className="badge info">{redoResult.model}</span> : null}
                  {redoResult.imageCount ? <span className="badge">{redoResult.imageCount} image(s)</span> : null}
                  <span className="tiny faint">{redoResult.textPreview.length} chars of source preview</span>
                </div>
                {redoResult.error ? <div className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', marginBottom: 0 }}>{redoResult.error}</div> : null}
                <Field label="Raw model output" help="Exactly what the provider returned for the metadata call, before validation.">
                  <pre className="raw-output">{redoResult.raw ?? '(no output)'}</pre>
                </Field>
                {redoResult.prompt ? (
                  <details>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>Prompt sent</summary>
                    <pre className="raw-output">{redoResult.prompt}</pre>
                  </details>
                ) : null}
                <details>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>Parsed metadata ({Object.keys(redoResult.metadata).length} fields)</summary>
                  <pre className="raw-output">{JSON.stringify(redoResult.metadata, null, 2)}</pre>
                </details>
                {redoResult.ocrText ? (
                  <details>
                    <summary className="small muted" style={{ cursor: 'pointer' }}>OCR text</summary>
                    <pre className="raw-output">{redoResult.ocrText}</pre>
                  </details>
                ) : null}
                <details>
                  <summary className="small muted" style={{ cursor: 'pointer' }}>Source text preview</summary>
                  <pre className="raw-output">{redoResult.textPreview || '(none)'}</pre>
                </details>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
