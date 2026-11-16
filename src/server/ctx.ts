import pino from 'pino';
import { loadConfig, type AppConfig } from './config';
import { openDatabase, type Db } from './db';
import { migrationStatus, runMigrations } from './db/migrate';
import { systemClock, type Clock } from './core/clock';
import { DomainEvents } from './core/events';
import { LocalBlobStore, type BlobStore } from './storage/blobStore';
import { JobQueue } from './worker/jobs';
import { SettingsService } from './modules/settings/service';
import { ActivityService } from './modules/activity/service';
import { ObjectService } from './modules/objects/service';
import { ProjectService } from './modules/projects/service';
import { SearchService } from './modules/search/service';
import { NoteService } from './modules/notes/service';
import { TaskService } from './modules/tasks/service';
import { AttachmentService } from './modules/attachments/service';
import { LiteratureService } from './modules/literature/service';
import { LiteratureMetadataService } from './modules/literature/metadata';
import { LiteratureSummaryService } from './modules/literature/summary';
import { ExperimentService } from './modules/experiments/service';
import { QuestionService } from './modules/questions/service';
import { InboxService } from './modules/inbox/service';
import { AiService } from './modules/ai/service';
import { JournalService } from './modules/journal/service';
import { ExportService } from './modules/export/service';
import { BackupService } from './modules/backup/service';
import { AuthService } from './modules/auth/service';

export interface Services {
  auth: AuthService;
  settings: SettingsService;
  activity: ActivityService;
  objects: ObjectService;
  projects: ProjectService;
  search: SearchService;
  notes: NoteService;
  tasks: TaskService;
  attachments: AttachmentService;
  literature: LiteratureService;
  literatureSummary: LiteratureSummaryService;
  experiments: ExperimentService;
  questions: QuestionService;
  inbox: InboxService;
  ai: AiService;
  journal: JournalService;
  export: ExportService;
  backup: BackupService;
}

export interface Ctx {
  config: AppConfig;
  db: Db;
  clock: Clock;
  log: pino.Logger;
  storage: BlobStore;
  events: DomainEvents;
  jobs: JobQueue;
  services: Services;
  maintenance: { restoring: boolean };
}

export interface CreateContextOptions {
  config?: AppConfig;
  clock?: Clock;
  logger?: pino.Logger;
  skipWorkerHooks?: boolean;
}

export async function createContext(options: CreateContextOptions = {}): Promise<Ctx> {
  const config = options.config ?? loadConfig();
  const clock = options.clock ?? systemClock;
  const log =
    options.logger ??
    pino({
      level: config.logLevel,
      base: { app: 'loom', version: config.appVersion },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          '*.password',
          '*.apiKey',
          '*.token',
          '*.secret',
          'password',
          'apiKey',
        ],
        censor: '[redacted]',
      },
    });

  const db = openDatabase(config.dbPath);
  const storage = new LocalBlobStore(config.attachmentsDir, config.tmpDir);
  void storage.cleanupTemp(24 * 60 * 60 * 1000).catch(() => undefined);
  const events = new DomainEvents();
  const jobs = new JobQueue(db, clock, log);
  const settings = new SettingsService(db, clock, config);
  const activity = new ActivityService(db, clock);

  const status = migrationStatus(db);
  if (status.current > 0 && status.pending > 0 && process.env.LOOM_SKIP_PRE_MIGRATION_BACKUP !== '1') {
    const userIdRow = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (userIdRow) {
      const backup = new BackupService(db, clock, config, storage, activity, settings, jobs, log);
      try {
        log.warn({ pending: status.pending }, 'creating pre-migration backup');
        await backup.create('pre_migration', userIdRow.id);
      } catch (error) {
        log.error({ error }, 'pre-migration backup failed; aborting startup');
        throw new Error(
          `Refusing to migrate without a safety backup: ${(error as Error).message}. Set LOOM_SKIP_PRE_MIGRATION_BACKUP=1 to override deliberately.`,
        );
      }
    }
  }

  runMigrations(db);
  jobs.recoverRunning();

  const services = {} as Services;
  services.auth = new AuthService(db, clock);
  services.settings = settings;
  services.activity = activity;
  services.objects = new ObjectService(db, clock, activity);
  services.projects = new ProjectService(db, clock, activity, services.objects);
  services.search = new SearchService(db, clock, settings, jobs);
  services.notes = new NoteService(db, clock, activity, services.objects, services.search, jobs);
  services.tasks = new TaskService(
    db,
    clock,
    activity,
    services.objects,
    services.search,
    services.projects,
  );
  services.attachments = new AttachmentService(
    db,
    clock,
    activity,
    services.objects,
    services.search,
    jobs,
    storage,
    config,
  );
  const literatureMetadata = new LiteratureMetadataService(settings);
  services.literature = new LiteratureService(
    db,
    clock,
    activity,
    services.objects,
    services.search,
    services.attachments,
    literatureMetadata,
    config,
  );
  services.literatureSummary = new LiteratureSummaryService(
    db,
    clock,
    settings,
    services.attachments,
    activity,
    config,
    services.literature,
  );
  services.experiments = new ExperimentService(db, clock, activity, services.objects, services.search);
  services.questions = new QuestionService(
    db,
    clock,
    activity,
    services.objects,
    services.search,
    services.notes,
  );
  services.inbox = new InboxService(
    db,
    clock,
    activity,
    services.notes,
    services.tasks,
    services.literature,
    services.experiments,
    services.questions,
  );
  services.ai = new AiService(
    db,
    clock,
    settings,
    services.search,
    activity,
    services.notes,
    services.tasks,
  );
  services.journal = new JournalService(db, clock, activity, settings, jobs);
  services.export = new ExportService(db, clock, config, storage, services.notes, services.literature);
  services.backup = new BackupService(db, clock, config, storage, activity, settings, jobs, log);

  return {
    config,
    db,
    clock,
    log,
    storage,
    events,
    jobs,
    services,
    maintenance: { restoring: false },
  };
}

export function closeContext(ctx: Ctx): void {
  try {
    ctx.db.close();
  } catch {
    // already closed
  }
}
