# Source conversation — "Personal Research OS"

> Extracted from the shared ChatGPT conversation
> `https://chatgpt.com/share/6afae3de-4e4c-83ed-bdff-2cfa0f7fa6f9`
> on 2026-11-16. Chat navigation, cookie banners, login prompts and
> illustrative image URLs were removed. Text is otherwise preserved.

---

## User — message 1

I want to create my own kind of research notebook but digital edition. Basically I want it to have multiple feature such as "projects" which are essentially separate projects in and out of themselves, different workspaces if you will. Each project can have a kanban board, a literature database that accepts PDFs and links (records date added etc automatically). And a smart way of taking notes, I'm not sure how yet. I also want to add AI capabilities like AI search and chat and a daily summary capability, where it takes everything I did during the day (modified/added/removed kanban blocks, notes taken, new refs,...) and creates a small daily summary with a generate "diff". to create an AI resume of the day. I also want to be able to chat with my refs and notes directly in the chat window.

## Assistant — message 2

What you are describing is essentially a **personal research management system**, somewhere between a digital lab notebook, a project management tool, a scientific literature manager, and an AI research assistant.

I think there is a very interesting product here, especially if you design it around one central concept:

**Everything you do should become part of your research history.**

A note, a literature reference, a Kanban change, a discussion with an AI, an experiment result: they should not be isolated objects. They should all contribute to a coherent history of each project.

I would approach this as a modular application with projects as the main organisational unit.

# 1. Overall architecture

I would split the application into six main modules.

| Module | Purpose |
| --- | --- |
| Projects | Independent research workspaces |
| Tasks | Kanban boards and task management |
| Literature | Papers, PDFs, websites and references |
| Notes | Flexible research notes and knowledge management |
| AI Assistant | Search, chat, analysis and document interaction |
| Activity & Journal | Automatic history and daily summaries |

The important part is that these modules should share data.

For example:

- A task can reference a paper.
- A note can reference a task.
- A paper can reference other papers.
- An AI conversation can reference several notes and papers.
- A daily summary can reference all of these objects.

This creates a connected research environment instead of six independent applications.

# 2. Projects: the foundation

Each project should be an independent workspace. For example:

- Energy efficiency in HPC
- Precision-aware computing
- Personal projects
- 3DS development
- Literature review

Each project has its own:

1. Dashboard.
2. Kanban board.
3. Literature database.
4. Notes.
5. AI conversation history.
6. Activity history.
7. Project settings.

I would also add a global workspace that aggregates information across projects. For example, your global dashboard could show:

- Tasks due across all projects.
- Recently added literature.
- Recent notes.
- Today's activity.
- Active projects.
- AI-generated daily summary.

One important design decision: **projects should be logical containers, not separate databases.** This makes cross-project search, global activity tracking and shared references much easier.

# 3. Literature management

This should be more than a simple PDF folder. Think of something between Zotero and a lightweight scientific knowledge database. Each reference should have structured metadata:

| Field | Description |
| --- | --- |
| Title | Paper or resource title |
| Authors | Author list |
| DOI | DOI, if available |
| URL | Original source |
| Date published | Publication date |
| Date added | Automatically recorded |
| Type | Paper, book, website, report, etc. |
| Tags | User-defined tags |
| Projects | Associated projects |
| Abstract | Paper abstract |
| Attachments | PDFs and supplementary files |
| Notes | Personal comments |

### Automatic ingestion

I would support three ways to add references:

**1. PDF upload**

- Extract metadata.
- Extract abstract and text.
- Attempt DOI identification.
- Generate embeddings.
- Store the original PDF.

**2. URL submission**

- Retrieve page metadata.
- Extract title, authors and publication date when possible.
- Store the original URL.
- Extract content when permitted.

**3. Manual entry**

For references that cannot be identified automatically.

### A particularly useful feature

Allow a single reference to belong to multiple projects. For example, a paper about energy-efficient matrix multiplication could be relevant to both your HPC project and your precision-aware computing project.

