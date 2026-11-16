import type { Block } from '../shared/types';
import type { NoteTemplate } from '../shared/constants';

export type TemplateBlock = Omit<Block, 'id'>;

const t = (type: Block['type'], text = '', meta?: Block['meta']): TemplateBlock => ({ type, text, meta });

export const NOTE_TEMPLATE_BLOCKS: Record<NoteTemplate, TemplateBlock[]> = {
  research: [
    t('h1', 'Question'),
    t('paragraph', 'What am I trying to understand?'),
    t('h2', 'Observations'),
    t('paragraph', ''),
    t('h2', 'Hypothesis'),
    t('paragraph', ''),
    t('h2', 'Next steps'),
    t('todo', ''),
  ],
  literature: [
    t('h1', 'Paper'),
    t('paragraph', 'Cite the paper with [[Title]] so the note is linked to the reference.'),
    t('h2', 'Claim'),
    t('paragraph', ''),
    t('h2', 'Method'),
    t('paragraph', ''),
    t('h2', 'Relevance to my work'),
    t('paragraph', ''),
    t('h2', 'Quotes & page anchors'),
    t('quote', ''),
  ],
  experiment: [
    t('h1', 'Experiment log'),
    t('h2', 'Objective'),
    t('paragraph', ''),
    t('h2', 'Hypothesis'),
    t('paragraph', ''),
    t('h2', 'Setup'),
    t('code', ''),
    t('h2', 'Results'),
    t('paragraph', ''),
    t('h2', 'Interpretation'),
    t('paragraph', ''),
  ],
  meeting: [
    t('h1', 'Meeting'),
    t('paragraph', 'Attendees: '),
    t('h2', 'Decisions'),
    t('bullet', ''),
    t('h2', 'Action items'),
    t('todo', ''),
  ],
  daily: [
    t('h1', 'Daily note'),
    t('h2', 'Focus'),
    t('paragraph', ''),
    t('h2', 'Log'),
    t('bullet', ''),
    t('h2', 'Tomorrow'),
    t('todo', ''),
  ],
  technical: [
    t('h1', 'Technical note'),
    t('h2', 'Problem'),
    t('paragraph', ''),
    t('h2', 'Approach'),
    t('paragraph', ''),
    t('h2', 'Implementation'),
    t('code', ''),
    t('h2', 'Caveats'),
    t('bullet', ''),
  ],
  blank: [t('paragraph', '')],
};

export const NOTE_TEMPLATE_LABELS: Record<NoteTemplate, string> = {
  research: 'Research note',
  literature: 'Literature note',
  experiment: 'Experiment log',
  meeting: 'Meeting note',
  daily: 'Daily note',
  technical: 'Technical note',
  blank: 'Blank',
};
