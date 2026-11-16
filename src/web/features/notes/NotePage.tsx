import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../../shared/api';
import { useAsync, formatDate, relativeTime } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Markdown } from '../../shared/markdown';
import { useAi } from '../../shared/aiContext';
import {
  AttachmentsPanel,
  LinksPanel,
  TagEditor,
  formatBytes,
} from '../../shared/components';
import { Empty, ErrorState, Loading, Modal, useConfirm, useToast } from '../../shared/ui';
import { NOTE_BLOCK_TYPES, type NoteBlockType } from '../../../shared/constants';
import { NOTE_TEMPLATE_LABELS } from '../../../shared/templates';
import type { Block, Note, NoteVersion, ObjectEnvelope, Project } from '../../../shared/types';

interface Draft {
  title: string;
  blocks: Block[];
  version: number;
  savedAt: string;
}

function newBlockId(): string {
  return `blk_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'h1': return `# ${block.text}`;
        case 'h2': return `## ${block.text}`;
        case 'h3': return `### ${block.text}`;
        case 'bullet': return `- ${block.text}`;
        case 'numbered': return `1. ${block.text}`;
        case 'todo': return `- [${block.meta?.checked ? 'x' : ' '}] ${block.text}`;
        case 'quote': return `> ${block.text}`;
        case 'code': return `\`\`\`${block.meta?.language ?? ''}\n${block.text}\n\`\`\``;
        case 'callout': return `> [!${block.meta?.tone ?? 'info'}]\n> ${block.text}`;
        case 'divider': return '---';
        case 'equation': return `$$\n${block.text}\n$$`;
        default: return block.text;
      }
    })
    .join('\n\n');
}

const TYPE_LABELS: Record<NoteBlockType, string> = {
  paragraph: 'Text',
  h1: 'Title',
  h2: 'Heading',
  h3: 'Subheading',
  bullet: 'Bullets',
  numbered: 'Numbered',
  todo: 'To-do',
  quote: 'Quote',
  code: 'Code',
  callout: 'Callout',
  divider: 'Divider',
  equation: 'Equation',
  reference: 'Reference',
  task: 'Task',
};

