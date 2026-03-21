import { EventEmitter } from 'events';

export interface AuditProgress {
  auditId: string;
  moduleId: string;
  status: 'running' | 'complete' | 'error';
  progress: number;
  message: string;
}

export interface AuditChunk {
  auditId: string;
  moduleId: string;
  type: 'chunk';
  data: string;
}

class AuditEventEmitter extends EventEmitter {
  emitProgress(progress: AuditProgress): void {
    this.emit('progress', progress);
  }

  onProgress(listener: (progress: AuditProgress) => void): void {
    this.on('progress', listener);
  }

  offProgress(listener: (progress: AuditProgress) => void): void {
    this.off('progress', listener);
  }

  emitChunk(auditId: string, moduleId: string, data: string): void {
    this.emit('chunk', { auditId, moduleId, type: 'chunk', data } satisfies AuditChunk);
  }

  onChunk(listener: (chunk: AuditChunk) => void): void {
    this.on('chunk', listener);
  }

  offChunk(listener: (chunk: AuditChunk) => void): void {
    this.off('chunk', listener);
  }
}

/** Global event emitter for SSE consumption. Survives HMR in dev mode. */
const globalForAudit = globalThis as typeof globalThis & { __auditEvents?: AuditEventEmitter };
export const auditEvents = globalForAudit.__auditEvents ??= new AuditEventEmitter();
