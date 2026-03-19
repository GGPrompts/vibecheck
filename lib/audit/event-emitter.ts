import { EventEmitter } from 'events';

export interface AuditProgress {
  auditId: string;
  moduleId: string;
  status: 'running' | 'complete' | 'error';
  progress: number;
  message: string;
}

export class AuditEventEmitter extends EventEmitter {
  emitProgress(progress: AuditProgress): void {
    this.emit('progress', progress);
  }

  onProgress(listener: (progress: AuditProgress) => void): void {
    this.on('progress', listener);
  }

  offProgress(listener: (progress: AuditProgress) => void): void {
    this.off('progress', listener);
  }
}

/** Global event emitter for SSE consumption. */
export const auditEvents = new AuditEventEmitter();
