import { useEffect, useState } from 'react';
import type { ReferenceBookmark } from '../../../../shared/types';
import { api } from '../../../shared/api';
import { Icon } from '../../../shared/icons';
import { Field, useToast } from '../../../shared/ui';

export function ReadBookmarksPanel({
  referenceId,
  currentPage,
  bookmarks,
  onChanged,
  onOpenPage,
  onInsert,
}: {
  referenceId: string;
  currentPage: number;
  bookmarks: ReferenceBookmark[];
  onChanged: () => void;
  onOpenPage: (page: number) => void;
  onInsert: (bookmark: ReferenceBookmark) => void;
}) {
  const { toast } = useToast();
  const [page, setPage] = useState(currentPage);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');

  useEffect(() => setPage(currentPage), [currentPage]);

  const add = async () => {
    setBusy(true);
    try {
      await api.post(`/references/${referenceId}/bookmarks`, { page, note });
      setNote('');
      onChanged();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async (bookmark: ReferenceBookmark) => {
    try {
      await api.patch(`/bookmarks/${bookmark.id}`, { note: editingNote });
      setEditingId(null);
      onChanged();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const remove = async (bookmark: ReferenceBookmark) => {
    try {
      await api.del(`/bookmarks/${bookmark.id}`);
      onChanged();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="read-bookmarks">
      <div className="read-bookmark-form">
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <Field label="Page">
            <input
              className="input"
              type="number"
              min={1}
              style={{ width: 74 }}
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
              onKeyDown={(event) => {
                if (event.key === 'Enter') void add();
              }}
            />
          </Field>
          <button className="btn sm" disabled={busy} onClick={() => void add()}>
            <Icon name="plus" size={13} /> Add
          </button>
        </div>
        <span className="tiny faint">{note.length}/250 · Add marks the page in the PDF without changing the file.</span>
      </div>

      {bookmarks.length === 0 ? (
        <div className="read-panel-empty">
          <strong>No bookmarks yet</strong>
          <span className="tiny">Bookmarks save a page number and a short note. They are independent from annotations.</span>
        </div>
      ) : (
        <ol className="read-bookmark-list">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <button className="badge accent" onClick={() => onOpenPage(bookmark.page)} title={`Go to page ${bookmark.page}`}>
                p. {bookmark.page}
              </button>
              {editingId === bookmark.id ? (
                <>
                  <input
                    className="input"
                    autoFocus
                    maxLength={250}
                    value={editingNote}
                    onChange={(event) => setEditingNote(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveNote(bookmark);
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button className="icon-btn sm" aria-label="Save bookmark note" onClick={() => void saveNote(bookmark)}>
                    <Icon name="check" size={13} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="read-bookmark-note"
                    onClick={() => onOpenPage(bookmark.page)}
                    title="Open this page"
                  >
                    {bookmark.note || <span className="faint">No note</span>}
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Insert into personal notes"
                    aria-label="Insert bookmark into personal notes"
                    onClick={() => onInsert(bookmark)}
                  >
                    <Icon name="note" size={13} />
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Edit note"
                    aria-label="Edit bookmark note"
                    onClick={() => {
                      setEditingId(bookmark.id);
                      setEditingNote(bookmark.note);
                    }}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                </>
              )}
              <button className="icon-btn sm" aria-label="Delete bookmark" title="Delete bookmark" onClick={() => void remove(bookmark)}>
                <Icon name="trash" size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
