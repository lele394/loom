import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { Conversation } from '../../shared/types';
import { relativeTime } from './hooks';
import { Icon } from './icons';
import { Modal, useConfirm, useToast } from './ui';

const MAX_COMPOSER_HEIGHT = 220;

export function AutoGrowTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    const next = Math.min(element.scrollHeight, MAX_COMPOSER_HEIGHT);
    element.style.height = `${next}px`;
    element.style.overflowY = element.scrollHeight > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="textarea chat-textarea"
      rows={1}
      value={value}
      disabled={disabled}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  disabled,
  placeholder,
  meta,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  placeholder?: string;
  meta?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <div className="chat-composer">
      <AutoGrowTextarea
        value={value}
        onChange={onChange}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder ?? (streaming ? 'Answering… you can draft the next message.' : 'Ask about your research…')}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!streaming && !disabled && value.trim()) onSend();
          }
        }}
      />
      <div className="chat-composer-foot">
        <span className="chat-composer-hint">
          <span className="kbd">Ctrl/⌘</span> + <span className="kbd">Enter</span> to send · Shift+Enter for a new line
        </span>
        <span className="grow" />
        {meta ? <span className="tiny faint">{meta}</span> : null}
        {streaming ? (
          <button className="btn sm" onClick={onStop}>
            <Icon name="close" size={13} /> Stop
          </button>
        ) : (
          <button
            className="btn primary sm"
            disabled={disabled || !value.trim()}
            onClick={onSend}
          >
            <Icon name="send" size={14} /> Send
          </button>
        )}
      </div>
    </div>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      className="btn ghost sm chat-copy-button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            if (timer.current) window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => setCopied(false), 1400);
          },
          () => setCopied(false),
        );
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : label}
    </button>
  );
}

export function ConversationHistory({
  open,
  conversations,
  activeId,
  onClose,
  onOpen,
  onDelete,
  onRename,
  onNew,
}: {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRename: (id: string, title: string) => Promise<void>;
  onNew: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  useEffect(() => {
    if (!open) {
      setQuery('');
      setEditingId(null);
    }
  }, [open]);

  if (!open) return null;
  const needle = query.trim().toLowerCase();
  const filtered = conversations.filter((conversation) =>
    needle
      ? conversation.title.toLowerCase().includes(needle) ||
        conversation.scope.toLowerCase().includes(needle)
      : true,
  );

  const remove = async (conversation: Conversation) => {
    const ok = await confirm({
      title: 'Delete conversation?',
      message: `“${conversation.title}” and its messages will be removed.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await onDelete(conversation.id);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const saveRename = async (id: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    try {
      await onRename(id, title);
      setEditingId(null);
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <Modal
      title="Conversation history"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          <button
            className="btn primary"
            onClick={() => {
              onNew();
              onClose();
            }}
          >
            <Icon name="plus" size={14} /> New conversation
          </button>
        </>
      }
    >
      <div className="chat-history">
        <input
          className="input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search conversations…"
          autoFocus
        />
        <div className="chat-history-list">
          {filtered.length === 0 ? (
            <div className="empty" style={{ padding: 22 }}>
              <span className="small">
                {conversations.length ? 'No conversations match that search.' : 'No conversations yet.'}
              </span>
            </div>
          ) : null}
          {filtered.map((conversation) => (
            <div
              key={conversation.id}
              className={`chat-history-item ${conversation.id === activeId ? 'active' : ''}`}
            >
              {editingId === conversation.id ? (
                <>
                  <input
                    className="input chat-history-rename"
                    maxLength={200}
                    autoFocus
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveRename(conversation.id);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button
                    className="icon-btn sm"
                    title="Save title"
                    aria-label="Save conversation title"
                    onClick={() => void saveRename(conversation.id)}
                  >
                    <Icon name="check" size={13} />
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="chat-history-open"
                    onClick={() => {
                      onOpen(conversation.id);
                      onClose();
                    }}
                  >
                    <span className="chat-history-title truncate">{conversation.title}</span>
                    <span className="chat-history-meta">
                      {conversation.scope === 'selection'
                        ? 'Selection'
                        : conversation.scope === 'project'
                          ? 'Project'
                          : 'Global'}{' '}
                      · {relativeTime(conversation.updatedAt)}
                    </span>
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Rename conversation"
                    aria-label={`Rename ${conversation.title}`}
                    onClick={() => {
                      setEditingId(conversation.id);
                      setEditingTitle(conversation.title);
                    }}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    className="icon-btn sm"
                    title="Delete conversation"
                    aria-label={`Delete ${conversation.title}`}
                    onClick={() => void remove(conversation)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
