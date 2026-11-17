import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ReferenceBookmark } from '../../../../shared/types';
import { Icon } from '../../../shared/icons';
import { Markdown } from '../../../shared/markdown';
import type { ReadSaveStatus } from './status';
import { SAVE_STATUS_LABEL } from './status';

const NOTES_SCALE_MIN = 0.75;
const NOTES_SCALE_MAX = 3;
const NOTES_SCALE_STEP = 0.1;

function bookmarkSnippet(bookmark: ReferenceBookmark): string {
  return `\n\n> [[p.${bookmark.page}]]${bookmark.note ? ` — ${bookmark.note}` : ''}\n`;
}

function readNotesScale(): number {
  try {
    const value = Number(localStorage.getItem('loom-read-notes-scale'));
    return Number.isFinite(value) && value >= NOTES_SCALE_MIN && value <= NOTES_SCALE_MAX
      ? value
      : 1;
  } catch {
    return 1;
  }
}

export function ReadNotesPanel({
  value,
  onChange,
  onSave,
  status,
  lastSavedAt,
  bookmarks,
  onOpenPage,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  status: ReadSaveStatus;
  lastSavedAt: string | null;
  bookmarks: ReferenceBookmark[];
  onOpenPage: (page: number) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [scale, setScale] = useState(readNotesScale);

  useEffect(() => {
    try {
      localStorage.setItem('loom-read-notes-scale', String(scale));
    } catch {
      // Storage may be disabled; scaling still works for this session.
    }
  }, [scale]);

  const apply = (before: string, after = '', block = false) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      onChange(`${value}${before}${after}`);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    let next: string;
    if (block) {
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const prefix = value.slice(lineStart, start);
      next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`.slice(0);
      if (!selected && !prefix.trim()) {
        next = `${value.slice(0, start)}${before}${value.slice(end)}`;
      }
    } else {
      next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    }
    onChange(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const cursorStart = start + before.length;
      textarea.setSelectionRange(cursorStart, cursorStart + selected.length);
    });
  };

  const insertBookmark = (id: string) => {
    const bookmark = bookmarks.find((item) => item.id === id);
    if (!bookmark) return;
    const textarea = textareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const snippet = bookmarkSnippet(bookmark);
      onChange(`${value.slice(0, start)}${snippet}${value.slice(end)}`);
      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + snippet.length;
        textarea.setSelectionRange(cursor, cursor);
      });
    } else {
      onChange(`${value}${bookmarkSnippet(bookmark)}`);
    }
  };

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  const changeScale = (delta: number) => {
    setScale((current) =>
      Math.round(Math.min(NOTES_SCALE_MAX, Math.max(NOTES_SCALE_MIN, current + delta)) * 10) / 10,
    );
  };

  return (
    <div className="read-notes" style={{ '--notes-scale': scale } as CSSProperties}>
      <div className="read-editor-toolbar">
        <button className="icon-btn sm" title="Heading" aria-label="Heading" onClick={() => apply('## ', '', true)}>H</button>
        <button className="icon-btn sm" title="Bold (Ctrl+B)" aria-label="Bold" onClick={() => apply('**', '**')}><strong>B</strong></button>
        <button className="icon-btn sm" title="Italic (Ctrl+I)" aria-label="Italic" onClick={() => apply('*', '*')}><em>I</em></button>
        <button className="icon-btn sm" title="Quote" aria-label="Quote" onClick={() => apply('> ', '', true)}>❝</button>
        <button className="icon-btn sm" title="Bulleted list" aria-label="Bulleted list" onClick={() => apply('- ', '', true)}>•</button>
        <button className="icon-btn sm" title="Numbered list" aria-label="Numbered list" onClick={() => apply('1. ', '', true)}>1.</button>
        <button className="icon-btn sm" title="Inline code" aria-label="Inline code" onClick={() => apply('`', '`')}>`</button>
        <button className="icon-btn sm" title="Link" aria-label="Link" onClick={() => apply('[', '](https://)')}>
          <Icon name="link" size={14} />
        </button>
        {bookmarks.length ? (
          <select
            className="select read-bookmark-insert"
            value=""
            aria-label="Insert a bookmark"
            title="Insert a bookmark reference"
            onChange={(event) => {
              insertBookmark(event.target.value);
              event.target.value = '';
            }}
          >
            <option value="">Insert bookmark…</option>
            {bookmarks.map((bookmark) => (
              <option key={bookmark.id} value={bookmark.id}>
                p. {bookmark.page}{bookmark.note ? ` — ${bookmark.note.slice(0, 42)}` : ''}
              </option>
            ))}
          </select>
        ) : null}
        <span className="grow" />
        <div className="read-notes-scale" role="group" aria-label="Note text size">
          <button
            className="icon-btn sm"
            title="Smaller note text"
            aria-label="Smaller note text"
            disabled={scale <= NOTES_SCALE_MIN}
            onClick={() => changeScale(-NOTES_SCALE_STEP)}
          >
            <Icon name="minus" size={12} />
          </button>
          <button
            className="btn ghost sm"
            title="Reset note text size to 100%"
            onClick={() => setScale(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            className="icon-btn sm"
            title="Larger note text"
            aria-label="Larger note text"
            disabled={scale >= NOTES_SCALE_MAX}
            onClick={() => changeScale(NOTES_SCALE_STEP)}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
        <button
          className={`btn ghost sm ${preview ? 'active' : ''}`}
          onClick={() => setPreview((current) => !current)}
          title={preview ? 'Edit markdown' : 'Preview markdown'}
        >
          <Icon name={preview ? 'edit' : 'note'} size={14} /> {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {preview ? (
        <div className="read-note-preview">
          <Markdown
            text={value}
            className="note-reading"
            onWikilink={(title) => {
              const match = /^p\.(\d+)$/.exec(title.trim());
              if (match) onOpenPage(Number(match[1]));
            }}
          />
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          className="read-note-editor"
          value={value}
          placeholder={'Write in markdown…\n\n# Observations\n- What is the claim?\n- What did they measure?\n- What should I try next?'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
              event.preventDefault();
              apply('**', '**');
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
              event.preventDefault();
              apply('*', '*');
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSave();
            }
          }}
          spellCheck
        />
      )}

      <div className="read-editor-foot">
        <span className={`read-save-dot ${status}`} aria-hidden />
        <span className="tiny faint">
          {SAVE_STATUS_LABEL[status]}
          {lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
        <span className="grow" />
        <span className="tiny faint">{words} word{words === 1 ? '' : 's'} · autosaves every 30s</span>
      </div>
    </div>
  );
}
