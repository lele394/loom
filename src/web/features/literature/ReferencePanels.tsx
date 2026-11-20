import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { PDF_METADATA_MODES, type PdfMetadataMode } from '../../../shared/constants';
import type { Reference } from '../../../shared/types';
import { Field, Modal, Spinner, useToast } from '../../shared/ui';
import { Icon } from '../../shared/icons';
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
  variant = 'card',
}: {
  reference: Reference;
  onUpdated: (reference: Reference) => void;
  variant?: 'card' | 'reader';
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<PdfMetadataMode>('ocr');
  const [instructions, setInstructions] = useState(reference.aiSummaryInstructions);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
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

  const controls = (
    <>
      <Field label="Extraction mode">
        <select className="select" value={mode} onChange={(event) => setMode(event.target.value as PdfMetadataMode)}>
          {PDF_METADATA_MODES.map((value) => (
            <option key={value} value={value}>
              {value === 'ocr' ? 'OCR then text' : value === 'images' ? 'Page images' : 'Extracted text'}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reference.aiSummary ? 'Extra instructions for this rerun' : 'Optional instructions'}>
        <textarea
          className="textarea"
          style={{ minHeight: 96 }}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="e.g. Focus on the experimental method and compare it to my DVFS work. Keep it under 200 words."
        />
      </Field>
      <p className="tiny faint" style={{ margin: 0 }}>
        Summaries use the selected extraction mode; OCR is the default. They never overwrite personal notes.
      </p>
    </>
  );

  const copySummary = async () => {
    if (!reference.aiSummary) return;
    try {
      await navigator.clipboard.writeText(reference.aiSummary);
      toast('Summary copied', 'success');
    } catch {
      toast('Could not copy the summary.', 'error');
    }
  };

  if (variant === 'reader') {
    return (
      <div className="read-summary">
        <div className="read-summary-bar">
          <div className="read-summary-meta">
            {reference.aiSummary ? (
              <>
                <span className="badge success">Ready</span>
                <span className="tiny faint read-summary-model" title={formatDateTime(reference.aiSummaryAt)}>
                  {relativeTime(reference.aiSummaryAt)}
                  {reference.aiSummaryModel ? ` · ${reference.aiSummaryModel}` : ''}
                </span>
              </>
            ) : (
              <span className="badge">No summary</span>
            )}
          </div>
          <span className="grow" />
          {reference.aiSummary ? (
            <button className="btn ghost sm" onClick={() => void copySummary()}>
              Copy
            </button>
          ) : null}
          <button
            className={`btn sm ${reference.aiSummary ? '' : 'primary'}`}
            disabled={busy}
            onClick={() => setEditorOpen(true)}
          >
            <Icon name="sparkles" size={13} />
            {reference.aiSummary ? 'Regenerate' : 'Generate'}
          </button>
        </div>

        {busy ? (
          <div className="read-summary-status">
            <Spinner />
            <span>{jobStatus === 'queued' ? 'Summary queued…' : 'Reading the PDF and writing the summary…'}</span>
          </div>
        ) : null}
        {error ? <div className="read-summary-error">{error}</div> : null}

        {reference.aiSummary ? (
          <div className="read-summary-body">
            <Markdown text={reference.aiSummary} />
          </div>
        ) : (
          <div className="read-summary-empty">
            <span className="read-summary-empty-icon"><Icon name="sparkles" size={22} /></span>
            <strong>No AI summary yet</strong>
            <p className="small">
              Generate a structured overview of this paper. It stays separate from your personal notes.
            </p>
            <button className="btn primary sm" disabled={busy} onClick={() => setEditorOpen(true)}>
              Generate summary
            </button>
          </div>
        )}

        {editorOpen ? (
          <Modal
            title={reference.aiSummary ? 'Regenerate AI summary' : 'Generate AI summary'}
            onClose={() => setEditorOpen(false)}
            footer={
              <>
                <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => {
                    setEditorOpen(false);
                    void generate();
                  }}
                >
                  {busy ? 'Working…' : reference.aiSummary ? 'Regenerate' : 'Generate'}
                </button>
              </>
            }
          >
            <div className="stack sm">{controls}</div>
          </Modal>
        ) : null}
      </div>
    );
  }

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
      <div className="stack sm">{controls}</div>
      <div className="row">
        <button className="btn primary sm" disabled={busy} onClick={() => void generate()}>
          {busy ? <><Spinner /> {jobStatus ?? 'Working…'}</> : reference.aiSummary ? 'Regenerate with AI' : 'Summarize with AI'}
        </button>
        {jobStatus ? <span className="tiny faint">{jobStatus}</span> : null}
      </div>
      {error ? <div className="error-text">{error}</div> : null}
    </div>
  );
}
