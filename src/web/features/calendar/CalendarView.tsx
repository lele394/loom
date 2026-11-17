import { useMemo, useState, type CSSProperties } from 'react';
import type { CalendarItem, Project } from '../../../shared/types';
import { CALENDAR_ITEM_TYPES, type CalendarItemType, type Palette } from '../../../shared/constants';
import { api } from '../../shared/api';
import { useAsync, formatDate, timeOf, todayIso } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { PALETTE_META } from '../../shared/theme';
import { Field, Loading, Modal, useConfirm, useToast } from '../../shared/ui';

const TYPE_LABELS: Record<CalendarItemType, string> = {
  deadline: 'Deadline',
  meeting: 'Meeting',
  event: 'Event',
  milestone: 'Milestone',
  focus: 'Focus block',
};

const TYPE_COLORS: Record<CalendarItemType, string> = {
  deadline: '#d14b4b',
  meeting: '#d3a229',
  event: '#3f7fbf',
  milestone: '#8c63c9',
  focus: '#4b9a6a',
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalInput(value: string): string {
  const date = new Date(value);
  return `${localDayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addHours(value: string, hours: number): string {
  const date = new Date(value);
  date.setHours(date.getHours() + hours);
  return `${localDayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultStart(day?: string): string {
  if (day) return `${day}T09:00`;
  const date = new Date();
  date.setMinutes(date.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (date.getMinutes() === 0) date.setHours(date.getHours() + 1);
  return `${localDayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function monthGrid(month: Date): { days: Date[]; from: string; to: string } {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const weekday = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
  const end = new Date(start);
  end.setDate(start.getDate() + 41);
  end.setHours(23, 59, 59, 999);
  return { days, from: start.toISOString(), to: end.toISOString() };
}

function projectColor(color: Palette): string {
  return PALETTE_META.find((item) => item.id === color)?.accent ?? '#7c5cbf';
}

interface CalendarForm {
  id?: string;
  projectId: string;
  title: string;
  type: CalendarItemType;
  description: string;
  startsAt: string;
  endsAt: string;
}

export function CalendarView({ projectId, readOnly = false }: { projectId?: string; readOnly?: boolean }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(() => new Date());
  const [form, setForm] = useState<CalendarForm | null>(null);
  const [busy, setBusy] = useState(false);
  const range = useMemo(() => monthGrid(month), [month]);
  const projects = useAsync(
    () => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects),
    [],
  );
  const items = useAsync(
    () =>
      api
        .get<{ items: CalendarItem[] }>(
          `/calendar?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}${
            projectId ? `&projectId=${projectId}` : ''
          }`,
        )
        .then((data) => data.items),
    [projectId, range.from, range.to],
  );
  const upcoming = useAsync(
    () =>
      api
        .get<{ items: CalendarItem[] }>(
          `/calendar/upcoming?limit=8${projectId ? `&projectId=${projectId}` : ''}`,
        )
        .then((data) => data.items),
    [projectId],
  );

  const reload = () => {
    items.reload();
    upcoming.reload();
  };

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items.data ?? []) {
      const start = new Date(item.startsAt);
      const end = item.endsAt ? new Date(item.endsAt) : new Date(item.startsAt);
      const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      while (cursor <= last) {
        const key = localDayKey(cursor);
        const bucket = map.get(key) ?? [];
        bucket.push(item);
        map.set(key, bucket);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [items.data]);

  const openNew = (day?: string) => {
    if (readOnly) {
      toast('This project is archived and read-only.', 'error');
      return;
    }
    const project = projectId ?? projects.data?.[0]?.id;
    if (!project) {
      toast('Create a project before adding calendar items.', 'error');
      return;
    }
    const start = defaultStart(day);
    setForm({
      projectId: project,
      title: '',
      type: 'event',
      description: '',
      startsAt: start,
      endsAt: addHours(start, 1),
    });
  };

  const openEdit = (item: CalendarItem) => {
    setForm({
      id: item.id,
      projectId: item.projectId,
      title: item.title,
      type: item.type,
      description: item.description,
      startsAt: toLocalInput(item.startsAt),
      endsAt: item.endsAt ? toLocalInput(item.endsAt) : '',
    });
  };

  const save = async () => {
    if (!form) return;
    const start = new Date(form.startsAt);
    const end = form.endsAt ? new Date(form.endsAt) : null;
    if (!form.title.trim()) {
      toast('Add a title.', 'error');
      return;
    }
    if (!Number.isFinite(start.getTime())) {
      toast('Choose a valid start date.', 'error');
      return;
    }
    if (end && end.getTime() < start.getTime()) {
      toast('The end time must be after the start time.', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        projectId: form.projectId,
        title: form.title.trim(),
        type: form.type,
        description: form.description,
        startsAt: start.toISOString(),
        endsAt: end ? end.toISOString() : null,
      };
      if (form.id) await api.patch(`/calendar/${form.id}`, body);
      else await api.post('/calendar', body);
      setForm(null);
      reload();
      toast(form.id ? 'Calendar item updated' : 'Calendar item created', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!form?.id) return;
    const ok = await confirm({
      title: 'Delete calendar item?',
      message: `"${form.title}" will be removed from this calendar.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.del(`/calendar/${form.id}`);
      setForm(null);
      reload();
      toast('Calendar item deleted', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const today = todayIso();
  const monthLabel = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const shiftMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };
  const calendarStyle = (item: CalendarItem): CSSProperties =>
    ({
      '--item-project-color': projectColor(item.projectColor),
      '--item-type-color': TYPE_COLORS[item.type],
    }) as CSSProperties;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="calendar-toolbar">
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
            <Icon name="chevron-left" size={15} />
          </button>
          <button className="btn" onClick={() => setMonth(new Date())}>Today</button>
          <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
            <Icon name="chevron-right" size={15} />
          </button>
          <strong style={{ marginLeft: 8, fontSize: 16 }}>{monthLabel}</strong>
        </div>
        <span className="grow" />
        <div className="calendar-legend">
          {CALENDAR_ITEM_TYPES.map((type) => (
            <span key={type} className="calendar-legend-item">
              <span className="calendar-legend-dot" style={{ background: TYPE_COLORS[type] }} />
              {TYPE_LABELS[type]}
            </span>
          ))}
        </div>
        <button className="btn primary" disabled={readOnly} onClick={() => openNew()}>
          <Icon name="plus" size={14} /> New item
        </button>
      </div>

      <div className="upcoming-bar">
        <div className="upcoming-title">
          <Icon name="calendar" size={14} />
          <strong className="small">Upcoming</strong>
        </div>
        {upcoming.loading ? <span className="tiny faint">Loading…</span> : null}
        {!upcoming.loading && !upcoming.data?.length ? (
          <span className="tiny faint">Nothing scheduled — add an event or deadline.</span>
        ) : null}
        <div className="upcoming-items">
          {(upcoming.data ?? []).map((item) => (
            <button
              key={item.id}
              className="upcoming-item"
              style={calendarStyle(item)}
              onClick={() => openEdit(item)}
              title={item.description || item.title}
            >
              <span className="upcoming-accent" />
              <span className="upcoming-date">{formatDate(item.startsAt)} · {timeOf(item.startsAt)}</span>
              <span className="upcoming-name">{item.title}</span>
              <span className="tiny faint">{item.projectName} · {TYPE_LABELS[item.type]}</span>
            </button>
          ))}
        </div>
      </div>

      {items.loading && !items.data ? <Loading rows={5} /> : null}
      <div className="calendar-month">
        {WEEKDAYS.map((day) => (
          <div className="calendar-weekday" key={day}>{day}</div>
        ))}
        {range.days.map((day) => {
          const key = localDayKey(day);
          const dayItems = itemsByDay.get(key) ?? [];
          const isToday = key === today;
          const inMonth = day.getMonth() === month.getMonth();
          return (
            <div
              className={`calendar-cell ${isToday ? 'today' : ''} ${inMonth ? '' : 'outside'}`}
              key={key}
            >
              <div className="calendar-cell-head">
                <span>{day.getDate()}</span>
                {!readOnly ? (
                  <button
                    className="calendar-cell-add"
                    aria-label={`Add item on ${formatDate(day)}`}
                    title="Add item"
                    onClick={() => openNew(key)}
                  >
                    <Icon name="plus" size={12} />
                  </button>
                ) : null}
              </div>
              <div className="calendar-cell-items">
                {dayItems.map((item) => {
                  const startDay = localDayKey(new Date(item.startsAt));
                  return (
                    <button
                      className="calendar-item-chip"
                      key={`${key}-${item.id}`}
                      style={calendarStyle(item)}
                      onClick={() => openEdit(item)}
                      title={`${item.title}\n${item.projectName} · ${TYPE_LABELS[item.type]}`}
                    >
                      <span className="calendar-item-accent" />
                      <span className="calendar-item-time">
                        {startDay === key ? timeOf(item.startsAt) : '↳'}
                      </span>
                      <span className="calendar-item-title truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {form ? (
        <Modal
          title={form.id ? 'Edit calendar item' : 'New calendar item'}
          onClose={() => (busy ? undefined : setForm(null))}
          footer={
            <>
              {form.id ? (
                <button className="btn danger" style={{ marginRight: 'auto' }} disabled={busy || readOnly} onClick={() => void remove()}>
                  Delete
                </button>
              ) : null}
              <button className="btn" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || readOnly} onClick={() => void save()}>
                {busy ? 'Saving…' : form.id ? 'Save changes' : 'Create'}
              </button>
            </>
          }
        >
          <div className="stack">
            {!projectId ? (
              <Field label="Project">
                <select
                  className="select"
                  value={form.projectId}
                  onChange={(event) => setForm({ ...form, projectId: event.target.value })}
                >
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Title">
              <input
                className="input"
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="e.g. Submit camera-ready deadline"
                autoFocus
              />
            </Field>
            <div className="grid-2">
              <Field label="Type">
                <select
                  className="select"
                  value={form.type}
                  onChange={(event) => setForm({ ...form, type: event.target.value as CalendarItemType })}
                >
                  {CALENDAR_ITEM_TYPES.map((type) => (
                    <option key={type} value={type}>{TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Starts">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Ends (optional)" help="Leave empty for a point-in-time deadline.">
              <input
                className="input"
                type="datetime-local"
                value={form.endsAt}
                onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="textarea"
                style={{ minHeight: 120 }}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Agenda, links, what needs to be ready…"
              />
            </Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
