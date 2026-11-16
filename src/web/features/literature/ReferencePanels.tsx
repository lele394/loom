import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { PDF_METADATA_MODES, type PdfMetadataMode } from '../../../shared/constants';
import type { Reference, ReferenceBookmark } from '../../../shared/types';
import { Empty, Field, Spinner, useToast } from '../../shared/ui';
import { Markdown } from '../../shared/markdown';
import { formatDateTime, relativeTime } from '../../shared/hooks';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ReferenceNotesPanel({
  reference,
  onUpdated,
}: {
  reference: Reference;
  onUpdated: (reference: Reference) => void;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(reference.notes);
  const [busy, setBusy] = useState(false);
  const loadedId = useRef(reference.id);

  useEffect(() => {
    if (loadedId.current !== reference.id) {
      loadedId.current = reference.id;
      setNotes(reference.notes);
    }
  }, [reference.id, reference.notes]);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.patch<Reference>(`/references/${reference.id}`, { notes });
      onUpdated(updated);
      toast('Personal notes saved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack sm">
      <div className="row between">
        <strong className="small">Personal notes</strong>
        <button className="btn sm" disabled={busy || notes === reference.notes} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save notes'}
        </button>
      </div>
      <textarea
        className="textarea"
        style={{ minHeight: 130 }}
        placeholder="Your own observations, separate from metadata and AI summaries."
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <span className="tiny faint">Private to you — never overwritten by AI.</span>
    </div>
  );
}

export function AiSummaryPanel({
  reference,
  onUpdated,
}: {
  reference: Reference;
  onUpdated: (reference: Reference) => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<PdfMetadataMode>('ocr');
  const [instructions, setInstructions] = useState(reference.aiSummaryInstructions);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadedId = useRef(reference.id);

  useEffect(() => {
    if (loadedId.current !== reference.id) {
      loadedId.current = reference.id;
      setInstructions(reference.aiSummaryInstructions);
    }
  }, [reference.id, reference.aiSummaryInstructions]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setJobStatus('queued');
    try {
      const { jobId } = await api.post<{ jobId: string | null }>(`/references/${reference.id}/summarize`, {
        mode,
        instructions,
      });
      if (!jobId) {
        setError('The job could not be queued.');
        setBusy(false);
        return;
      }
      for (let attempt = 0; attempt < 140; attempt++) {
        await sleep(1500);
        const job = await api.get<{ status: string; last_error: string | null }>(`/jobs/${jobId}`);
        setJobStatus(job.status);
        if (job.status === 'succeeded') {
          const updated = await api.get<Reference>(`/references/${reference.id}`);
          onUpdated(updated);
          toast('AI summary ready', 'success');
          setBusy(false);
          setJobStatus(null);
          return;
        }
        if (job.status === 'failed' || job.status === 'dead') {
          setError(job.last_error ?? 'The summary job failed.');
          setBusy(false);
          return;
        }
      }
      setError('The summary is taking too long. Check Settings → Jobs.');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack sm">
      <div className="row between">
        <strong className="small">AI summary</strong>
        {reference.aiSummaryAt ? (
          <span className="tiny faint" title={formatDateTime(reference.aiSummaryAt)}>
            {relativeTime(reference.aiSummaryAt)} · {reference.aiSummaryModel ?? ''}
          </span>
        ) : null}
      </div>
      {reference.aiSummary ? (
        <div className="ai-summary-body">
          <Markdown text={reference.aiSummary} />
        </div>
      ) : (
        <div className="empty" style={{ padding: '18px 10px' }}>
          <strong>No AI summary yet</strong>
          <span className="tiny">The summary is stored separately from your personal notes.</span>
        </div>
      )}
      <div className="grid-2" style={{ gap: 8 }}>
        <Field label="Extraction mode">
          <select className="select" value={mode} onChange={(event) => setMode(event.target.value as PdfMetadataMode)}>
            {PDF_METADATA_MODES.map((value) => (
              <option key={value} value={value}>
                {value === 'ocr' ? 'OCR then text' : value === 'images' ? 'Page images' : 'Extracted text'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={reference.aiSummary ? 'Rerun with extra instructions' : 'Optional instructions'}>
        <textarea
          className="textarea"
          style={{ minHeight: 70 }}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="e.g. Focus on the experimental method and compare it to my DVFS work. Keep it under 200 words."
        />
      </Field>
      <div className="row">
        <button className="btn primary sm" disabled={busy} onClick={() => void generate()}>
          {busy ? <><Spinner /> {jobStatus ?? 'Working…'}</> : reference.aiSummary ? 'Regenerate with AI' : 'Summarize with AI'}
        </button>
        {jobStatus ? <span className="tiny faint">{jobStatus}</span> : null}
      </div>
      {error ? <div className="error-text">{error}</div> : null}
      <span className="tiny faint">
        Summaries use the selected extraction mode; OCR is the default. They never overwrite personal notes.
      </span>
    </div>
  );
}

export function BookmarksPanel({
  referenceId,
  currentPage,
  onOpenPage,
}: {
  referenceId: string;
  currentPage: number;
  onOpenPage: (page: number) => void;
}) {
  const { toast } = useToast();
  const [bookmarks, setBookmarks] = useState<ReferenceBookmark[]>([]);
  const [page, setPage] = useState(currentPage);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await api.get<{ bookmarks: ReferenceBookmark[] }>(`/references/${referenceId}/bookmarks`);
      setBookmarks(data.bookmarks);
    } catch {
      setBookmarks([]);
    }
  };

  useEffect(() => {
    void load();
  }, [referenceId]);

  useEffect(() => {
    setPage(currentPage);
  }, [currentPage]);

  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/references/${referenceId}/bookmarks`, { page, note });
      setNote('');
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.del(`/bookmarks/${id}`);
      await load();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <details className="bookmark-panel" open>
      <summary>
        <strong className="small">Bookmarks</strong>
        <span className="tiny faint"> · {bookmarks.length}</span>
      </summary>
      <div className="stack sm" style={{ marginTop: 10 }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label="Page">
            <input
              className="input"
              type="number"
              min={1}
              style={{ width: 78 }}
              value={page}
              onChange={(event) => setPage(Math.max(1, Number(event.target.value) || 1))}
            />
          </Field>
          <Field label="Note (max 250)">
            <input
              className="input"
              maxLength={250}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What is on this page?"
            />
          </Field>
          <button className="btn sm" disabled={busy} onClick={() => void add()}>Add</button>
          <span className="tiny faint">{note.length}/250</span>
        </div>
        {bookmarks.length === 0 ? <span className="tiny faint">No bookmarks yet.</span> : null}
        {bookmarks.map((bookmark) => (
          <div className="row" key={bookmark.id} style={{ alignItems: 'flex-start' }}>
            <button className="badge accent" onClick={() => onOpenPage(bookmark.page)}>p. {bookmark.page}</button>
            <span className="small grow">{bookmark.note || <span className="faint">No note</span>}</span>
            <button className="icon-btn sm" aria-label="Delete bookmark" onClick={() => void remove(bookmark.id)}>×</button>
          </div>
        ))}
      </div>
    </details>
  );
}