export function NotePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const ai = useAi();
  const noteState = useAsync(() => api.get<Note>(`/notes/${id}`), [id]);
  const envelope = useAsync(() => api.get<ObjectEnvelope>(`/objects/${id}`), [id]);
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [status, setStatus] = useState<'saved' | 'saving' | 'dirty' | 'conflict'>('saved');
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(false);
  const [localDraft, setLocalDraft] = useState<Draft | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const editSeqRef = useRef(0);
  const latestRef = useRef({ title: '', blocks: [] as Block[], version: 0, dirty: false, pinned: false });
  latestRef.current = { title, blocks, version, dirty, pinned };

  useEffect(() => {
    if (!noteState.data || !id) return;
    const note = noteState.data;
    setBlocks(note.blocks.length ? note.blocks : [{ id: newBlockId(), type: 'paragraph', text: '' }]);
    setTitle(note.title);
    setPinned(note.pinned);
    setVersion(note.version);
    setDirty(false);
    setStatus('saved');
    setHydrated(true);
    setSaveError(null);
    try {
      const raw = localStorage.getItem(`loom-note-draft:${id}`);
      if (raw) {
        const draft = JSON.parse(raw) as Draft;
        const differs = draft.title !== note.title || JSON.stringify(draft.blocks) !== JSON.stringify(note.blocks);
        if (differs) setLocalDraft(draft);
        else localStorage.removeItem(`loom-note-draft:${id}`);
      }
    } catch {
      // ignore malformed drafts
    }
  }, [id, noteState.data]);

  const persistDraft = (nextTitle: string, nextBlocks: Block[], nextVersion: number) => {
    if (!id) return;
    try {
      localStorage.setItem(
        `loom-note-draft:${id}`,
        JSON.stringify({ title: nextTitle, blocks: nextBlocks, version: nextVersion, savedAt: new Date().toISOString() }),
      );
    } catch {
      // storage full/disabled
    }
  };

  const save = async (force = false) => {
    if (!id || savingRef.current) return;
    if (!force && !latestRef.current.dirty) return;
    const snapshot = { ...latestRef.current, seq: editSeqRef.current };
    savingRef.current = true;
    setStatus('saving');
    try {
      const saved = await api.put<Note>(`/notes/${id}`, {
        title: snapshot.title.trim() || 'Untitled note',
        blocks: snapshot.blocks,
        expectedVersion: snapshot.version,
        pinned: snapshot.pinned,
        ...(force ? { force: true } : {}),
      });
      setVersion(saved.version);
      setSaveError(null);
      setConflict(false);
      if (editSeqRef.current !== snapshot.seq) {
        // The user typed while the request was in flight; keep their newer draft and save again.
        setStatus('dirty');
        latestRef.current = { ...latestRef.current, version: saved.version };
        setTimeout(() => void save(), 900);
      } else {
        setTitle(saved.title);
        setPinned(saved.pinned);
        setBlocks(saved.blocks);
        setDirty(false);
        setStatus('saved');
        try {
          localStorage.removeItem(`loom-note-draft:${id}`);
          setLocalDraft(null);
        } catch {
          // ignore
        }
        latestRef.current = { ...saved, dirty: false, pinned: saved.pinned };
      }
    } catch (error) {
      const apiError = error as { code?: string; message?: string };
      if (apiError.code === 'version_conflict') {
        setStatus('conflict');
        setConflict(true);
      } else {
        setStatus('dirty');
        setSaveError(apiError.message ?? 'Save failed');
      }
    } finally {
      savingRef.current = false;
    }
  };

  useEffect(() => {
    if (!hydrated || !dirty) return;
    persistDraft(title, blocks, version);
    const timer = setTimeout(() => void save(), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, title, dirty, hydrated, version]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && latestRef.current.dirty) void save();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (latestRef.current.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const blockId = params.get('block');
    if (!blockId || !blocks.length) return;
    const element = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (element) {
      element.scrollIntoView({ block: 'center' });
      element.style.boxShadow = '0 0 0 2px var(--ring)';
      setTimeout(() => (element.style.boxShadow = ''), 2400);
    }
  }, [params, blocks]);

  const markDirty = () => {
    editSeqRef.current += 1;
    setDirty(true);
    setStatus('dirty');
  };

  const updateBlock = (index: number, patch: Partial<Block>) => {
    setBlocks((current) => current.map((block, i) => (i === index ? { ...block, ...patch } : block)));
    markDirty();
  };

  const addBlock = (afterIndex: number, type: NoteBlockType = 'paragraph') => {
    const block: Block = { id: newBlockId(), type, text: '' };
    setBlocks((current) => {
      const next = [...current];
      next.splice(afterIndex + 1, 0, block);
      return next;
    });
    markDirty();
    setTimeout(() => {
      const element = document.querySelector<HTMLTextAreaElement>(`[data-block-id="${block.id}"]`);
      element?.focus();
    }, 20);
  };

  const removeBlock = (index: number) => {
    setBlocks((current) => {
      if (current.length === 1) return [{ ...current[0]!, text: '' }];
      return current.filter((_, i) => i !== index);
    });
    markDirty();
    setTimeout(() => {
      const textarea = document.querySelectorAll<HTMLTextAreaElement>('.block-textarea');
      textarea[Math.max(0, index - 1)]?.focus();
    }, 20);
  };

  const moveBlock = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    setBlocks((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    markDirty();
  };

  const onBlockKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number, block: Block) => {
    if (event.key === 'Enter' && !event.shiftKey && block.type !== 'code' && block.type !== 'equation') {
      event.preventDefault();
      addBlock(index, 'paragraph');
      return;
    }
    if (event.key === 'Backspace' && !block.text && index > 0) {
      event.preventDefault();
      removeBlock(index);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      moveBlock(index, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (event.key === ' ' && !event.shiftKey) {
      const text = block.text;
      const shortcuts: [string, NoteBlockType][] = [
        ['###', 'h3'],
        ['##', 'h2'],
        ['#', 'h1'],
        ['-', 'bullet'],
        ['1.', 'numbered'],
        ['>', 'quote'],
        ['[]', 'todo'],
        ['```', 'code'],
        ['$$', 'equation'],
      ];
      const match = shortcuts.find(([prefix]) => text === prefix);
      if (match) {
        event.preventDefault();
        updateBlock(index, { type: match[1], text: '' });
      }
    }
  };

  const overwrite = async () => {
    setConflict(false);
    await save(true);
  };

  const reload = () => {
    setConflict(false);
    setDirty(false);
    noteState.reload();
  };

  const openVersions = async () => {
    if (!id) return;
    setVersionsOpen(true);
    try {
      const data = await api.get<{ versions: NoteVersion[] }>(`/notes/${id}/versions`);
      setVersions(data.versions);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const restoreVersion = async (versionNumber: number) => {
    if (!id) return;
    const ok = await confirm({
      title: `Restore version ${versionNumber}?`,
      message: 'A new version is created from the snapshot. Nothing is lost.',
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      await api.post(`/notes/${id}/versions/${versionNumber}/restore`);
      setVersionsOpen(false);
      setDirty(false);
      noteState.reload();
      toast('Version restored', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const changeProject = async (projectId: string | null) => {
    if (!id) return;
    try {
      await api.patch(`/objects/${id}`, { projectId });
      envelope.reload();
      toast('Note moved', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const previewText = useMemo(() => blocksToMarkdown(blocks), [blocks]);

  if (noteState.loading) return <div className="page"><Loading rows={6} /></div>;
  if (noteState.error) return <div className="page"><ErrorState error={noteState.error} retry={noteState.reload} /></div>;
  if (!noteState.data) return null;
  const note = noteState.data;

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 12 }}>
        <button className="btn ghost sm" onClick={() => navigate(-1)}>
          <Icon name="chevron-left" size={15} /> Back
        </button>
        <div className="row" style={{ gap: 6 }}>
          <span className={`badge ${status === 'conflict' ? 'danger' : status === 'saved' ? 'success' : ''}`}>
            {status === 'saving' ? 'Saving…' : status === 'dirty' ? 'Unsaved' : status === 'conflict' ? 'Conflict' : 'Saved'}
          </span>
          <button className="btn sm" onClick={() => setPreview((value) => !value)}>
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              setPinned((value) => !value);
              markDirty();
            }}
          >
            <Icon name="pin" size={14} /> {pinned ? 'Pinned' : 'Pin'}
          </button>
          <button className="btn sm" onClick={() => void openVersions()}>History</button>
          <button className="btn sm" onClick={() => void download(`/export/notes/${note.id}.md`, `${note.title}.md`)}>
            <Icon name="download" size={14} /> Export
          </button>
          <button
            className="btn sm"
            onClick={() => ai.askAbout({ id: note.id, title, type: 'note' }, 'Summarise this note and identify open threads.')}
          >
            <Icon name="sparkles" size={14} /> Ask AI
          </button>
        </div>
      </div>

      {localDraft ? (
        <div className="banner warning" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
          <Icon name="clock" size={15} />
          <span className="grow">An unsaved local draft from {relativeTime(localDraft.savedAt)} was recovered.</span>
          <button className="btn sm" onClick={() => {
            setTitle(localDraft.title);
            setBlocks(localDraft.blocks);
            setLocalDraft(null);
            markDirty();
          }}>Restore draft</button>
          <button className="btn sm" onClick={() => {
            localStorage.removeItem(`loom-note-draft:${note.id}`);
            setLocalDraft(null);
          }}>Discard</button>
        </div>
      ) : null}

      {saveError ? <div className="banner" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{saveError}</div> : null}

      <div className="note-body-wrap">
        <div>
          <input
            className="note-title-input"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              markDirty();
            }}
            placeholder="Untitled note"
          />
          <div className="meta-line" style={{ marginBottom: 18 }}>
            <span>{NOTE_TEMPLATE_LABELS[note.template]}</span>
            <span>·</span>
            <span>{blocks.reduce((sum, block) => sum + (block.text.trim() ? block.text.trim().split(/\s+/).length : 0), 0)} words</span>
            <span>·</span>
            <span>Updated {relativeTime(note.updatedAt)}</span>
            {dirty ? <><span>·</span><span>draft saved locally</span></> : null}
          </div>

          {preview ? (
            <div className="note-reading">
              <Markdown text={previewText} onWikilink={(value) => navigate(`/search?q=${encodeURIComponent(value)}`)} />
            </div>
          ) : (
            <div className="note-editor">
              {blocks.map((block, index) => (
                <div className="block-row" data-type={block.type} key={block.id} data-block-id={block.id}>
                  <div className="block-handle">
                    {block.type === 'todo' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(block.meta?.checked)}
                        onChange={(event) => updateBlock(index, { meta: { ...block.meta, checked: event.target.checked } })}
                        aria-label="Toggle to-do"
                      />
                    ) : (
                      <select
                        className="block-type"
                        value={block.type}
                        onChange={(event) => updateBlock(index, { type: event.target.value as NoteBlockType })}
                        title="Block type"
                      >
                        {NOTE_BLOCK_TYPES.map((type) => (
                          <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                        ))}
                      </select>
                    )}
                    <div className="row" style={{ gap: 0 }}>
                      <button className="icon-btn sm" aria-label="Move block up" onClick={() => moveBlock(index, -1)}>
                        <Icon name="arrow-up" size={11} />
                      </button>
                      <button className="icon-btn sm" aria-label="Move block down" onClick={() => moveBlock(index, 1)}>
                        <Icon name="arrow-down" size={11} />
                      </button>
                      <button className="icon-btn sm" aria-label="Delete block" onClick={() => removeBlock(index)}>
                        <Icon name="close" size={11} />
                      </button>
                    </div>
                  </div>
                  {block.type === 'divider' ? (
                    <div className="block-preview" onClick={() => updateBlock(index, { type: 'paragraph' })}>
                      <hr />
                    </div>
                  ) : (
                    <textarea
                      className="block-textarea"
                      data-block-id={block.id}
                      value={block.text}
                      rows={1}
                      placeholder={block.type === 'paragraph' ? "Write… use [[Title]] to link, '/' shortcuts like '# ' or '- '" : ''}
                      onChange={(event) => updateBlock(index, { text: event.target.value })}
                      onKeyDown={(event) => onBlockKeyDown(event, index, block)}
                      ref={(element) => {
                        if (element) {
                          element.style.height = 'auto';
                          element.style.height = `${element.scrollHeight}px`;
                        }
                      }}
                    />
                  )}
                </div>
              ))}
              <button className="column-add" style={{ marginTop: 8 }} onClick={() => addBlock(blocks.length - 1)}>
                + Add block
              </button>
            </div>
          )}
        </div>

        <aside className="note-inspector">
          <div className="stack sm">
            <strong className="small">Details</strong>
            <div className="row between">
              <span className="tiny faint">Created</span>
              <span className="tiny">{formatDate(note.createdAt)}</span>
            </div>
            <div className="row between">
              <span className="tiny faint">Template</span>
              <span className="tiny">{NOTE_TEMPLATE_LABELS[note.template]}</span>
            </div>
            <label className="field">
              <span className="label">Project</span>
              <select
                className="select"
                value={envelope.data?.object.projectId ?? ''}
                onChange={(event) => void changeProject(event.target.value || null)}
              >
                <option value="">Unfiled / global</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="stack sm">
            <strong className="small">Tags</strong>
            {envelope.data ? (
              <TagEditor objectId={note.id} initialTags={envelope.data.tags} />
            ) : <span className="tiny faint">Loading…</span>}
          </div>

          <div className="stack sm">
            <LinksPanel objectId={note.id} />
          </div>

          <div className="stack sm">
            {envelope.data ? (
              <AttachmentsPanel objectId={note.id} attachments={envelope.data.attachments} onChange={envelope.reload} compact />
            ) : null}
          </div>
        </aside>
      </div>

      {conflict ? (
        <Modal
          title="This note changed elsewhere"
          onClose={() => setConflict(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConflict(false)}>Keep editing</button>
              <button className="btn" onClick={reload}>Reload server version</button>
              <button className="btn primary" onClick={() => void overwrite()}>Overwrite (snapshot kept)</button>
            </>
          }
        >
          <p className="muted">
            Another tab or session saved a newer version. Reloading discards your local changes; overwriting keeps them and
            stores the previous version in history.
          </p>
        </Modal>
      ) : null}

      {versionsOpen ? (
        <Modal title="Version history" onClose={() => setVersionsOpen(false)}>
          <div className="stack sm">
            {versions.length === 0 ? <Empty title="No versions yet" icon="clock">Versions are created as you edit.</Empty> : null}
            {versions.map((item) => (
              <div className="list-row" key={item.id}>
                <div className="grow">
                  <div className="small">Version {item.version}</div>
                  <div className="tiny faint">{formatDate(item.createdAt)} · {item.reason}</div>
                </div>
                <button className="btn sm" onClick={() => void restoreVersion(item.version)}>Restore</button>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