Do not duplicate the PDF or reference record. Instead, create project-reference associations.

# 4. Notes: the most important design decision

I would avoid making notes behave like traditional documents. Instead, I would build a system around **blocks and linked notes**. Think of a lightweight combination of Obsidian, Notion and a scientific lab notebook.

Each note is composed of blocks:

- Text
- Headings
- Code snippets
- Mathematical equations (LaTeX)
- Images
- Tables
- References
- Task links
- Experimental results
- AI-generated content

Each block should have its own ID and metadata. This opens up some interesting possibilities.

### Different types of notes

You could introduce a few templates:

| Type | Purpose |
| --- | --- |
| Research note | General thoughts and ideas |
| Literature note | Observations about a paper |
| Experiment log | Experimental setup and results |
| Meeting note | Discussions and decisions |
| Daily note | Chronological research journal |
| Technical note | Algorithms, implementations and technical details |

These should be templates, not separate systems. For example, an experiment log is simply a note with predefined blocks.

### Linking

Notes should support links to:

- Other notes.
- Literature references.
- Tasks.
- Projects.
- Experiments.

This could eventually create a knowledge graph. I would also consider automatic backlinks, similar to Obsidian.

**One important feature: never force the user to choose where a thought belongs before writing it.** A global quick-capture interface should allow you to write something immediately and organise it later. That is particularly useful when working on several research topics.

# 5. AI assistant

This is where the application becomes much more interesting. I would make AI a first-class component of the application, not an additional chatbot bolted onto it. There should be three distinct AI capabilities.

## A. Context-aware chat

A chat interface where you can interact with your research material. For example:

> Compare the methodologies used in these five papers. Focus on their energy measurement techniques and hardware platforms.

The assistant should be able to access:

- Selected literature references.
- Selected PDFs.
- Selected notes.
- Selected projects.
- Tasks and experimental records.
- Previous conversations, when relevant.

I would implement three context modes:

| Mode | Context |
| --- | --- |
| Global | All projects and accessible resources |
| Project | Everything associated with one project |
| Selection | Only explicitly selected resources |

The selection mode is particularly important. Imagine opening a paper, selecting three notes and asking:

"Can you identify contradictions between these sources?"

The assistant should know exactly which documents it can use.

### Source attribution

This is non-negotiable. Every factual answer based on your research material should include citations.

For PDFs:

- Document name.
- Page number.
- Relevant text excerpt.

For notes:

- Note title.
- Block ID or section.

For websites:

- Original URL.

You should be able to click a citation and jump directly to the source.

## B. AI-powered search

I would build two complementary search systems.

**Traditional search:** full-text search, metadata filtering, tags, project filtering, date filtering.

**Semantic search:** search by meaning rather than exact words, across PDFs and notes, find related concepts, identify similar experiments.

For example:

"Find papers where authors use hardware performance counters to estimate energy consumption."

This should find relevant documents even if they do not contain that exact sentence.

### Hybrid retrieval

I recommend combining:

1. Full-text search (BM25).
2. Vector search.
3. Metadata filtering.
4. Reranking.

This gives you a much better retrieval system than relying on embeddings alone. I would also keep document ingestion separate from inference:

```
PDF / URL / Note
       |
       v
  Ingestion pipeline
       |
       +----> Metadata extraction
       |
       +----> Text extraction
       |
       +----> Chunking
       |
       +----> Embeddings
       |
       v
   Search index
       |
       v
    AI Chat
```

## C. Daily AI summary

This is probably one of the most interesting features of your entire idea. I would call it the **Research Journal**. The system records everything that happens during the day. For example:

```
2026-11-16

09:12 - Added reference
        "Energy Efficient Computing..."

09:35 - Created task
        "Implement DVFS sweep"

10:14 - Modified task
        Changed status: Todo -> In Progress

11:02 - Created research note
        "Frequency scaling observations"

14:30 - Added PDF attachment
        "paper_2024.pdf"

15:10 - Modified research note
        Added experimental results

16:45 - Completed task
        "Implement DVFS sweep"
```

