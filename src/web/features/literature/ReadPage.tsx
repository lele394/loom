import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync } from '../../shared/hooks';
import { useAi } from '../../shared/aiContext';
import { useToast, ErrorState, Loading, Empty } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { AiSummaryPanel, BookmarksPanel, ReferenceNotesPanel } from './ReferencePanels';
import type { ObjectEnvelope, Reference } from '../../../shared/types';

export function ReadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const ai = useAi();
  const { toast } = useToast();
  const referenceState = useAsync(() => api.get<Reference>(`/references/${id}`), [id]);
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${id}`), [id]);
  const [reference, setReference] = useState<Reference | null>(null);
  const [page, setPage] = useState(() => Math.max(1, Number(params.get('page') ?? 1) || 1));
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (referenceState.data) setReference(referenceState.data);
  }, [referenceState.data]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (page > 1) next.set('page', String(page));
    else next.delete('page');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  if (referenceState.loading) return <div className="page"><Loading rows={4} /></div>;
  if (referenceState.error) return <div className="page"><ErrorState error={referenceState.error} retry={referenceState.reload} /></div>;
  if (!reference) return null;

  const pdf = envelope.data?.attachments.find((attachment) => attachment.kind === 'pdf');
  const pdfUrl = pdf ? `/api/v1/attachments/${pdf.id}/download?inline=1#page=${page}` : null;

  const askAi = () => {
    ai.setContext([{ id: reference.id, title: reference.title, type: 'reference' }]);
    ai.setScope('selection');
    ai.setOpen(true);
  };

  const attachAnnotated = async (file: File) => {
    setUploading(true);
    try {
      await api.upload(`/references/${reference.id}/pdf`, file);
      envelope.reload();
      toast('Annotated copy attached', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = '';
    }
  };

  return (
    <div className="read-page">
      <div className="row between read-head">
        <div className="row" style={{ minWidth: 0 }}>
          <button className="btn ghost sm" onClick={() => navigate(`/literature/${reference.id}`)}>
            <Icon name="chevron-left" size={15} /> Reference
          </button>
          <strong className="read-title truncate">{reference.title}</strong>
          {reference.year ? <span className="badge">{reference.year}</span> : null}
        </div>
        <div className="row">
          <button className="btn sm" onClick={askAi}><Icon name="sparkles" size={14} /> AI chat</button>
          <button className="btn sm" onClick={() => navigate('/settings?tab=ai')}>AI settings</button>
        </div>
      </div>

      <div className="read-layout">
        <section className="read-pdf">
          <div className="read-toolbar">
            <span className="small muted">Page</span>
            <button className="icon-btn sm" aria-label="Previous page" onClick={() => setPage((value) => Math.max(1, value - 1))}>
              <Icon name="chevron-left" size={14} />
            </button>
            <input
              className="input"
              type="number"
              min={1}
              value={page}
              onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
              style={{ width: 72 }}
            />
            <button className="icon-btn sm" aria-label="Next page" onClick={() => setPage((value) => value + 1)}>
              <Icon name="chevron-right" size={14} />
            </button>
            {pdf ? (
              <a className="btn sm" href={`/api/v1/attachments/${pdf.id}/download?inline=1#page=${page}`} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> Open externally
              </a>
            ) : null}
            <span className="grow" />
            <span className="tiny faint">Firefox's PDF viewer manages its own annotations. Use bookmarks here, or attach the annotated PDF below.</span>
          </div>
          {pdfUrl ? (
            <iframe key={pdfUrl} className="read-frame" title={`${reference.title} PDF`} src={pdfUrl} />
          ) : (
            <div className="empty" style={{ minHeight: 360 }}>
              <strong>No PDF attached</strong>
              <span className="small">Use the reference page to upload a PDF.</span>
              <button className="btn sm" onClick={() => navigate(`/literature/${reference.id}`)}>Back to reference</button>
            </div>
          )}
        </section>

        <aside className="read-side">
          <div className="card">
            <ReferenceNotesPanel
              reference={reference}
              onUpdated={(updated) => {
                setReference(updated);
                referenceState.reload();
              }}
            />
          </div>
          <div className="card">
            <AiSummaryPanel
              reference={reference}
              onUpdated={(updated) => {
                setReference(updated);
                referenceState.reload();
              }}
            />
          </div>
          <div className="card">
            <BookmarksPanel referenceId={reference.id} currentPage={page} onOpenPage={setPage} />
          </div>
          <div className="card stack sm">
            <strong className="small">Annotated copy</strong>
            <p className="tiny faint">
              Firefox's built-in PDF editor cannot be captured by a web page. Download the annotated PDF from Firefox,
              then attach that copy here (it becomes an additional attachment).
            </p>
            <input
              ref={uploadRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attachAnnotated(file);
              }}
            />
            <button className="btn sm" disabled={uploading} onClick={() => uploadRef.current?.click()}>
              {uploading ? 'Uploading…' : 'Attach annotated PDF'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
