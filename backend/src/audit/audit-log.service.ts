import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditEventType } from './audit-log.entity';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async record(input: {
    user_id?: string;
    event_type: AuditEventType;
    ip_address?: string;
    route?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const entry = this.repo.create({
      user_id: input.user_id || null,
      event_type: input.event_type,
      ip_address: input.ip_address || null,
      route: input.route || null,
      metadata: input.metadata || null,
    });
    await this.repo.save(entry);
  }

  async recentByUser(userId: string, days = 7, limit = 100): Promise<AuditLog[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.repo
      .createQueryBuilder('a')
      .where('a.user_id = :userId AND a.created_at >= :since', { userId, since })
      .orderBy('a.created_at', 'DESC')
      .take(limit)
      .getMany();
  }

  async countByEventType(userId: string, days = 7): Promise<Record<string, number>> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.repo
      .createQueryBuilder('a')
      .select('a.event_type', 'event_type')
      .addSelect('COUNT(*)', 'count')
      .where('a.user_id = :userId AND a.created_at >= :since', { userId, since })
      .groupBy('a.event_type')
      .getRawMany();
    const result: Record<string, number> = {};
    for (const row of rows) result[row.event_type] = parseInt(row.count, 10);
    return result;
  }
}