At the end of the day, the AI processes these events and generates a summary. Example:

> **Research summary — November 16**
>
> Today, work focused on frequency scaling experiments.
>
> - Added two references concerning energy-efficient HPC.
> - Created a new task for implementing a DVFS sweep.
> - Completed the initial DVFS implementation.
> - Recorded observations about frequency scaling in a research note.
>
> **Key developments**
>
> The initial implementation is complete. The next step is to evaluate its impact on energy consumption and execution time.
>
> **Suggested next steps**
>
> - Run the DVFS sweep.
> - Compare the results against the baseline.
> - Review the newly added literature.

### The important technical detail: event logging

Do not ask the AI to reconstruct your day from the current state of your database. You need an event log.

Every modification should produce an event:

```json
{
  "id": "evt_123",
  "project_id": "proj_001",
  "entity_type": "task",
  "entity_id": "task_042",
  "action": "status_changed",
  "timestamp": "2026-11-16T10:14:00Z",
  "changes": {
    "status": { "old": "todo", "new": "in_progress" }
  }
}
```

This has several advantages:

- You can reconstruct what happened.
- You can generate daily summaries.
- You can generate weekly and monthly summaries.
- You can identify project progress over time.
- You can inspect the history of individual notes and tasks.
- You can generate diffs between two dates.

I would distinguish between two types of information:

**Activity events:** What happened? **State snapshots:** What does the project look like now?

Both are useful. The event log should be append-only, while the current state remains easy to query.

### Daily diff

I would also introduce a deterministic diff before the AI summary. For example:

```
PROJECT: HPC Energy Efficiency

ADDED
  + 2 references
  + 3 notes
  + 4 tasks

MODIFIED
  ~ 2 tasks
  ~ 1 research note

REMOVED
  - 1 task

COMPLETED
  ✓ 2 tasks

AI SUMMARY
  ...
```

This is important because the AI should interpret the actual changes, not invent a history. You could even have two views:

- **Activity:** A chronological list of everything that happened.
- **Daily digest:** An AI-generated interpretation of the day's work.

# 6. The user interface

I would avoid building something that looks like a traditional project management application. Think more about a research IDE. My proposed layout:

```
┌──────────────────────────────────────────────────────────────┐
│ Research Workspace                         Search   Profile  │
├───────────────┬──────────────────────────────────────────────┤
│               │                                              │
│  WORKSPACES   │               MAIN CONTENT                   │
│               │                                              │
│  > HPC        │       Project dashboard / Notes /            │
│  > Precision  │       Literature / Kanban / Journal          │
│  > 3DS        │                                              │
│  > Personal   │                                              │
│               │                                              │
│  ───────────  │                                              │
│               │                                              │
│  GLOBAL       │                                              │
│  - Dashboard  │                                              │
│  - Journal    │                                              │
│  - All tasks  │                                              │
│  - All refs   │                                              │
│               │                                              │
├───────────────┴──────────────────────────────────────────────┤
│ AI Assistant                                      [Expand]   │
│                                                              │
│ Ask about your research...                                   │
└──────────────────────────────────────────────────────────────┘
```

I particularly like the idea of a persistent AI panel at the bottom. It should be expandable into a full chat interface. You could also introduce contextual actions:

- Ask AI about this paper.
- Summarise this note.
- Find related literature.
- Compare selected references.
- Turn this conversation into a note.
- Extract tasks from this discussion.

The last two are especially useful. You should never have to manually transfer useful AI-generated information into your research notebook.

# 7. Suggested technical architecture

I would keep the architecture modular. One possible stack:

| Component | Technology |
| --- | --- |
| Frontend | React + TypeScript |
| UI | Tailwind CSS |
| Backend | Python + FastAPI |
| Database | PostgreSQL |
| Vector search | pgvector |
| PDF storage | Local filesystem / S3-compatible storage |
| Background jobs | Redis + Celery or ARQ |
| Search | PostgreSQL FTS + pgvector |
| AI integration | Provider abstraction |
| PDF extraction | PyMuPDF |
| Authentication | Authentik or native authentication |

