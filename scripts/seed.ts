import { loadDotEnv } from '../src/server/config';
import { closeContext, createContext } from '../src/server/ctx';

loadDotEnv();
const ctx = await createContext();
const user = ctx.db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
  | { id: string }
  | undefined;
if (!user) {
  console.error('No account exists yet. Start Loom and complete setup first, then run this seed script.');
  closeContext(ctx);
  process.exit(1);
}

const actorId = user.id;
const projects = ctx.services.projects;
const project = projects.create(
  {
    name: 'Demo: Energy-efficient HPC',
    description: 'A small demo workspace showing notes, tasks, literature, an experiment and a research question.',
    color: 'ocean',
  },
  actorId,
);
const columns = projects.columns(project.id);
const todo = columns.find((column) => column.name === 'Todo') ?? columns[0]!;

const note = ctx.services.notes.create(
  {
    title: 'Frequency scaling observations',
    projectId: project.id,
    template: 'research',
    blocks: [
      { type: 'h1', text: 'Question' },
      { type: 'paragraph', text: 'Can DVFS reduce energy-to-solution without harming numerical accuracy?' },
      { type: 'h2', text: 'Observations' },
      { type: 'bullet', text: 'Lowering the frequency reduced package power on the test node.' },
      { type: 'bullet', text: 'Runtime increased, so energy-to-solution did not improve everywhere.' },
      { type: 'h2', text: 'Next steps' },
      { type: 'todo', text: 'Run a controlled frequency sweep with performance counters.' },
      { type: 'paragraph', text: 'See [[Energy-efficient computing with counters]] for the measurement method.' },
    ],
  },
  actorId,
);

const reference = ctx.services.literature.create(
  {
    title: 'Energy-efficient computing with counters',
    authors: ['Jane Doe', 'John Smith'],
    year: 2024,
    venue: 'Journal of HPC',
    doi: '10.1000/loom.demo.2024',
    abstract:
      'We measure energy-to-solution using hardware performance counters and controlled DVFS sweeps on HPC nodes.',
    readingStatus: 'reading',
    projectId: project.id,
  },
  actorId,
);

ctx.services.tasks.create(
  {
    title: 'Run the DVFS sweep',
    description: 'Use the counter-based method from the demo reference. Compare against the baseline.',
    projectId: project.id,
    columnId: todo.id,
    priority: 'high',
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  },
  actorId,
);

const experiment = ctx.services.experiments.create(
  {
    title: 'DVFS baseline vs sweep',
    projectId: project.id,
    objective: 'Measure energy-to-solution at three frequency points.',
    hypothesis: 'A moderate frequency reduction improves energy-to-solution.',
    method: 'Run the same workload with fixed frequency and record counters.',
    environment: { cpu: 'test-node', governor: 'performance', compiler: 'gcc 14' },
    metrics: [{ name: 'baseline_energy', value: 1420, unit: 'J' }],
    status: 'running',
  },
  actorId,
);

ctx.services.questions.create(
  {
    question: 'Does DVFS improve energy-to-solution without affecting accuracy?',
    projectId: project.id,
    context: 'This is the central question of the demo project.',
  },
  actorId,
);

ctx.services.objects.createLink(note.id, reference.id, 'cites', actorId);

const tag = ctx.services.objects.createTag('dvfs', 'lavender', actorId);
ctx.services.objects.setTags(note.id, [tag.id], actorId);
ctx.services.objects.setTags(reference.id, [tag.id], actorId);

console.log(`Seeded project "${project.name}" with 1 note, 1 reference, 1 task, 1 experiment and 1 question.`);
console.log(`Experiment: ${experiment.id}`);
closeContext(ctx);
