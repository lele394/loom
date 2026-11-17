import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useSession } from './session';
import { AuthPage } from '../features/auth/AuthPages';
import { Shell } from './Shell';
import { Dashboard } from '../features/dashboard/Dashboard';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { ProjectOverview } from '../features/projects/ProjectOverview';
import { ProjectCodePage } from '../features/projects/ProjectCodePage';
import { CalendarPage, ProjectCalendarPage } from '../features/calendar/CalendarPage';
import { BoardPage } from '../features/tasks/BoardPage';
import { NotesPage } from '../features/notes/NotesPage';
import { NotePage } from '../features/notes/NotePage';
import { LiteraturePage } from '../features/literature/LiteraturePage';
import { ReferencePage } from '../features/literature/ReferencePage';
import { ReadWindow } from '../features/literature/read/ReadWindow';
import { ExperimentsPage } from '../features/experiments/ExperimentsPage';
import { ExperimentPage } from '../features/experiments/ExperimentPage';
import { QuestionsPage } from '../features/questions/QuestionsPage';
import { InboxPage } from '../features/inbox/InboxPage';
import { SearchPage } from '../features/search/SearchPage';
import { JournalPage } from '../features/journal/JournalPage';
import { ActivityPage } from '../features/journal/ActivityPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ObjectPage } from '../features/objects/ObjectPage';

function Splash() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="auth-brand" style={{ justifyContent: 'center' }}>
          <span className="mark" style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-contrast)', display: 'grid', placeItems: 'center' }}>◫</span>
          Loom
        </div>
        <span className="spinner" />
        <p className="small faint" style={{ marginTop: 10 }}>Opening your research workspace…</p>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, user, meta, setupRequired } = useSession();
  const location = useLocation();
  const readMatch = /^\/literature\/([^/]+)\/read\/?$/.exec(location.pathname);
  if (loading) return <Splash />;
  if (setupRequired) return <AuthPage mode="setup" />;
  if (!user || !meta) return <AuthPage mode="login" />;
  if (readMatch) return <ReadWindow referenceId={readMatch[1]!} />;
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/journal" element={<JournalPage />} />
        <Route path="/journal/:date" element={<JournalPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/notes/:id" element={<NotePage />} />
        <Route path="/projects/:id" element={<ProjectLayout />}>
          <Route index element={<ProjectOverview />} />
          <Route path="board" element={<BoardPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="literature" element={<LiteraturePage />} />
          <Route path="experiments" element={<ExperimentsPage />} />
          <Route path="questions" element={<QuestionsPage />} />
          <Route path="calendar" element={<ProjectCalendarPage />} />
          <Route path="code" element={<ProjectCodePage />} />
        </Route>
        <Route path="/literature/:id" element={<ReferencePage />} />
        <Route path="/experiments/:id" element={<ExperimentPage />} />
        <Route path="/objects/:id" element={<ObjectPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