I would not introduce microservices initially. A modular monolith is more than sufficient.

### AI provider abstraction

I would make the model backend configurable. For example:

```
AI Provider
    |
    +-- OpenAI-compatible API
    |
    +-- Ollama
    |
    +-- Local inference server
    |
    +-- Other providers
```

This allows you to use a local model for routine operations and a more capable model for complex literature analysis. Your existing Ollama infrastructure could be useful here.

I would also separate:

- Embedding models.
- Chat models.
- Reranking models.
- Metadata extraction models.

They do not need to use the same model.

# 8. Data model

I would start with a relatively simple relational model. Something like this:

```
User
 ├── Projects
 │    ├── Tasks
 │    │    └── TaskHistory
 │    │
 │    ├── Notes
 │    │    └── NoteBlocks
 │    │
 │    ├── References
 │    │    └── Attachments
 │    │
 │    ├── Conversations
 │    │    └── Messages
 │    │
 │    └── ActivityEvents
 │
 ├── GlobalNotes
 ├── GlobalReferences
 ├── DailySummaries
 └── AISettings
```

A few important implementation decisions:

- Every entity gets a UUID.
- Every entity has `created_at` and `updated_at`.
- Every modification generates an activity event.
- Deleted objects generate deletion events. Do not simply erase their history.
- Notes have version history.
- References can belong to multiple projects.
- AI conversations can have explicit context associations.

I would also keep the activity system independent of the individual modules. This will make future features much easier to implement.

# 9. Features I would consider adding

There are a few features that could make this considerably more powerful.

### A. Research timeline

A chronological timeline for each project. Imagine being able to go back three months and see:

- What papers you were reading.
- What ideas you were exploring.
- Which experiments you performed.
- What decisions you made.
- What tasks you completed.

Essentially, a searchable history of your research.

### B. Knowledge graph

Since notes, papers, tasks and experiments can reference each other, you can build a graph. For example:

```
             Paper A
                |
                v
           Research Note
             /       \
            v         v
       Experiment   Paper B
            |
            v
         Task C
```

You could visualise relationships between research topics and identify disconnected areas of your knowledge base.

### C. AI-generated connections

The AI could periodically identify potentially useful connections. For example:

> You recently added a paper about precision-aware matrix multiplication. Your note from October discusses a similar problem in GPU energy efficiency. These two resources may be relevant to the same research question.

This is particularly interesting because it can help you rediscover information that you might otherwise forget.

### D. Research questions

I would introduce a dedicated object called `ResearchQuestion`. For example:

```
Question:
Can DVFS improve energy-to-solution
without significantly affecting numerical accuracy?

Related:
  - 4 papers
  - 3 notes
  - 2 experiments
  - 5 tasks

Status: Investigating
```

This gives your research a higher-level structure. Tasks represent things you need to do. Research questions represent things you need to understand. That distinction is valuable.

# 10. How I would approach development

I would resist the temptation to implement everything immediately. There is a risk of spending months developing infrastructure before having a useful notebook. I suggest five development phases.

| Phase | Features | Priority |
| --- | --- | --- |
| 1 | Projects, notes, Kanban, activity logging | Essential |
| 2 | Literature management, PDF ingestion, metadata | Essential |
| 3 | AI chat, RAG, semantic search, citations | High |
| 4 | Daily summaries, diffs, research journal | High |
| 5 | Knowledge graph, research questions, AI connections | Later |

The first milestone should be a functional notebook without AI. You should be able to:

- Create projects.
- Manage tasks.
- Add and organise references.
- Take notes.
- Link everything together.
- Browse your activity history.

Then AI becomes an additional layer over an already functional system.

## My biggest architectural recommendation

Build around three fundamental concepts:

