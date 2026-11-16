import type { Db } from '../../db/index';
import type { Clock } from '../../core/clock';
import type { ActivityService } from '../activity/service';
import type { ObjectService } from '../objects/service';
import type { SearchService } from '../search/service';
import { notFound } from '../../core/errors';
import { parseJson, truncate } from '../../core/text';
import type { ExperimentStatus } from '../../../shared/constants';
import type { Experiment } from '../../../shared/types';

interface ExperimentRow {
  id: string;
  objective: string;
  hypothesis: string;
  method: string;
  environment_json: string;
  results: string;
  metrics_json: string;
  status: ExperimentStatus;
  started_at: string | null;
  ended_at: string | null;
}

type Metrics = { name: string; value: number; unit?: string }[];

export class ExperimentService {
  constructor(
    private readonly db: Db,
    private readonly clock: Clock,
    private readonly activity: ActivityService,
    private readonly objects: ObjectService,
    private readonly search: SearchService,
  ) {}

  private map(id: string, row?: ExperimentRow): Experiment {
    const experiment = row ?? (this.db.prepare('SELECT * FROM experiments WHERE id = ?').get(id) as ExperimentRow);
    if (!experiment) throw notFound('Experiment');
    const object = this.objects.requireRow(id);
    return {
      id,
      title: object.title,
      projectId: object.project_id,
      objective: experiment.objective,
      hypothesis: experiment.hypothesis,
      method: experiment.method,
      environment: parseJson(experiment.environment_json, {}),
      results: experiment.results,
      metrics: parseJson<Metrics>(experiment.metrics_json, []),
      status: experiment.status,
      startedAt: experiment.started_at,
      endedAt: experiment.ended_at,
      version: object.version,
    };
  }

  create(
    input: {
      title: string;
      projectId?: string | null;
      objective?: string;
      hypothesis?: string;
      method?: string;
      environment?: Record<string, string>;
      results?: string;
      metrics?: Metrics;
      status?: ExperimentStatus;
      startedAt?: string | null;
      endedAt?: string | null;
    },
    actorId: string,
  ): Experiment {
    this.objects.ensureProjectWritable(input.projectId ?? null);
    if (input.projectId && !this.objects.projectExists(input.projectId)) throw notFound('Project');
    const status = input.status ?? 'planned';
    const tx = this.db.transaction(() => {
      const id = this.objects.insertObject({
        type: 'experiment',
        title: input.title.trim(),
        subtitle: truncate(input.objective ?? '', 160) || `Experiment · ${status}`,
        projectId: input.projectId ?? null,
        status,
        metadata: {},
        actorId,
      });
      this.db
        .prepare(
          `INSERT INTO experiments (id, objective, hypothesis, method, environment_json, results, metrics_json, status, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.objective ?? '',
          input.hypothesis ?? '',
          input.method ?? '',
          JSON.stringify(input.environment ?? {}),
          input.results ?? '',
          JSON.stringify(input.metrics ?? []),
          status,
          input.startedAt ?? null,
          input.endedAt ?? null,
        );
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: input.projectId ?? null,
        objectId: id,
        objectType: 'experiment',
        objectTitle: input.title,
        action: 'experiment.created',
        summary: `Started experiment "${input.title}"`,
      });
      return id;
    });
    return this.map(tx());
  }

  get(id: string): Experiment {
    return this.map(id);
  }

  list(filters: { projectId?: string; status?: ExperimentStatus; limit?: number; offset?: number }): Experiment[] {
    const clauses: string[] = ["o.type = 'experiment'", 'o.deleted_at IS NULL'];
    const params: unknown[] = [];
    if (filters.projectId) {
      clauses.push('o.project_id = ?');
      params.push(filters.projectId);
    }
    if (filters.status) {
      clauses.push('e.status = ?');
      params.push(filters.status);
    }
    const rows = this.db
      .prepare(
        `SELECT e.* FROM experiments e JOIN objects o ON o.id = e.id
         WHERE ${clauses.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, filters.limit ?? 30, filters.offset ?? 0) as ExperimentRow[];
    return rows.map((row) => this.map(row.id, row));
  }

  update(
    id: string,
    input: {
      title?: string;
      projectId?: string | null;
      objective?: string;
      hypothesis?: string;
      method?: string;
      environment?: Record<string, string>;
      results?: string;
      metrics?: Metrics;
      status?: ExperimentStatus;
      startedAt?: string | null;
      endedAt?: string | null;
    },
    actorId: string,
  ): Experiment {
    const current = this.map(id);
    const object = this.objects.requireRow(id);
    this.objects.ensureProjectWritable(object.project_id);
    if (input.projectId !== undefined && input.projectId !== object.project_id) {
      this.objects.moveToProject(id, input.projectId, actorId);
    }
    const title = input.title?.trim() || object.title;
    const status = input.status ?? current.status;
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE experiments SET objective = ?, hypothesis = ?, method = ?, environment_json = ?, results = ?,
             metrics_json = ?, status = ?, started_at = ?, ended_at = ? WHERE id = ?`,
        )
        .run(
          input.objective ?? current.objective,
          input.hypothesis ?? current.hypothesis,
          input.method ?? current.method,
          JSON.stringify(input.environment ?? current.environment),
          input.results ?? current.results,
          JSON.stringify(input.metrics ?? current.metrics),
          status,
          input.startedAt === undefined ? current.startedAt : input.startedAt,
          input.endedAt === undefined ? current.endedAt : input.endedAt,
          id,
        );
      this.objects.touch(id, {
        title,
        subtitle: truncate(input.objective ?? current.objective, 160) || `Experiment · ${status}`,
        status,
        actorId,
      });
      this.search.indexObject(id);
      this.activity.record({
        actorId,
        projectId: object.project_id,
        objectId: id,
        objectType: 'experiment',
        objectTitle: title,
        action: status !== current.status ? 'experiment.status_changed' : 'experiment.updated',
        summary:
          status !== current.status ? `Experiment "${title}" is now ${status}` : `Updated experiment "${title}"`,
        changes: status !== current.status ? { status: { from: current.status, to: status } } : null,
      });
      return id;
    });
    tx();
    return this.map(id);
  }

  delete(id: string, actorId: string): void {
    this.objects.softDelete(id, actorId);
  }
}
