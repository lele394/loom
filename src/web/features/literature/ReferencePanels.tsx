import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api } from '../../shared/api';
import { PDF_METADATA_MODES, type PdfMetadataMode } from '../../../shared/constants';
import type { Reference, SummaryVersion, SummaryVersionSummary } from '../../../shared/types';
import { Field, Modal, Spinner, useConfirm, useToast } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { Markdown } from '../../shared/markdown';
import { formatDateTime, relativeTime } from '../../shared/hooks';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SUMMARY_SCALE_MIN = 0.75;
const SUMMARY_SCALE_MAX = 3;
const SUMMARY_SCALE_STEP = 0.1;

function readSummaryScale(): number {
  try {
    const value = Number(localStorage.getItem('loom-read-summary-scale'));
    return Number.isFinite(value) && value >= SUMMARY_SCALE_MIN && value <= SUMMARY_SCALE_MAX
      ? value
      : 1;
  } catch {
    return 1;
  }
}

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
  const confirm = useConfirm();
  const [mode, setMode] = useState<PdfMetadataMode>('ocr');
  const [instructions, setInstructions] = useState(reference.aiSummaryInstructions);
  const [busy, setBusy] = useState(false);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [summaryScale, setSummaryScale] = useState(readSummaryScale);
  const [summaryView, setSummaryView] = useState<'summary' | 'versions'>('summary');
  const [versions, setVersions] = useState<SummaryVersionSummary[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<SummaryVersion | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionTitle, setVersionTitle] = useState('');
  const [versionTitleSaving, setVersionTitleSaving] = useState(false);
  const [versionDeleting, setVersionDeleting] = useState(false);
  const loadedId = useRef(reference.id);

  useEffect(() => {
    if (loadedId.current !== reference.id) {
      loadedId.current = reference.id;
      setInstructions(reference.aiSummaryInstructions);
      setSummaryView('summary');
      setSelectedVersion(null);
    }
  }, [reference.id, reference.aiSummaryInstructions]);

  useEffect(() => {
    try {
      localStorage.setItem('loom-read-summary-scale', String(summaryScale));
    } catch {
      // Scaling still works for this session if storage is disabled.
    }
  }, [summaryScale]);

  const loadVersions = async () => {
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const data = await api.get<{ versions: SummaryVersionSummary[] }>(
        `/references/${reference.id}/summary-versions`,
      );
      setVersions(data.versions);
    } catch (caught) {
      setVersionsError((caught as Error).message);
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    if (variant !== 'reader') return;
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, reference.id, reference.aiSummaryAt]);

  const openVersion = async (id: string) => {
    setVersionLoading(true);
    setVersionsError(null);
    try {
      const version = await api.get<SummaryVersion>(`/summary-versions/${id}`);
      setSelectedVersion(version);
      setVersionTitle(version.title);
    } catch (caught) {
      setVersionsError((caught as Error).message);
    } finally {
      setVersionLoading(false);
    }
  };

  const saveVersionTitle = async () => {
    if (!selectedVersion) return;
    setVersionTitleSaving(true);
    try {
      const updated = await api.patch<SummaryVersionSummary>(
        `/summary-versions/${selectedVersion.id}`,
        { title: versionTitle },
      );
      setSelectedVersion({ ...selectedVersion, title: updated.title });
      setVersions((current) =>
        current.map((version) => (version.id === updated.id ? updated : version)),
      );
      toast('Version title saved', 'success');
    } catch (caught) {
      toast((caught as Error).message, 'error');
    } finally {
      setVersionTitleSaving(false);
    }
  };

  const deleteSelectedVersion = async () => {
    if (!selectedVersion) return;
    const ok = await confirm({
      title: 'Delete summary version?',
      message: selectedVersion.title
        ? `“${selectedVersion.title}” will be removed from the summary history.`
        : 'This summary snapshot will be removed from the history.',
      confirmLabel: 'Delete summary',
      danger: true,
    });
    if (!ok) return;
    setVersionDeleting(true);
    try {
      const result = await api.del<{ ok: true; clearedCurrent: boolean }>(
        `/summary-versions/${selectedVersion.id}`,
      );
      setSelectedVersion(null);
      await loadVersions();
      if (result.clearedCurrent) {
        const updated = await api.get<Reference>(`/references/${reference.id}`);
        onUpdated(updated);
      }
      toast('Summary version deleted', 'success');
    } catch (caught) {
      toast((caught as Error).message, 'error');
    } finally {
      setVersionDeleting(false);
    }
  };

  const changeSummaryScale = (delta: number) => {
    setSummaryScale((current) =>
      Math.round(
        Math.min(SUMMARY_SCALE_MAX, Math.max(SUMMARY_SCALE_MIN, current + delta)) * 10,
      ) / 10,
    );
  };

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
    const currentVersion = versions.find(
      (version) => version.createdAt === reference.aiSummaryAt,
    );
    return (
      <div
        className="read-summary"
        style={
          {
            '--summary-scale': summaryScale,
            '--summary-measure': `${Math.round(78 * 13.5 * summaryScale)}px`,
          } as CSSProperties
        }
      >
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
          <div className="read-notes-scale" role="group" aria-label="Summary text size">
            <button
              className="icon-btn sm"
              title="Smaller summary text"
              aria-label="Smaller summary text"
              disabled={summaryScale <= SUMMARY_SCALE_MIN}
              onClick={() => changeSummaryScale(-SUMMARY_SCALE_STEP)}
            >
              <Icon name="minus" size={12} />
            </button>
            <button
              className="btn ghost sm"
              title="Reset summary text size to 100%"
              onClick={() => setSummaryScale(1)}
            >
              {Math.round(summaryScale * 100)}%
            </button>
            <button
              className="icon-btn sm"
              title="Larger summary text"
              aria-label="Larger summary text"
              disabled={summaryScale >= SUMMARY_SCALE_MAX}
              onClick={() => changeSummaryScale(SUMMARY_SCALE_STEP)}
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          {summaryView === 'summary' && reference.aiSummary ? (
            <button className="btn ghost sm" onClick={() => void copySummary()}>
              Copy
            </button>
          ) : null}
          {summaryView === 'summary' ? (
            <button
              className={`btn sm ${reference.aiSummary ? '' : 'primary'}`}
              disabled={busy}
              onClick={() => setEditorOpen(true)}
            >
              <Icon name="sparkles" size={13} />
              {reference.aiSummary ? 'Regenerate' : 'Generate'}
            </button>
          ) : null}
        </div>

        <div className="read-summary-tabs" role="tablist" aria-label="Summary views">
          <button
            role="tab"
            aria-selected={summaryView === 'summary'}
            className={summaryView === 'summary' ? 'active' : ''}
            onClick={() => setSummaryView('summary')}
          >
            Summary
          </button>
          <button
            role="tab"
            aria-selected={summaryView === 'versions'}
            className={summaryView === 'versions' ? 'active' : ''}
            onClick={() => {
              setSummaryView('versions');
              setSelectedVersion(null);
            }}
          >
            Versions
            {versions.length ? <span className="badge">{versions.length}</span> : null}
          </button>
        </div>

        {summaryView === 'summary' ? (
          <>
            {busy ? (
              <div className="read-summary-status">
                <Spinner />
                <span>{jobStatus === 'queued' ? 'Summary queued…' : 'Reading the PDF and writing the summary…'}</span>
              </div>
            ) : null}
            {error ? <div className="read-summary-error">{error}</div> : null}

            {reference.aiSummary ? (
              <div className="read-summary-body">
                {currentVersion?.title ? (
                  <div className="read-summary-heading">{currentVersion.title}</div>
                ) : null}
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
          </>
        ) : (
          <div className="read-summary-body summary-versions-body">
            {selectedVersion ? (
              <div className="summary-version-detail">
                <div className="row between">
                  <button className="btn ghost sm" onClick={() => setSelectedVersion(null)}>
                    <Icon name="chevron-left" size={13} /> All versions
                  </button>
                  <button
                    className="btn danger sm"
                    disabled={versionDeleting}
                    onClick={() => void deleteSelectedVersion()}
                  >
                    {versionDeleting ? 'Deleting…' : 'Delete summary'}
                  </button>
                </div>
                <div className="summary-version-title-row">
                  <input
                    className="input"
                    maxLength={250}
                    value={versionTitle}
                    onChange={(event) => setVersionTitle(event.target.value)}
                    placeholder="Add a title for this version"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveVersionTitle();
                      }
                    }}
                  />
                  <button
                    className="btn sm"
                    disabled={
                      versionTitleSaving || versionTitle.trim() === selectedVersion.title
                    }
                    onClick={() => void saveVersionTitle()}
                  >
                    {versionTitleSaving ? 'Saving…' : 'Save title'}
                  </button>
                </div>
                <div className="row between">
                  <span className="tiny faint">
                    {formatDateTime(selectedVersion.createdAt)}
                    {selectedVersion.model ? ` · ${selectedVersion.model}` : ''}
                    {selectedVersion.mode ? ` · ${selectedVersion.mode}` : ''}
                  </span>
                  <span className="tiny faint">{versionTitle.length}/250</span>
                </div>
                <div className="summary-version-instructions">
                  <div className="tiny faint">Instructions</div>
                  <div className="small">
                    {selectedVersion.instructions || 'No extra instructions were used.'}
                  </div>
                </div>
                <div className="summary-version-summary">
                  <Markdown text={selectedVersion.summaryMarkdown} />
                </div>
              </div>
            ) : (
              <>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <strong className="small">Summary versions</strong>
                  <button className="btn ghost sm" onClick={() => void loadVersions()}>
                    Refresh
                  </button>
                </div>
                {versionsLoading ? <Spinner label="Loading versions…" /> : null}
                {versionsError ? <div className="read-summary-error">{versionsError}</div> : null}
                {!versionsLoading && !versions.length ? (
                  <div className="read-summary-empty" style={{ minHeight: 180 }}>
                    <Icon name="clock" size={22} />
                    <strong>No versions yet</strong>
                    <p className="small">Every generated summary will be archived here with its prompt.</p>
                  </div>
                ) : null}
                <div className="summary-version-list">
                  {versions.map((version) => (
                    <button
                      className="summary-version-item"
                      key={version.id}
                      onClick={() => void openVersion(version.id)}
                    >
                      <div className="row between" style={{ gap: 8 }}>
                        <strong className="small truncate">
                          {version.title || 'Untitled summary'}
                        </strong>
                        <span className="tiny faint">{relativeTime(version.createdAt)}</span>
                      </div>
                      <span className="tiny faint">
                        {formatDateTime(version.createdAt)}
                        {version.model ? ` · ${version.model}` : ''}
                        {version.mode ? ` · ${version.mode}` : ''}
                        {` · ${version.charCount} chars`}
                      </span>
                      {version.instructions ? (
                        <span className="tiny faint truncate">
                          Instructions: {version.instructions}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {versionLoading ? <Spinner label="Opening version…" /> : null}
              </>
            )}
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
