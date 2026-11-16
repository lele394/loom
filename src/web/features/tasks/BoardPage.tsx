import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, formatDate } from '../../shared/hooks';
import { useProject } from '../../shared/projectContext';
import { Icon } from '../../shared/icons';
import { Empty, Field, Loading, Modal, ErrorState, useConfirm, useToast } from '../../shared/ui';
import type { BoardColumn, Project, Task } from '../../../shared/types';
import { PRIORITIES, type Priority } from '../../../shared/constants';

interface BoardResponse {
  project: Project;
  columns: (BoardColumn & { tasks: Task[] })[];
}

interface TaskDraft {
  id?: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string;
  columnId: string;
  estimateMinutes: string;
}

const emptyDraft = (columnId: string): TaskDraft => ({
  title: '',
  description: '',
  priority: 'normal',
  dueDate: '',
  columnId,
  estimateMinutes: '',
});

export function BoardPage() {
  const { project } = useProject();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const board = useAsync(() => api.get<BoardResponse>(`/projects/${project.id}/board`), [project.id]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ columnId: string; taskId: string | null } | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnEdits, setColumnEdits] = useState<Record<string, { name: string; isDone: boolean }>>({});
  const [newColumnName, setNewColumnName] = useState('');

  const columns = board.data?.columns ?? [];
  const firstColumn = columns[0]?.id ?? '';

  useEffect(() => {
    if (params.get('new') === '1' && columns.length) {
      setDraft(emptyDraft(columns[0]!.id));
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, columns, setParams]);

  const openTask = (task: Task) => {
    setDraft({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueDate: task.dueDate ?? '',
      columnId: task.columnId,
      estimateMinutes: task.estimateMinutes ? String(task.estimateMinutes) : '',
    });
  };

  const save = async () => {
    if (!draft || !draft.title.trim()) return;
    setSaving(true);
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
        dueDate: draft.dueDate || null,
        columnId: draft.columnId || undefined,
        estimateMinutes: draft.estimateMinutes ? Number(draft.estimateMinutes) : null,
      };
      if (draft.id) await api.patch(`/tasks/${draft.id}`, payload);
      else await api.post('/tasks', { ...payload, projectId: project.id });
      setDraft(null);
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async () => {
    if (!draft?.id) return;
    const ok = await confirm({ title: 'Delete task?', message: 'The task moves to trash.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/tasks/${draft.id}`);
      setDraft(null);
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const complete = async (task: Task) => {
    try {
      await api.post(`/tasks/${task.id}/complete`, { done: !task.completedAt });
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const move = async (taskId: string, columnId: string, position: number) => {
    setDragOver(null);
    setDragId(null);
    try {
      await api.post(`/tasks/${taskId}/move`, { columnId, position });
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const dropOnColumn = (columnId: string, tasks: Task[]) => {
    if (!dragId) return;
    const position = dragOver?.taskId ? tasks.findIndex((task) => task.id === dragOver.taskId) : tasks.length;
    void move(dragId, columnId, Math.max(0, position));
  };

  const openColumnSettings = () => {
    const edits: Record<string, { name: string; isDone: boolean }> = {};
    for (const column of columns) edits[column.id] = { name: column.name, isDone: column.isDone };
    setColumnEdits(edits);
    setColumnsOpen(true);
  };

  const saveColumns = async () => {
    setSaving(true);
    try {
      for (const column of columns) {
        const edit = columnEdits[column.id];
        if (!edit) continue;
        if (edit.name.trim() && (edit.name !== column.name || edit.isDone !== column.isDone)) {
          await api.patch(`/board-columns/${column.id}`, { name: edit.name, isDone: edit.isDone });
        }
      }
      setColumnsOpen(false);
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addColumn = async () => {
    if (!newColumnName.trim()) return;
    try {
      await api.post(`/projects/${project.id}/columns`, { name: newColumnName, isDone: false });
      setNewColumnName('');
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const deleteColumn = async (column: BoardColumn & { tasks: Task[] }) => {
    if (column.tasks.length) {
      toast('Move or delete the tasks in this column first.', 'error');
      return;
    }
    const ok = await confirm({ title: `Delete “${column.name}”?`, message: 'The column itself is removed.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/board-columns/${column.id}`);
      board.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  if (board.loading) return <Loading rows={4} />;
  if (board.error) return <ErrorState error={board.error} retry={board.reload} />;

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div className="meta-line">
          <span>{columns.reduce((sum, column) => sum + column.tasks.length, 0)} tasks</span>
          <span>·</span>
          <span>{columns.filter((column) => column.isDone).flatMap((column) => column.tasks).length} done</span>
        </div>
        <div className="row">
          <button className="btn sm" onClick={openColumnSettings}><Icon name="settings" size={14} /> Columns</button>
          <button className="btn primary sm" onClick={() => setDraft(emptyDraft(firstColumn))}>
            <Icon name="plus" size={14} /> New task
          </button>
        </div>
      </div>

      {project.status === 'archived' ? (
        <div className="banner"><Icon name="archive" size={15} /> This project is archived and read-only.</div>
      ) : null}

      <div className="kanban">
        {columns.map((column) => (
          <section
            key={column.id}
            className={`column ${dragOver?.columnId === column.id ? 'drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver({ columnId: column.id, taskId: null });
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropOnColumn(column.id, column.tasks);
            }}
          >
            <header className="column-head">
              <span className="name grow">{column.name}</span>
              <span className="count">{column.tasks.length}</span>
            </header>
            <div className="column-body">
              {column.tasks.map((task, index) => {
                const overdue = task.dueDate && !task.completedAt && task.dueDate < new Date().toISOString().slice(0, 10);
                return (
                  <article
                    key={task.id}
                    className={`task-card ${task.completedAt ? 'done' : ''} ${dragId === task.id ? 'dragging' : ''}`}
                    draggable={project.status !== 'archived'}
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDragOver({ columnId: column.id, taskId: task.id });
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (dragId) void move(dragId, column.id, index);
                    }}
                    onClick={() => openTask(task)}
                  >
                    <div className="title">{task.title}</div>
                    <div className="meta-line">
                      <span className="dot" data-color={task.priority === 'urgent' || task.priority === 'high' ? 'sakura' : 'sage'} />
                      <span>{task.priority}</span>
                      {task.dueDate ? <span style={overdue ? { color: 'var(--danger)' } : undefined}>· {formatDate(task.dueDate)}</span> : null}
                      {task.checklist.length ? <span>· {task.checklist.filter((item) => item.done).length}/{task.checklist.length}</span> : null}
                      <button
                        className="icon-btn sm"
                        style={{ marginLeft: 'auto' }}
                        aria-label={task.completedAt ? 'Reopen task' : 'Complete task'}
                        onClick={(event) => {
                          event.stopPropagation();
                          void complete(task);
                        }}
                      >
                        <Icon name="check" size={13} />
                      </button>
                    </div>
                  </article>
                );
              })}
              {project.status !== 'archived' ? (
                <button className="column-add" onClick={() => setDraft(emptyDraft(column.id))}>
                  + Add task
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>

      {draft ? (
        <Modal
          title={draft.id ? 'Task' : 'New task'}
          onClose={() => setDraft(null)}
          footer={
            <>
              {draft.id ? <button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => void removeTask()}>Delete</button> : null}
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={saving || !draft.title.trim()} onClick={() => void save()}>Save</button>
            </>
          }
        >
          <div className="stack">
            <Field label="Title">
              <input className="input" autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </Field>
            <Field label="Description">
              <textarea className="textarea" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </Field>
            <div className="grid-2">
              <Field label="Column">
                <select className="select" value={draft.columnId} onChange={(event) => setDraft({ ...draft, columnId: event.target.value })}>
                  {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="select" value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
              </Field>
              <Field label="Due date">
                <input className="input" type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
              </Field>
              <Field label="Estimate (minutes)">
                <input className="input" type="number" min={0} value={draft.estimateMinutes} onChange={(event) => setDraft({ ...draft, estimateMinutes: event.target.value })} />
              </Field>
            </div>
            {draft.id ? (
              <button className="btn" onClick={() => { const task = columns.flatMap((column) => column.tasks).find((item) => item.id === draft.id); if (task) void complete(task); }}>
                {columns.find((column) => column.id === draft.columnId)?.isDone ? 'Reopen task' : 'Mark complete'}
              </button>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {columnsOpen ? (
        <Modal
          title="Board columns"
          onClose={() => setColumnsOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setColumnsOpen(false)}>Cancel</button>
              <button className="btn primary" disabled={saving} onClick={() => void saveColumns()}>Save columns</button>
            </>
          }
        >
          <div className="stack">
            {columns.map((column) => (
              <div className="row" key={column.id}>
                <input
                  className="input grow"
                  value={columnEdits[column.id]?.name ?? column.name}
                  onChange={(event) => setColumnEdits({ ...columnEdits, [column.id]: { ...columnEdits[column.id]!, name: event.target.value } })}
                />
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={columnEdits[column.id]?.isDone ?? column.isDone}
                    onChange={(event) => setColumnEdits({ ...columnEdits, [column.id]: { ...columnEdits[column.id]!, isDone: event.target.checked } })}
                  />
                  Done column
                </label>
                <button className="icon-btn sm" onClick={() => void deleteColumn(column)} aria-label="Delete column">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
            <div className="divider" />
            <div className="row">
              <input className="input grow" placeholder="New column name" value={newColumnName} onChange={(event) => setNewColumnName(event.target.value)} />
              <button className="btn" onClick={() => void addColumn()}>Add column</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
