import type { AuditEvent } from '@autom/contracts';

import type { AppRepository } from '../repositories/app-repository.js';

export class AuditService {
  constructor(private readonly repository: AppRepository) {}

  info(jobId: string | null, message: string): AuditEvent {
    return this.repository.addAudit(jobId, 'info', message);
  }

  warn(jobId: string | null, message: string): AuditEvent {
    return this.repository.addAudit(jobId, 'warn', message);
  }

  error(jobId: string | null, message: string): AuditEvent {
    return this.repository.addAudit(jobId, 'error', message);
  }

  list(jobId?: string): AuditEvent[] {
    return this.repository.listAudit(jobId);
  }
}
