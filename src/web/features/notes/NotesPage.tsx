import { useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Empty, Field, Loading, Modal, ErrorState, useToast } from '../../shared/ui';
import { NOTE_TEMPLATE_LABELS } from '../../../shared/templates';
import type { NoteTemplate } from '../../../shared/constants';
import { NOTE_TEMPLATES } from '../../../shared/constants';
import type { Note } from '../../../shared/types';
import type { ProjectOutlet } from '../../shared/projectContext';

export function NotesPage() {
  const outlet = useOutletContext<ProjectOutlet | undefined>();
  const projectId = outlet?.project?.id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const notes = useAsync(
    () => api.get<{ notes: Note[] }>(`/notes?limit=100${projectId ? `&projectId=${projectId}` : ''}`),
    [projectId],
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState<NoteTemplate>('research');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreateOpen(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const create = async () => {
    setBusy(true);
    try {
      const note = await api.post<Note>('/notes', { title: title || 'Untitled note', template, projectId: projectId ?? null });
      setCreateOpen(false);
      setTitle('');
      navigate(`/notes/${note.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const visible = (notes.data?.notes ?? []).filter((note) =>
    query.trim() ? note.title.toLowerCase().includes(query.toLowerCase()) : true,
  );

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Notes</h2>
          <p className="small muted">Blocks, wikilinks and version history.</p>
        </div>
        <div className="row">
          <input className="input" style={{ width: 200, height: 34 }} placeholder="Filter notes…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="btn primary" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={15} /> New note
          </button>
        </div>
      </div>

      {notes.loading ? <Loading rows={5} /> : null}
      {notes.error ? <ErrorState error={notes.error} retry={notes.reload} /> : null}
      {!notes.loading && visible.length === 0 ? (
        <div className="card">
          <Empty
            title={query ? 'No note matches' : 'No notes yet'}
            icon="note"
            action={<button className="btn primary" onClick={() => setCreateOpen(true)}>Write the first note</button>}
          >
            {query ? 'Try a different filter.' : 'Templates give you a starting structure; blocks keep the note searchable and citable.'}
          </Empty>
        </div>
      ) : null}

      {visible.length ? (
        <div className="card flush">
          <div className="list">
            {visible.map((note) => (
              <Link className="list-row" key={note.id} to={`/notes/${note.id}`}>
                <Icon name="note" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title truncate">{note.title}</div>
                  <div className="tiny faint">
                    {NOTE_TEMPLATE_LABELS[note.template]} · {note.wordCount} words
                  </div>
                </div>
                <span className="tiny faint">{formatDate(note.updatedAt)}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <Modal
          title="New note"
          onClose={() => setCreateOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setCreateOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void create()}>Create note</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Title">
              <input className="input" autoFocus value={title} placeholder="Untitled note" onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Template">
              <select className="select" value={template} onChange={(event) => setTemplate(event.target.value as NoteTemplate)}>
                {NOTE_TEMPLATES.map((value) => (
                  <option key={value} value={value}>{NOTE_TEMPLATE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