**1. Knowledge objects** — Everything you create: notes, papers, tasks, experiments, questions.

**2. Relationships** — Everything connecting those objects.

**3. Events** — Everything that happens to those objects over time.

These three concepts are the foundation of the entire application. The AI then operates on top of them.

## One additional idea: make it a personal research OS

I would eventually introduce a global interface that is not tied to any particular project. Imagine opening the application in the morning. It shows:

- What you worked on yesterday.
- What changed across your projects.
- What tasks are pending.
- What research questions remain open.
- Recently discovered literature.
- Suggested connections between your notes.
- A daily research plan generated from your current priorities.

And at the end of the day, it generates your research journal automatically. That would make it much more than a digital notebook. **It would become a persistent record of your entire research process.**

I would suggest that our next step is to define the actual software specification: core entities, database schema, module boundaries, API design and the MVP scope. That will give us a solid foundation before we start implementing anything.

## User — message 3

Suggested features A B D sound good, C for later. I like the personal research OS thing. Anything we're missing? I want dark mode as well, theming and pastel colors.

## Assistant — message 4

Yes. I think we are getting closer to something quite interesting. I would now treat this as a **Personal Research OS**, rather than simply a notebook with project management features. There are a few things I think we should add before we freeze the feature set.

# 1. Features I think we're missing

## A. Global inbox / Quick Capture

**Priority: Very high.** This is one of the most important features for a research tool. You should be able to capture information without thinking about where it belongs:

- A random research idea.
- A paper you found.
- A technical observation.
- A question you want to investigate.
- A task you need to do.

Everything goes into a global inbox. Later, you can:

- Assign it to a project.
- Convert it into a note.
- Convert it into a task.
- Turn it into a research question.
- Attach it to an existing reference.

I would also add a global keyboard shortcut, such as `Ctrl+Shift+Space`, to open a quick-capture window.

## B. Experimental logs

**Priority: High.** Since this is also a scientific research notebook, I think we should support structured experiment records. An experiment could contain:

| Field | Description |
| --- | --- |
| Title | Experiment name |
| Date | Execution date |
| Objective | What you want to investigate |
| Hypothesis | Expected outcome |
| Methodology | How it was performed |
| Environment | Hardware, software, configuration |
| Results | Measurements and observations |
| Attachments | Plots, CSVs, logs |
| References | Related literature |
| Notes | Additional observations |

This could be particularly useful for your HPC work. Imagine importing a CSV containing energy measurements and associating it with an experiment. You could later ask the AI: "Compare the energy efficiency results from my last three experiments."

I would make experiments a first-class object, not just a note template.

## C. Calendar and deadlines

**Priority: Medium.** I would add a calendar view. Not necessarily a full calendar application, but something that displays task deadlines, research milestones, meetings, experiment dates and project timelines. This would also help the AI generate realistic daily plans.

## D. Export and backup

**Priority: Essential.** Your research data should never be trapped inside your application. I would support:

- Markdown export for notes.
- BibTeX export for references.
- Original PDF export.
- CSV/JSON export for structured data.
- Complete project export.
- Full database backup.

Ideally, a project should be exportable as a self-contained archive. I would also consider automatic backups.

## E. Global command palette

**Priority: High.** Something similar to VS Code's command palette. Press `Ctrl+K` and get access to:

- Open project.
- Search literature.
- Create note.
- Create task.
- Start experiment.
- Open AI chat.
- Search everything.
- Switch theme.

This would make the application much faster to use.

# 2. The Research OS dashboard

I think this deserves its own design. The dashboard should be the starting point when you open the application. I would divide it into several areas.

