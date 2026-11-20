import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatMessage, Conversation, Project } from '../../shared/types';
import { api, streamChat, type StreamEvent } from '../shared/api';
import { useAi } from '../shared/aiContext';
import { useSession } from './session';
import { useAsync } from '../shared/hooks';
import { Icon } from '../shared/icons';
import { Markdown } from '../shared/markdown';
import { Modal, Spinner, useToast } from '../shared/ui';
import { ObjectPicker, SourceChips, objectRoute } from '../shared/components';
import { ChatComposer, ConversationHistory, CopyButton } from '../shared/chat';

export function AiPanel() {
  const navigate = useNavigate();
  const ai = useAi();
  const { meta, refresh } = useSession();
  const { toast } = useToast();
  const projects = useAsync(() => api.get<{ projects: Project[] }>('/projects').then((data) => data.projects), []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [comparison, setComparison] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chatEnabled = meta?.capabilities.chat ?? false;

  const loadConversations = async () => {
    try {
      const data = await api.get<{ conversations: Conversation[] }>('/ai/conversations');
      setConversations(data.conversations);
    } catch {
      setConversations([]);
    }
  };

  useEffect(() => {
    void loadConversations();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamText, streaming]);

  const loadConversation = async (id: string) => {
    setLoadingConversation(true);
    try {
      const conversation = await api.get<Conversation>(`/ai/conversations/${id}`);
      setConversationId(id);
      setMessages(conversation.messages ?? []);
      setStreamText('');
      setUsage(null);
      setError(null);
      setHistoryOpen(false);
      ai.setScope(conversation.scope);
      ai.setProjectId(conversation.projectId);
      if (conversation.contextObjectIds?.length) {
        const objects = await Promise.all(
          conversation.contextObjectIds.map(async (objectId) => {
            try {
              const envelope = await api.get<{ object: { id: string; title: string; type: string } }>(`/objects/${objectId}`);
              return { id: envelope.object.id, title: envelope.object.title, type: envelope.object.type };
            } catch {
              return null;
            }
          }),
        );
        ai.setContext(objects.filter((item): item is { id: string; title: string; type: string } => Boolean(item)));
      } else {
        ai.setContext([]);
      }
    } catch (caught) {
      toast((caught as Error).message, 'error');
    } finally {
      setLoadingConversation(false);
    }
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreamText('');
    setError(null);
    setUsage(null);
    ai.setDraft('');
  };

  const send = async () => {
    const content = ai.draft.trim();
    if (!content || streaming) return;
    if (!chatEnabled) {
      toast('Configure an AI provider in Settings first.', 'error');
      return;
    }
    if (ai.scope === 'selection' && ai.context.length === 0) {
      toast('Add at least one object to the selection.', 'error');
      return;
    }
    if (ai.scope === 'project' && !ai.projectId) {
      toast('Choose a project for the conversation.', 'error');
      return;
    }

    setError(null);
    setUsage(null);
    let cid = conversationId;
    try {
      if (!cid) {
        const conversation = await api.post<Conversation>('/ai/conversations', {
          scope: ai.scope,
          projectId: ai.scope === 'project' ? ai.projectId : null,
          contextObjectIds: ai.context.map((item) => item.id),
          title: content.slice(0, 60),
        });
        cid = conversation.id;
        setConversationId(cid);
      }
    } catch (caught) {
      toast((caught as Error).message, 'error');
      return;
    }

    const optimistic: ChatMessage = {
      id: `tmp_${Date.now()}`,
      conversationId: cid,
      role: 'user',
      content,
      citations: [],
      usage: null,
      provider: null,
      model: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);
    ai.setDraft('');
    setStreaming(true);
    setStreamText('');
    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';
    let failure: string | null = null;

    try {
      await streamChat(
        cid,
        content,
        ai.context.map((item) => item.id),
        (event: StreamEvent) => {
          if (event.type === 'delta') {
            accumulated += String(event.text ?? '');
            setStreamText(accumulated);
          } else if (event.type === 'usage') {
            setUsage({
              inputTokens: Number(event.inputTokens ?? 0),
              outputTokens: Number(event.outputTokens ?? 0),
            });
          } else if (event.type === 'error') {
            failure = String(event.message ?? 'The AI request failed.');
            setError(failure);
          }
        },
        controller.signal,
      );
      try {
        const conversation = await api.get<Conversation>(`/ai/conversations/${cid}`);
        setMessages(conversation.messages ?? []);
      } catch {
        // keep optimistic messages
      }
      setStreamText('');
      await loadConversations();
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') {
        setError('Cancelled.');
      } else {
        setError((caught as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const openCitation = (objectId: string, objectType: string, locator: Record<string, unknown>) => {
    const base = objectRoute(objectType, objectId);
    const page = locator.page ? `page=${String(locator.page)}` : '';
    const block = locator.blockId ? `block=${String(locator.blockId)}` : '';
    const query = [page, block].filter(Boolean).join('&');
    navigate(query ? `${base}?${query}` : base);
  };

  const compareSelection = async () => {
    if (ai.context.length < 2) return;
    setComparing(true);
    try {
      const result = await api.post<{ text: string }>('/ai/actions', {
        action: 'compare',
        objectIds: ai.context.map((item) => item.id),
      });
      setComparison(result.text);
    } catch (caught) {
      toast((caught as Error).message, 'error');
    } finally {
      setComparing(false);
    }
  };

  const saveAsNote = async (message: ChatMessage) => {
    try {
      const result = await api.post<{ noteId: string }>(`/ai/messages/${message.id}/to-note`, {
        projectId: ai.projectId ?? projects.data?.[0]?.id ?? null,
      });
      toast('Saved as a research note', 'success');
      navigate(`/notes/${result.noteId}`);
    } catch (caught) {
      toast((caught as Error).message, 'error');
    }
  };

  const extractTasks = async (message: ChatMessage) => {
    const projectId = ai.projectId ?? projects.data?.[0]?.id;
    if (!projectId) {
      toast('Create a project before extracting tasks.', 'error');
      return;
    }
    try {
      const result = await api.post<{ created: string[] }>(`/ai/messages/${message.id}/extract-tasks`, { projectId });
      toast(`Created ${result.created.length} task(s)`, 'success');
    } catch (caught) {
      toast((caught as Error).message, 'error');
    }
  };

  const deleteConversation = async (id: string) => {
    await api.del(`/ai/conversations/${id}`);
    if (conversationId === id) newConversation();
    await loadConversations();
  };

  const renameConversation = async (id: string, title: string) => {
    await api.patch(`/ai/conversations/${id}`, { title });
    await loadConversations();
  };

  return (
    <aside className="ai-dock" aria-label="AI assistant">
      <div className="ai-head">
        <Icon name="sparkles" />
        <span className="title grow">Research assistant</span>
        <button className="icon-btn sm" title="New conversation" onClick={newConversation} aria-label="New conversation">
          <Icon name="plus" size={15} />
        </button>
        <button className="icon-btn sm" title="History" onClick={() => setHistoryOpen(true)} aria-label="Conversation history">
          <Icon name="clock" size={15} />
        </button>
        <button className="icon-btn sm" title="Close" onClick={() => ai.setOpen(false)} aria-label="Close assistant">
          <Icon name="close" size={15} />
        </button>
      </div>

      {!chatEnabled ? (
        <div className="ai-empty">
          <Icon name="sparkles" size={24} />
          <p style={{ marginTop: 8 }}>AI is not configured yet.</p>
          <p className="tiny" style={{ marginTop: 6 }}>
            Loom works fully without it. Add an OpenAI-compatible endpoint (including Ollama) to enable cited chat.
          </p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => navigate('/settings?tab=ai')}>
            Open AI settings
          </button>
        </div>
      ) : (
        <>
          <div className="ai-scope">
            <div className="seg">
              {(['global', 'project', 'selection'] as const).map((scope) => (
                <button key={scope} className={ai.scope === scope ? 'active' : ''} onClick={() => ai.setScope(scope)}>
                  {scope === 'global' ? 'Global' : scope === 'project' ? 'Project' : 'Selection'}
                </button>
              ))}
            </div>
            {ai.scope === 'project' ? (
              <select
                className="select"
                style={{ height: 30, width: 150 }}
                value={ai.projectId ?? ''}
                onChange={(event) => ai.setProjectId(event.target.value || null)}
              >
                <option value="">Choose project…</option>
                {(projects.data ?? []).map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            ) : null}
          </div>

          <div className="ai-scope" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <div className="ai-context-chips grow">
              {ai.context.map((item) => (
                <span className="tag" key={item.id}>
                  {item.title.slice(0, 28)}
                  <button onClick={() => ai.removeContext(item.id)} aria-label={`Remove ${item.title}`}>×</button>
                </span>
              ))}
              {!ai.context.length ? <span className="tiny faint">No explicit context</span> : null}
            </div>
            {ai.context.length >= 2 ? (
              <button className="btn sm" disabled={comparing} onClick={() => void compareSelection()}>
                {comparing ? 'Comparing…' : 'Compare'}
              </button>
            ) : null}
            <button className="btn sm" onClick={() => setPickerOpen(true)}>
              <Icon name="plus" size={13} /> Context
            </button>
          </div>

          <div className="ai-messages">
            {loadingConversation ? <Spinner label="Loading conversation…" /> : null}
            {!messages.length && !streaming ? (
              <div className="ai-empty">
                <p>Ask about your notes, papers and experiments.</p>
                <p className="tiny" style={{ marginTop: 8 }}>Answers cite their sources or say they cannot ground a claim.</p>
                <div className="stack sm" style={{ marginTop: 14 }}>
                  {[
                    'Summarise what I worked on recently',
                    'Compare the methods in my selected papers',
                    'What open questions should I revisit?',
                  ].map((prompt) => (
                    <button key={prompt} className="btn sm" onClick={() => ai.setDraft(prompt)}>{prompt}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <div className={`msg ${message.role === 'user' ? 'user' : ''}`} key={message.id}>
                <div className="who">
                  {message.role === 'user' ? 'You' : <><Icon name="sparkles" size={12} /> Assistant</>}
                  {message.model ? <span className="faint">· {message.model}</span> : null}
                </div>
                <div className="bubble">
                  {message.role === 'assistant' ? (
                    <Markdown text={message.content} onWikilink={(title) => navigate(`/search?q=${encodeURIComponent(title)}`)} />
                  ) : (
                    message.content
                  )}
                  {message.error ? <div className="error-text">{message.error}</div> : null}
                </div>
                {message.citations.length ? (
                  <SourceChips citations={message.citations} onOpen={openCitation} />
                ) : message.role === 'assistant' && message.content ? (
                  <span className="tiny faint">No sources cited — treat this as ungrounded.</span>
                ) : null}
                <div className="msg-actions">
                  <CopyButton text={message.content} />
                  {message.role === 'assistant' && message.id.startsWith('msg_') ? (
                    <>
                      <button className="btn ghost sm" onClick={() => void saveAsNote(message)}>Save as note</button>
                      <button className="btn ghost sm" onClick={() => void extractTasks(message)}>Extract tasks</button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
            {streaming ? (
              <div className="msg">
                <div className="who"><Icon name="sparkles" size={12} /> Assistant</div>
                <div className="bubble">
                  {streamText ? <Markdown text={streamText} /> : <span className="typing"><i /><i /><i /></span>}
                </div>
              </div>
            ) : null}
            {error ? (
              <div className="card tight" style={{ borderColor: 'var(--danger)' }}>
                <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>
                {!meta?.ai.configured ? (
                  <button className="btn sm" style={{ marginTop: 7 }} onClick={() => { void refresh(); navigate('/settings?tab=ai'); }}>
                    Check provider settings
                  </button>
                ) : null}
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="ai-compose">
            <ChatComposer
              value={ai.draft}
              onChange={ai.setDraft}
              onSend={() => void send()}
              onStop={() => abortRef.current?.abort()}
              streaming={streaming}
              autoFocus
              meta={
                <>
                  {usage ? <span>~{usage.inputTokens + usage.outputTokens} tokens</span> : null}
                  {usage && ai.context.length ? ' · ' : null}
                  {ai.context.length ? <span>{ai.context.length} source(s) pinned</span> : null}
                  {!usage && !ai.context.length ? <span>Answers stay in this notebook</span> : null}
                </>
              }
            />
          </div>
        </>
      )}

      <ObjectPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(object) => {
          ai.addContext({ id: object.id, title: object.title, type: object.type });
          ai.setScope('selection');
        }}
        title="Add context"
      />

      {comparison ? (
        <Modal title="Comparison" onClose={() => setComparison(null)} wide>
          <Markdown text={comparison} />
        </Modal>
      ) : null}

      <ConversationHistory
        open={historyOpen}
        conversations={conversations}
        activeId={conversationId}
        onClose={() => setHistoryOpen(false)}
        onOpen={(id) => void loadConversation(id)}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onNew={newConversation}
      />
    </aside>
  );
}
