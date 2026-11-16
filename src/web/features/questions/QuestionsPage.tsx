import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { api } from '../../shared/api';
import { useAsync, relativeTime } from '../../shared/hooks';
import { Icon } from '../../shared/icons';
import { Empty, ErrorState, Field, Loading, Modal, useConfirm, useToast } from '../../shared/ui';
import { QUESTION_STATUSES, type QuestionStatus } from '../../../shared/constants';
import type { ProjectOutlet } from '../../shared/projectContext';
import type { Question } from '../../../shared/types';

export function QuestionsPage() {
  const outlet = useOutletContext<ProjectOutlet | undefined>();
  const projectId = outlet?.project?.id;
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const questions = useAsync(
    () => api.get<{ questions: Question[] }>(`/questions?limit=200${projectId ? `&projectId=${projectId}` : ''}`),
    [projectId],
  );
  const [questionText, setQuestionText] = useState('');
  const [creating, setCreating] = useState(false);
  const [answering, setAnswering] = useState<Question | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!questionText.trim()) return;
    setCreating(true);
    try {
      await api.post('/questions', { question: questionText, projectId: projectId ?? null });
      setQuestionText('');
      questions.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setCreating(false);
    }
  };

  const update = async (question: Question, patch: Partial<Question>) => {
    try {
      await api.patch(`/questions/${question.id}`, patch);
      questions.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const answer = async () => {
    if (!answering) return;
    setBusy(true);
    try {
      const updated = await api.post<Question>(`/questions/${answering.id}/answer`, { text: answerText });
      setAnswering(null);
      setAnswerText('');
      questions.reload();
      if (updated.answerNoteId) navigate(`/notes/${updated.answerNoteId}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (question: Question) => {
    const ok = await confirm({ title: 'Delete question?', message: 'It moves to trash with its links.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.del(`/questions/${question.id}`);
      questions.reload();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const list = questions.data?.questions ?? [];

  return (
    <div>
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 18 }}>Research questions</h2>
          <p className="small muted">Things to understand, distinct from things to do.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea
            className="textarea grow"
            placeholder="What do you need to understand? e.g. Can DVFS improve energy-to-solution without hurting numerical accuracy?"
            value={questionText}
            onChange={(event) => setQuestionText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void create();
            }}
          />
          <button className="btn primary" disabled={creating || !questionText.trim()} onClick={() => void create()}>
            <Icon name="plus" size={15} /> Open question
          </button>
        </div>
      </div>

      {questions.loading ? <Loading rows={4} /> : null}
      {questions.error ? <ErrorState error={questions.error} retry={questions.reload} /> : null}
      {!questions.loading && list.length === 0 ? (
        <div className="card"><Empty title="No research questions" icon="help">Questions give direction to tasks and experiments.</Empty></div>
      ) : null}

      {QUESTION_STATUSES.map((status) => {
        const group = list.filter((question) => question.status === status);
        if (!group.length) return null;
        return (
          <section key={status} style={{ marginBottom: 20 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-faint)' }}>{status}</h3>
              <span className="badge">{group.length}</span>
            </div>
            <div className="grid-2">
              {group.map((question) => (
                <div className="card" key={question.id}>
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <Link to={`/objects/${question.id}`} style={{ fontWeight: 550, fontSize: 14.5 }}>{question.title}</Link>
                    <select className="select" style={{ width: 130, height: 30 }} value={question.status} onChange={(event) => void update(question, { status: event.target.value as QuestionStatus })}>
                      {QUESTION_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </div>
                  {question.context ? <p className="small muted" style={{ marginTop: 8 }}>{question.context}</p> : null}
                  <div className="row between" style={{ marginTop: 12 }}>
                    <span className="tiny faint">{relativeTime(question.answeredAt ?? '')}</span>
                    <div className="row" style={{ gap: 5 }}>
                      {question.answerNoteId ? (
                        <Link className="btn sm" to={`/notes/${question.answerNoteId}`}>Answer note</Link>
                      ) : (
                        <button className="btn sm" onClick={() => setAnswering(question)}>Answer</button>
                      )}
                      <button className="icon-btn sm" aria-label="Delete question" onClick={() => void remove(question)}>
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {answering ? (
        <Modal
          title={`Answer: ${answering.title}`}
          onClose={() => setAnswering(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAnswering(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={() => void answer()}>Create answer note</button>
            </>
          }
        >
          <Field label="Answer" help="A research note is created and linked to this question.">
            <textarea className="textarea" style={{ minHeight: 180 }} value={answerText} onChange={(event) => setAnswerText(event.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
