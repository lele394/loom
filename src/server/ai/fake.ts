import { createHash } from 'node:crypto';
import type { ProviderConfig } from '../modules/settings/service';
import { messageText, type AiCapabilities, type AiProvider, type ChatChunk, type ChatRequest } from './types';

/**
 * Deterministic offline provider. Used by tests and "demo" mode.
 * It never invents facts beyond the supplied sources; it simply cites the first two.
 */
export class FakeProvider implements AiProvider {
  readonly kind = 'fake' as const;
  readonly caps: AiCapabilities = {
    chat: true,
    embeddings: true,
    rerank: false,
    streaming: true,
  };

  constructor(private readonly config: ProviderConfig) {}

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  private failMode(): string | null {
    const mode = this.config.extra.failWith;
    return typeof mode === 'string' ? mode : null;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const fail = this.failMode();
    if (fail === 'timeout') {
      throw Object.assign(new Error('The AI provider timed out.'), { code: 'provider_timeout' });
    }
    if (fail === 'auth') {
      throw Object.assign(new Error('Provider authentication failed.'), { code: 'provider_auth' });
    }
    if (fail === 'rate_limit') {
      throw Object.assign(new Error('Provider rate limited.'), { code: 'provider_rate_limited' });
    }

    const lastUser = [...request.messages].reverse().find((message) => message.role === 'user');
    const lastUserText = messageText(lastUser?.content ?? '');
    const digestSystem = request.messages.find(
      (message) => message.role === 'system' && messageText(message.content).includes('research journal writer'),
    );
    const summarySystem = request.messages.find(
      (message) => message.role === 'system' && messageText(message.content).includes('Summarize the supplied research source'),
    );
    if (summarySystem) {
      const answer = `Energy-efficiency analysis in HPC\n\n## Summary\nA deterministic offline summary of the supplied source.\n\n## Key contributions\n- The source demonstrates a measurable research result.\n\n## Methods\n- The fake provider cannot inspect the actual methods in depth.\n\n## Results\n- Configure a real provider for concrete findings and numbers.\n\n## Limitations\n- This is offline demo text.\n\n## Relevance\n- Useful as a placeholder while validating the workflow.`;
      for (const word of answer.split(/(\s+)/)) {
        if (word) yield { type: 'text', text: word };
      }
      yield { type: 'usage', inputTokens: 200, outputTokens: 80 };
      yield { type: 'finish', reason: 'stop' };
      return;
    }
    const ocrSystem = request.messages.find(
      (message) => message.role === 'system' && messageText(message.content).includes('OCR transcriber'),
    );
    if (ocrSystem) {
      const answer =
        'Energy efficient computing with hardware performance counters.\nA study of DVFS and numerical accuracy.\nMethodology: we measure energy-to-solution on HPC nodes.';
      for (const word of answer.split(/(\s+)/)) {
        if (word) yield { type: 'text', text: word };
      }
      yield { type: 'usage', inputTokens: 100, outputTokens: 40 };
      yield { type: 'finish', reason: 'stop' };
      return;
    }
    const metadataSystem = request.messages.find(
      (message) =>
        message.role === 'system' &&
        (messageText(message.content).includes('bibliographic metadata extractor') ||
          messageText(message.content).includes('You extract bibliographic metadata')),
    );
    if (metadataSystem) {
      if (this.config.extra.failWith === 'empty_metadata') {
        yield { type: 'usage', inputTokens: 100, outputTokens: 0 };
        yield { type: 'finish', reason: 'stop' };
        return;
      }
      const source = lastUserText;
      const titleHint = /Title hint:\s*(.+)/.exec(source)?.[1]?.trim() ?? '';
      const doi = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.exec(source)?.[0]?.replace(/[.,;]+$/, '') ?? null;
      const textStart = source.indexOf('"""');
      const textEnd = source.lastIndexOf('"""');
      const body = textStart >= 0 && textEnd > textStart ? source.slice(textStart + 3, textEnd).trim() : '';
      const answer = JSON.stringify(
        this.config.extra.metadataStyle === 'aliases'
          ? {
              Title: 'Aliased Metadata Paper',
              Authors: 'Ada Lovelace; Alan Turing',
              Year: '2002',
              Publication: 'GLSVLSI',
              DOI: 'https://doi.org/10.1145/1234567.1234568',
              URL: 'https://example.org/paper',
              Abstract: 'This paper studies energy-delay efficiency in VLSI computation.',
              Type: 'Conference Paper',
              PublishedAt: '2002-04-18',
            }
          : {
              title:
                titleHint ||
                body
                  .split(/\n/)
                  .find((line) => line.trim().length > 10)
                  ?.trim()
                  .slice(0, 300) ||
                'Imported source',
              authors: [],
              year: null,
              venue: null,
              doi,
              url: null,
              abstract: body.replace(/\s+/g, ' ').slice(0, 400) || null,
              type: 'article',
              publishedAt: null,
            },
      );
      for (const word of answer.split(/(\s+)/)) {
        if (word) yield { type: 'text', text: word };
      }
      yield { type: 'usage', inputTokens: 300, outputTokens: 80 };
      yield { type: 'finish', reason: 'stop' };
      return;
    }
    const extractSystem = request.messages.find(
      (message) => message.role === 'system' && messageText(message.content).includes('Extract concrete, actionable tasks'),
    );
    if (extractSystem) {
      const answer = JSON.stringify({
        tasks: [
          { title: 'Review the cited sources and extract the key claims', description: 'Use the citations in the assistant message.', priority: 'normal' },
          { title: 'Write a short synthesis note', description: 'Link it to the relevant research question.', priority: 'normal' },
        ],
      });
      for (const word of answer.split(/(\s+)/)) {
        if (word) yield { type: 'text', text: word };
      }
      yield { type: 'usage', inputTokens: 120, outputTokens: 60 };
      yield { type: 'finish', reason: 'stop' };
      return;
    }
    if (digestSystem) {
      const diffText = lastUserText;
      const totals = /"totals":\s*\{\s*"added":\s*(\d+),\s*"updated":\s*(\d+),\s*"completed":\s*(\d+),\s*"removed":\s*(\d+)/.exec(diffText);
      const added = Number(totals?.[1] ?? 0);
      const updated = Number(totals?.[2] ?? 0);
      const completed = Number(totals?.[3] ?? 0);
      const removed = Number(totals?.[4] ?? 0);
      const answer =
        added + updated + completed + removed === 0
          ? 'No activity was recorded on this day.'
          : `## Focus\nA day of steady research progress, with ${added + updated} item(s) touched and ${completed} task(s) completed.\n\n## Progress\n- Added ${added} item(s).\n- Updated ${updated} item(s).\n- Completed ${completed} task(s).\n${removed ? `- Removed ${removed} item(s).\n` : ''}\n## Open threads\n- Revisit the items updated today that were not completed.\n\n## Next steps\n- Review the deterministic diff below and choose one concrete follow-up.\n- Capture any new questions in the inbox.`;
      for (const word of answer.split(/(\s+)/)) {
        if (word) yield { type: 'text', text: word };
      }
      yield { type: 'usage', inputTokens: Math.ceil(diffText.length / 4), outputTokens: Math.ceil(answer.length / 4) };
      yield { type: 'finish', reason: 'stop' };
      return;
    }
    const contextMessage = request.messages.find(
      (message) => message.role === 'system' && messageText(message.content).includes('<source '),
    );
    const contextText = messageText(contextMessage?.content ?? '');
    const titles = [...(contextText.matchAll(/<source[^>]*title="([^"]*)"/g) ?? [])].map(
      (match) => match[1] ?? 'source',
    );
    const question = lastUserText.replace(/\s+/g, ' ').slice(0, 160);
    const answer = titles.length
      ? `Based on your sources, here is a concise reading of the question.\n\n${titles
          .slice(0, 2)
          .map((title, index) => `- ${title} is relevant here [${index + 1}].`)
          .join('\n')}\n\nThe fake provider is deterministic and offline. Configure a real provider to get a substantive answer.`
      : `I could not find sources in this scope, so I cannot ground an answer. The fake provider is running in offline demo mode. Question received: “${question}”`;

    const words = answer.split(/(\s+)/);
    for (const word of words) {
      if (request.signal?.aborted) {
        throw Object.assign(new Error('Cancelled.'), { code: 'provider_timeout' });
      }
      if (word) yield { type: 'text', text: word };
    }
    yield { type: 'usage', inputTokens: Math.ceil(JSON.stringify(request.messages).length / 4), outputTokens: Math.ceil(answer.length / 4) };
    yield { type: 'finish', reason: 'stop' };
  }

  async embed(input: string[], _model: string): Promise<number[][]> {
    return input.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const dim = 64;
    const digest = createHash('sha256').update(text).digest();
    const vector: number[] = [];
    let seed = digest.readUInt32LE(0);
    for (let i = 0; i < dim; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      vector.push((seed / 0xffffffff) * 2 - 1);
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return { ok: true, latencyMs: 0 };
  }
}
