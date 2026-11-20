import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatMessage, Conversation, Reference } from '../../../../shared/types';
import { api, streamChat, type StreamEvent } from '../../../shared/api';
import { useAi } from '../../../shared/aiContext';
import { useSession } from '../../../app/session';
import { Icon } from '../../../shared/icons';
import { Markdown } from '../../../shared/markdown';
import { useToast } from '../../../shared/ui';
import { SourceChips, objectRoute } from '../../../shared/components';
import { ChatComposer, ConversationHistory, CopyButton } from '../../../shared/chat';

export function ReadChatPanel({
  reference,
  onOpenPage,
}: {
  reference: Reference;
  onOpenPage: (page: number) => void;
}) {
  const navigate = useNavigate();
  const ai = useAi();
  const { meta } = useSession();
  const { toast } = useToast();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ inputTokens: number; outputTokens: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatEnabled = meta?.capabilities.chat ?? false;

  // The reading chat is always bound to the paper that owns this window.
  useEffect(() => {
    ai.setContext([{ id: reference.id, title: reference.title, type: 'reference' }]);
    ai.setScope('selection');
  }, [ai.setContext, ai.setScope, reference.id, reference.title]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streamText, streaming]);

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

  const loadConversation = async (id: string) => {
    try {
      const conversation = await api.get<Conversation>(`/ai/conversations/${id}`);
      setConversationId(id);
      setMessages(conversation.messages ?? []);
      setStreamText('');
      setUsage(null);
      setError(null);
      setHistoryOpen(false);
    } catch (caught) {
      toast((caught as Error).message, 'error');
    }
  };

  const newConversation = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setStreamText('');
    setError(null);
    setUsage(null);
    setDraft('');
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

  const send = async () => {
    const content = draft.trim();
    if (!content || streaming) return;
    if (!chatEnabled) {
      toast('Configure an AI provider in Settings first.', 'error');
      return;
    }
    setError(null);
    setUsage(null);
    let cid = conversationId;
    try {
      if (!cid) {
        const conversation = await api.post<Conversation>('/ai/conversations', {
          scope: 'selection',
          projectId: null,
          contextObjectIds: [reference.id],
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
    setDraft('');
    setStreaming(true);
    setStreamText('');
    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';

    try {
      await streamChat(
        cid,
        content,
        [reference.id],
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
            setError(String(event.message ?? 'The AI request failed.'));
          }
        },
        controller.signal,
      );
      try {
        const conversation = await api.get<Conversation>(`/ai/conversations/${cid}`);
        setMessages(conversation.messages ?? []);
      } catch {
        // keep the optimistic messages
      }
      setStreamText('');
      await loadConversations();
    } catch (caught) {
      setError((caught as Error).name === 'AbortError' ? 'Cancelled.' : (caught as Error).message);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const openCitation = (objectId: string, objectType: string, locator: Record<string, unknown>) => {
    if (objectId === reference.id && locator.page) {
      onOpenPage(Number(locator.page));
      return;
    }
    const base = objectRoute(objectType, objectId);
    const page = locator.page ? `page=${String(locator.page)}` : '';
    const block = locator.blockId ? `block=${String(locator.blockId)}` : '';
    const query = [page, block].filter(Boolean).join('&');
    navigate(query ? `${base}?${query}` : base);
  };

  return (
    <div className="read-chat">
      <div className="read-chat-bound">
        <Icon name="book" size={13} />
        <span className="grow truncate" title={reference.title}>{reference.title}</span>
        <span className="badge accent">PDF bound</span>
        <button className="icon-btn sm" title="New chat" aria-label="New chat" onClick={newConversation}>
          <Icon name="plus" size={13} />
        </button>
        <button className="icon-btn sm" title="Chat history" aria-label="Chat history" onClick={() => setHistoryOpen(true)}>
          <Icon name="clock" size={13} />
        </button>
      </div>

      {!chatEnabled ? (
        <div className="read-panel-empty">
          <Icon name="sparkles" size={22} />
          <strong>AI is not configured</strong>
          <span className="tiny">Add an OpenAI-compatible provider in Settings to chat about this paper.</span>
          <button className="btn sm" onClick={() => navigate('/settings?tab=ai')}>Open AI settings</button>
        </div>
      ) : (
        <>
          <div className="read-chat-messages">
            {!messages.length && !streaming ? (
              <div className="read-panel-empty">
                <p className="small">Ask about this paper in the context of your notes and other references.</p>
                <div className="stack sm" style={{ marginTop: 10, width: '100%' }}>
                  {[
                    'Summarise the method and main result.',
                    'What are the limitations of this paper?',
                    'How does this relate to what I have written?',
                  ].map((prompt) => (
                    <button key={prompt} className="btn sm" onClick={() => setDraft(prompt)}>{prompt}</button>
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
                    <Markdown text={message.content} />
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
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          <div className="read-chat-compose">
            <ChatComposer
              value={draft}
              onChange={setDraft}
              onSend={() => void send()}
              onStop={() => abortRef.current?.abort()}
              streaming={streaming}
              meta={
                <>
                  {usage ? <span>~{usage.inputTokens + usage.outputTokens} tokens · </span> : null}
                  <span>Bound to the open PDF</span>
                </>
              }
            />
          </div>
        </>
      )}

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
    </div>
  );
}
