import { useDocumentTitle } from '../../shared/hooks';
import { useProject } from '../../shared/projectContext';
import { CalendarView } from './CalendarView';

export function CalendarPage() {
  useDocumentTitle('Calendar');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">
            Everything scheduled across your projects. Project colour marks the item; the left accent marks its type.
          </p>
        </div>
      </div>
      <CalendarView />
    </div>
  );
}

export function ProjectCalendarPage() {
  const { project } = useProject();
  return <CalendarView projectId={project.id} readOnly={project.status === 'archived'} />;
}
