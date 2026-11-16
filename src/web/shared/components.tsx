import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  ActivityEvent,
  Attachment,
  LinkWithObject,
  ObjectSummary,
  Project,
  Tag,
} from '../../shared/types';
import { PALETTES, type ObjectType, type Palette } from '../../shared/constants';
import { OBJECT_TYPE_LABELS } from '../../shared/constants';
import { api } from './api';
import { useAsync, useDebounced, relativeTime, formatDateTime, timeOf } from './hooks';
import { Icon, type IconName } from './icons';
import { useToast, useConfirm, Modal, Spinner, Empty, Field } from './ui';

export function objectRoute(type: string, id: string): string {
  if (type === 'note') return `/notes/${id}`;
  if (type === 'reference') return `/literature/${id}`;
  if (type === 'experiment') return `/experiments/${id}`;
  return `/objects/${id}`;
}

export const typeIcon: Record<string, IconName> = {
  note: 'note',
  task: 'task',
  reference: 'book',
  experiment: 'flask',
  question: 'help',
};

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="badge">
      <Icon name={typeIcon[type] ?? 'note'} size={12} />
      {OBJECT_TYPE_LABELS[type as ObjectType] ?? type}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function ProjectSelect({
  projects,
  value,
  onChange,
  allowNone = true,
  label = 'Project',
}: {
  projects: Project[];
  value: string | null;
  onChange: (value: string | null) => void;
  allowNone?: boolean;
  label?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select className="select" value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
        {allowNone ? <option value="">Unfiled / global</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TagEditor({
  objectId,
  initialTags,
  onChange,
}: {
  objectId: string;
  initialTags: Tag[];
  onChange?: (tags: Tag[]) => void;
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [all, setAll] = useState<Tag[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    void api.get<{ tags: Tag[] }>('/tags').then((data) => setAll(data.tags));
  }, []);

  const save = async (next: Tag[]) => {
    setBusy(true);
    try {
      const result = await api.put<{ tags: Tag[] }>(`/objects/${objectId}/tags`, {
        tagIds: next.map((tag) => tag.id),
      });
      setTags(result.tags);
      onChange?.(result.tags);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let tag = all.find((item) => item.name.toLowerCase() === trimmed.toLowerCase());
    if (!tag) {
      try {
        tag = await api.post<Tag>('/tags', { name: trimmed });
        setAll((current) => [...current, tag!].sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        toast((error as Error).message, 'error');
        return;
      }
    }
    const next = tags.some((item) => item.id === tag!.id) ? tags : [...tags, tag];
    setName('');
    await save(next);
  };

  return (
    <div className="stack sm">
      <div className="row" style={{ gap: 5 }}>
        {tags.map((tag) => (
          <span className="tag" key={tag.id}>
            {tag.name}
            <button aria-label={`Remove ${tag.name}`} onClick={() => void save(tags.filter((item) => item.id !== tag.id))}>
              ×
            </button>
          </span>
        ))}
        {!tags.length ? <span className="tiny faint">No tags</span> : null}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          style={{ height: 32, width: 150 }}
          placeholder="Add tag…"
          value={name}
          list="loom-tags"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void add();
            }
          }}
        />
        <datalist id="loom-tags">
          {all.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <button className="btn sm" disabled={busy} onClick={() => void add()}>
          Add
        </button>
        {busy ? <Spinner /> : null}
      </div>
    </div>
  );
}

export function ObjectPicker({
  open,
  onClose,
  onPick,
  title = 'Link an object',
  excludeId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (object: ObjectSummary) => void;
  title?: string;
  excludeId?: string;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 220);
  const [results, setResults] = useState<ObjectSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const path =
      debounced.trim().length > 0
        ? `/search?q=${encodeURIComponent(debounced)}&limit=20&mode=text`
        : '/objects?limit=30';
    api
      .get<{ results?: { objectId: string; type: ObjectType; title: string; projectName: string | null }[]; objects?: ObjectSummary[] }>(
        path,
      )
      .then((data) => {
        if (cancelled) return;
        if (data.results) {
          setResults(
            data.results.map((item) => ({
              id: item.objectId,
              type: item.type,
              title: item.title,
              subtitle: item.projectName ?? '',
              projectId: null,
              status: null,
              favorite: false,
              createdAt: '',
              updatedAt: '',
            })),
          );
        } else {
          setResults(data.objects ?? []);
        }
      })
      .catch(() => setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, debounced]);

  if (!open) return null;
  const filtered = results.filter((item) => item.id !== excludeId);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <input
          className="input"
          autoFocus
          placeholder="Search notes, tasks, references…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
          {loading ? <Spinner label="Searching…" /> : null}
          {!loading && filtered.length === 0 ? <div className="empty">No matching objects.</div> : null}
          {filtered.map((item) => (
            <button
              key={item.id}
              className="list-row"
              style={{ border: 0, background: 'none', textAlign: 'left', width: '100%', cursor: 'pointer' }}
              onClick={() => {
                onPick(item);
                onClose();
              }}
            >
              <Icon name={typeIcon[item.type] ?? 'note'} />
              <span className="grow">
                <span className="title">{item.title}</span>
                {item.subtitle ? <span className="tiny faint" style={{ display: 'block' }}>{item.subtitle}</span> : null}
              </span>
              <TypeBadge type={item.type} />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function LinksPanel({ objectId }: { objectId: string }) {
  const [data, setData] = useState<{ links: LinkWithObject[]; backlinks: LinkWithObject[] } | null>(null);
  const [picker, setPicker] = useState(false);
  const [kind, setKind] = useState('relates');
  const { toast } = useToast();

  const load = () => {
    void api
      .get<{ links: LinkWithObject[]; backlinks: LinkWithObject[] }>(`/objects/${objectId}/links`)
      .then(setData)
      .catch(() => setData({ links: [], backlinks: [] }));
  };
  useEffect(load, [objectId]);

  const add = async (targetId: string) => {
    try {
      await api.post(`/objects/${objectId}/links`, { targetId, kind });
      load();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };
  const remove = async (id: string) => {
    try {
      await api.del(`/links/${id}`);
      load();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="stack sm">
      <div className="row between">
        <strong className="small">Links</strong>
        <button className="btn sm" onClick={() => setPicker(true)}>
          <Icon name="plus" size={14} /> Link
        </button>
      </div>
      <select className="select" style={{ height: 32 }} value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="relates">Related to</option>
        <option value="cites">Cites</option>
        <option value="motivates">Motivates</option>
        <option value="answers">Answers</option>
      </select>
      {!data ? <Spinner /> : null}
      {data?.links.length === 0 && data.backlinks.length === 0 ? (
        <span className="tiny faint">No links yet. Use [[Title]] in notes or link manually.</span>
      ) : null}
      {data?.links.map((link) => (
        <div className="row" key={link.id} style={{ gap: 6 }}>
          <span className="tiny faint" style={{ width: 64 }}>{link.kind}</span>
          <Link className="small truncate grow" to={objectRoute(link.object.type, link.object.id)}>
            {link.object.title}
          </Link>
          <button className="icon-btn sm" aria-label="Remove link" onClick={() => void remove(link.id)}>
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
      {data && data.backlinks.length > 0 ? (
        <>
          <div className="divider" />
          <span className="tiny faint">Linked from</span>
          {data.backlinks.map((link) => (
            <Link className="small truncate" key={link.id} to={objectRoute(link.object.type, link.object.id)}>
              ← {link.object.title} <span className="faint">({link.object.type})</span>
            </Link>
          ))}
        </>
      ) : null}
      <ObjectPicker open={picker} onClose={() => setPicker(false)} onPick={(object) => void add(object.id)} excludeId={objectId} />
    </div>
  );
}

export function AttachmentsPanel({
  objectId,
  attachments,
  onChange,
  compact,
}: {
  objectId: string;
  attachments: Attachment[];
  onChange?: () => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      await api.upload(`/objects/${objectId}/attachments`, file);
      toast('Attachment uploaded', 'success');
      onChange?.();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({ title: 'Delete attachment?', message: 'The attachment row is removed; the blob is garbage-collected later.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/attachments/${id}`);
      toast('Attachment removed', 'success');
      onChange?.();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  return (
    <div className="stack sm">
      <div className="row between">
        <strong className="small">Attachments</strong>
        <button className="btn sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={14} /> Upload
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {attachments.length === 0 ? <span className="tiny faint">No files attached.</span> : null}
      {attachments.map((attachment) => {
        const preview = attachment.meta.preview as { headers: string[]; rows: string[][] } | null | undefined;
        return (
          <div key={attachment.id}>
            <div className="attachment-row">
              <Icon name={attachment.kind === 'pdf' ? 'book' : attachment.kind === 'csv' ? 'activity' : 'link'} size={15} />
              <div className="grow" style={{ minWidth: 0 }}>
                <a
                  className="small truncate"
                  style={{ display: 'block' }}
                  href={`/api/v1/attachments/${attachment.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {attachment.filename}
                </a>
                <div className="tiny faint">
                  {formatBytes(attachment.size)}
                  {attachment.kind === 'pdf' ? ` · ${attachment.textStatus}` : ''}
                  {attachment.pageCount ? ` · ${attachment.pageCount} pages` : ''}
                  {typeof attachment.meta.detectedDoi === 'string' ? ' · DOI detected' : ''}
                </div>
              </div>
              {attachment.kind === 'pdf' ? (
                <a className="btn sm" href={`/api/v1/attachments/${attachment.id}/download?inline=1`} target="_blank" rel="noreferrer">
                  Open
                </a>
              ) : null}
              <button className="icon-btn sm" aria-label="Delete attachment" onClick={() => void remove(attachment.id)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            {!compact && preview?.headers?.length ? (
              <div className="csv-preview" style={{ marginTop: 6 }}>
                <table>
                  <thead>
                    <tr>
                      {preview.headers.map((header, index) => (
                        <th key={index}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {preview.headers.map((_, columnIndex) => (
                          <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ActivityFeed({
  events,
  projects,
  showObjectLinks = true,
}: {
  events: ActivityEvent[];
  projects?: Project[];
  showObjectLinks?: boolean;
}) {
  const projectNames = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p.name])), [projects]);
  if (!events.length) return <Empty title="No activity yet" icon="activity">Actions will appear here as you work.</Empty>;
  return (
    <div className="timeline">
      {events.map((event) => (
        <div className="timeline-row" key={event.id}>
          <div className="when">{timeOf(event.occurredAt)}</div>
          <div className="what">
            <span className="timeline-dot" />
            {showObjectLinks && event.objectId ? (
              <Link to={objectRoute(event.objectType ?? 'note', event.objectId)}>{event.summary}</Link>
            ) : (
              event.summary
            )}
            {event.projectId && projectNames.get(event.projectId) ? (
              <span className="tiny faint"> · {projectNames.get(event.projectId)}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ObjectListRow({ object }: { object: ObjectSummary }) {
  return (
    <Link className="list-row" to={objectRoute(object.type, object.id)}>
      <Icon name={typeIcon[object.type] ?? 'note'} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title truncate">{object.title}</div>
        <div className="tiny faint truncate">{object.subtitle || '—'}</div>
      </div>
      <TypeBadge type={object.type} />
      <span className="tiny faint">{relativeTime(object.updatedAt)}</span>
    </Link>
  );
}

export function AttachmentEmptyHint() {
  return <div className="tiny faint">PDFs are text-extracted in the background; large scans may have no text.</div>;
}

export function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span className="tiny faint">{label}</span>
      <span className="small">{children}</span>
    </div>
  );
}

export function SourceChips({ citations, onOpen }: { citations: { index: number; title: string; objectId: string; objectType: string; locator: Record<string, unknown> }[]; onOpen: (objectId: string, objectType: string, locator: Record<string, unknown>) => void }) {
  if (!citations.length) return null;
  return (
    <div className="citations">
      {citations.map((citation) => (
        <button
          key={`${citation.index}-${citation.objectId}`}
          className="citation-chip"
          onClick={() => onOpen(citation.objectId, citation.objectType, citation.locator)}
          title={citation.title}
        >
          [{citation.index}] {citation.title.slice(0, 36)}
          {citation.locator?.page ? ` · p.${String(citation.locator.page)}` : ''}
        </button>
      ))}
    </div>
  );
}

export function TimeAgo({ value }: { value: string }) {
  return <span title={formatDateTime(value)}>{relativeTime(value)}</span>;
}

export function NewProjectModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (project: Project) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<Palette>('lavender');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const project = await api.post<Project>('/projects', { name, description, color });
      toast('Project created', 'success');
      setName('');
      setDescription('');
      onCreated(project);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={(event) => void submit(event)} disabled={busy || !name.trim()}>
            Create project
          </button>
        </>
      }
    >
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="Name">
          <input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Energy-efficient HPC" />
        </Field>
        <Field label="Description" help="A sentence about the research question or scope.">
          <textarea className="textarea" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field label="Colour">
          <div className="row" style={{ gap: 8 }}>
            {PALETTES.map((palette) => (
              <button
                type="button"
                key={palette}
                className="tag"
                style={{ padding: '4px 9px', borderColor: color === palette ? 'var(--accent)' : undefined }}
                onClick={() => setColor(palette)}
              >
                <span className="dot" data-color={palette} /> {palette}
              </button>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  );
}