```
┌──────────────────────────────────────────────────────────────┐
│ Good morning                         Search       ⚙ Settings │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  YOUR WORKSPACE                                               │
│                                                              │
│  [ HPC Energy ] [ Precision ] [ 3DS Engine ] [ Personal ]     │
│                                                              │
├──────────────────────────────┬───────────────────────────────┤
│                              │                               │
│  TODAY                       │  RESEARCH ACTIVITY             │
│                              │                               │
│  3 tasks pending             │  09:12 Added reference         │
│  2 deadlines approaching     │  10:14 Updated task            │
│  1 research question open    │  11:02 Created note            │
│                              │  14:30 Added experiment        │
│                              │                               │
├──────────────────────────────┴───────────────────────────────┤
│                                                              │
│  DAILY RESEARCH DIGEST                                       │
│                                                              │
│  Yesterday you worked on frequency scaling...                │
│                                                              │
│  [View full summary] [View activity diff]                     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  RESEARCH INBOX                                               │
│                                                              │
│  + 2 uncategorised ideas                                     │
│  + 1 reference to review                                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

I would make the dashboard configurable. You should be able to rearrange widgets, hide sections and choose what appears.

# 3. Dark mode, themes and pastel colours

Absolutely. I would make theming a core part of the UI architecture, rather than something added at the end. I suggest three levels of customisation.

### A. Appearance modes

- Light.
- Dark.
- System (automatically follows OS settings).

### B. Colour themes

Start with a few built-in themes:

| Theme | Main colours | Style |
| --- | --- | --- |
| Lavender | Purple, lilac, off-white | Soft |
| Sakura | Pink, rose, cream | Warm |
| Sage | Sage green, mint, ivory | Natural |
| Ocean | Powder blue, teal, white | Calm |
| Midnight | Dark navy, lavender, blue | Dark |
| Graphite | Charcoal, pastel accents | Minimal |

Avoid excessive saturation. This is an application where you may spend several hours per day.

### C. Custom accents

Allow users to customise primary accent, secondary accent, background, surface, border and text colour. Use CSS variables/design tokens so themes can change without modifying individual components:

```css
:root {
    --background: #f7f5fa;
    --surface: #ffffff;
    --surface-secondary: #f0edf6;

    --text-primary: #35313d;
    --text-secondary: #85808e;

    --accent: #b8a4d8;
    --accent-hover: #a58bc9;

    --border: #e8e3ed;

    --success: #a8c9b0;
    --warning: #e9c995;
    --danger: #dfa5aa;
}
```

Dark mode should have its own complete palette, not simply invert these colours.

**One important detail:** pastel colours should be used mainly for accents, badges, tags and surfaces. Keep text contrast high enough for comfortable reading.

# 4. A few more features for later

| Feature | Description |
| --- | --- |
| Cross-project references | Share literature between projects |
| Research milestones | Track long-term objectives |
| Decision log | Record why you made important technical decisions |
| Meeting records | Structured meeting notes and action items |
| Data visualisation | Plot CSV data directly inside experiments |
| Reading progress | Track papers as unread, reading, reviewed |
| Version history | Restore previous versions of notes |
| Offline mode | Access and edit research material without internet |
| Plugin system | Extend the application with custom modules |
| AI research connections | Find relationships between unrelated notes and papers |

I particularly like the **decision log**. Research involves many small decisions. Six months later, you might not remember why you selected a particular methodology, hardware platform or algorithm. Having a searchable record of those decisions is valuable.

# 5. Updated feature roadmap

| Module | Features | Priority |
| --- | --- | --- |
| Workspace | Projects, dashboard, global overview | P0 |
| Tasks | Kanban, deadlines, milestones | P0 |
| Notes | Block editor, linking, backlinks | P0 |
| Literature | PDF, URLs, metadata, BibTeX | P0 |
| Activity | Event logging, timeline, diffs | P0 |
| Inbox | Quick capture, organisation | P0 |
| Experiments | Structured experiment records | P1 |
| AI | Chat, RAG, citations, semantic search | P1 |
| Journal | Daily summaries, research digest | P1 |
| Calendar | Deadlines, meetings, milestones | P2 |
| Knowledge graph | Visual relationships | P2 |
| Research questions | Question tracking | P2 |
| AI connections | Automatic knowledge discovery | P3 |

Theme support should be part of P0.

# 6. One architectural decision I would make now

I would introduce a universal concept called **Research Objects**. Instead of treating notes, papers, experiments and tasks as completely separate entities from the application's perspective, give them a common interface. Every object has:

- UUID.
- Type.
- Title.
- Creation date.
- Modification date.
- Project associations.
- Tags.
- Relationships.
- Activity history.

Each object type then has its own specific data.

This makes several things much easier:

1. Global search.
2. Knowledge graph.
3. AI context retrieval.
4. Activity tracking.
5. Cross-project relationships.
6. Future plugin development.

It also gives us a consistent way to display and interact with objects throughout the application.

# 7. My proposed final vision

I see five main pillars:

1. **Organise** — Projects, tasks, deadlines and research questions.
2. **Capture** — Notes, ideas, literature and experiments.
3. **Connect** — Relationships, backlinks, knowledge graph and cross-project references.
4. **Understand** — AI chat, semantic search, literature analysis and research summaries.
5. **Reflect** — Activity timeline, daily journal, diffs and historical progress.

The application should work perfectly well without AI, but AI should make the accumulated knowledge much more useful.

I would also make one principle central to the design:

**The user owns the data.**

Local-first storage, open formats, complete exports and no mandatory cloud dependency. That is especially important for a research notebook that may contain years of scientific work.

I think we now have enough product direction to start defining a proper technical specification, including the data model and module architecture.

## User — message 5

Yeah export and backup is necessary.

## Assistant — message 6

Agreed. **Export and backup are core infrastructure, not optional features.** I would include them in P0. I would separate them into three systems:

### 1. Export

Allow users to export individual objects, projects or the entire workspace.

| Data | Format |
| --- | --- |
| Notes | Markdown |
| Literature | BibTeX, RIS, JSON |
| PDFs | Original files |
| Tasks | JSON, CSV |
| Experiments | JSON, CSV |
| Research data | Original files, CSV |
| Activity history | JSON |
| Complete project | ZIP archive |
| Entire workspace | ZIP archive |

### 2. Automated backups

I propose:

- Automatic daily backups.
- Configurable retention (7, 30, 90 days).
- Manual snapshots.
- Before-update snapshots.
- Optional external backup destination.
- Backup integrity checks.

Potential destinations: local directory, external drive, NAS via SMB/NFS, S3-compatible storage.

### 3. Restore

This is just as important as backup. Support:

- Full workspace restoration.
- Individual project restoration.
- Individual note restoration.
- Historical snapshots.
- Recovery of accidentally deleted objects.

I would also preserve relationships between objects during restoration.

### Important architectural decision

I suggest using a **versioned backup format**:

```
research-backup-2026-11-16/
├── manifest.json
├── workspace.json
│
├── projects/
│   ├── hpc/
│   │   ├── project.json
│   │   ├── tasks.json
│   │   ├── notes/
│   │   ├── experiments/
│   │   └── literature/
│   │
│   └── 3ds/
│
├── attachments/
│   ├── pdfs/
│   ├── images/
│   └── datasets/
│
├── activity/
│   └── events.jsonl
│
└── checksums.sha256
```

The manifest should contain the backup format version, application version, creation timestamp and file inventory. This allows us to change the internal database schema later without breaking old backups.

**One additional recommendation:** use a SQLite database for portable exports, even if the application uses PostgreSQL internally. A self-contained SQLite snapshot, with attachments stored alongside it, would make archival and migration much easier.

### P0 — Data ownership and resilience

- Complete export.
- Selective export.
- Automatic backups.
- Manual snapshots.
- External backup destinations.
- Integrity verification.
- Full and selective restoration.
- Versioned backup format.

The goal should be simple: even if the application disappears tomorrow, you can recover all your research using standard tools.

---

*End of extracted conversation. The closing UI-inserted suggestion chips
("Define software spec with core entities and APIs", "Design Experimental
Logs schema and UI", "Plan implementation phases…") were navigation
artifacts and are omitted.*
