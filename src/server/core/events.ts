import { EventEmitter } from 'node:events';

export type DomainEventName =
  | 'object.created'
  | 'object.updated'
  | 'object.deleted'
  | 'object.restored'
  | 'note.saved'
  | 'attachment.extracted'
  | 'message.completed'
  | 'backup.created'
  | 'backup.restored';

export type DomainHandler = (payload: Record<string, unknown>) => void;

/** Ephemeral, in-process notifications. Durable work belongs in the jobs table. */
export class DomainEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on(name: DomainEventName, handler: DomainHandler): () => void {
    this.emitter.on(name, handler);
    return () => this.emitter.off(name, handler);
  }

  emit(name: DomainEventName, payload: Record<string, unknown> = {}): void {
    this.emitter.emit(name, payload);
  }
}
