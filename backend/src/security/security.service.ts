import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SecurityEvent, SecurityEventType } from './security-event.entity';

/** A detected security anomaly, shaped for the watchdog reporters. */
export interface SecurityAlert { key: string; title: string; body: string; }

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(
    @InjectRepository(SecurityEvent) private readonly repo: Repository<SecurityEvent>,
  ) {}

  /** Append one audit record. Fire-and-forget from callers — logging a security
   *  event must never block or fail the action it describes. */
  async record(
    type: SecurityEventType,
    data: { email?: string | null; userId?: string | null; ip?: string | null; detail?: string | null } = {},
  ): Promise<void> {
    try {
      await this.repo.insert({
        type,
        email: data.email ?? null,
        user_id: data.userId ?? null,
        ip: data.ip ?? null,
        detail: data.detail ?? null,
      });
    } catch (err: any) {
      this.logger.warn(`security event ${type} not recorded: ${err?.message}`);
    }
  }

  /** Recent events for the admin log (newest first). */
  async list(limit = 100, type?: string) {
    const where = type ? { type: type as SecurityEventType } : {};
    return this.repo.find({ where, order: { created_at: 'DESC' }, take: Math.min(limit, 500) });
  }

  // ── Detections (consumed by the watchdog) ─────────────────────────────────

  /**
   * Brute-force: any single account OR single IP with ≥ THRESHOLD failed logins in
   * the last hour. Grouped so one attacker hitting many accounts, and many attempts
   * on one account, are both caught.
   */
  async detectBruteForce(): Promise<SecurityAlert[]> {
    const THRESHOLD = 15;
    const since = new Date(Date.now() - 60 * 60_000);
    const rows = await this.repo.find({
      where: { type: 'login_failed', created_at: MoreThan(since) },
      order: { created_at: 'DESC' },
      take: 2000,
    });
    if (!rows.length) return [];

    const byEmail = new Map<string, number>();
    const byIp = new Map<string, number>();
    for (const r of rows) {
      if (r.email) byEmail.set(r.email, (byEmail.get(r.email) || 0) + 1);
      if (r.ip) byIp.set(r.ip, (byIp.get(r.ip) || 0) + 1);
    }

    const alerts: SecurityAlert[] = [];
    for (const [email, n] of byEmail) {
      if (n >= THRESHOLD) {
        alerts.push({
          key: `bruteforce_account:${email}`,
          title: `🔓 חשד ל-Brute-force על החשבון ${email} (${n} כשלונות בשעה)`,
          body: `**${n}** ניסיונות התחברות כושלים על \`${email}\` בשעה האחרונה (סף: ${THRESHOLD}).\n\nמומלץ: לבדוק אם החשבון אמיתי, לשקול חסימה זמנית, ולוודא שהגבלת הקצב (ThrottlerGuard) פעילה.`,
        });
      }
    }
    for (const [ip, n] of byIp) {
      if (n >= THRESHOLD) {
        alerts.push({
          key: `bruteforce_ip:${ip}`,
          title: `🔓 חשד ל-Brute-force מכתובת IP ${ip} (${n} כשלונות בשעה)`,
          body: `**${n}** ניסיונות התחברות כושלים מ-IP \`${ip}\` בשעה האחרונה (סף: ${THRESHOLD}) — ייתכן סריקה אוטומטית על מספר חשבונות.`,
        });
      }
    }
    return alerts;
  }

  /**
   * Privilege escalation: any role_changed→admin or admin_created in the last 6h.
   * Legitimate promotions are rare, so surfacing every one (with who/whom) lets the
   * owner confirm it was intentional — the classic post-compromise persistence move.
   */
  async detectPrivilegeEscalation(): Promise<SecurityAlert[]> {
    const since = new Date(Date.now() - 6 * 60 * 60_000);
    const rows = await this.repo.find({
      where: [
        { type: 'role_changed', created_at: MoreThan(since) },
        { type: 'admin_created', created_at: MoreThan(since) },
      ],
      order: { created_at: 'DESC' },
      take: 100,
    });
    const escalations = rows.filter((r) => r.type === 'admin_created' || (r.detail || '').includes('admin'));
    if (!escalations.length) return [];
    return [{
      key: `privilege_escalation:${escalations.map((e) => e.id).sort().join(',').slice(0, 60)}`,
      title: `👤 ${escalations.length} שינויי הרשאת אדמין ב-6 השעות האחרונות`,
      body: [
        '**בדיקה:** הענקת הרשאת אדמין / יצירת אדמין — ודא שכל אחד מהם היה מכוון:',
        '',
        ...escalations.map((e) => `- ${new Date(e.created_at).toISOString()} · ${e.type} · יעד \`${e.email || e.user_id}\` · ${e.detail || ''}`),
        '',
        'אם אחד מאלה לא מוכר לך — ייתכן שחשבון אדמין נפרץ. אפס סיסמאות אדמין ובדוק את היומן.',
      ].join('\n'),
    }];
  }

  /** All security anomalies for one watchdog pass. */
  async scan(): Promise<SecurityAlert[]> {
    const [bf, esc] = await Promise.all([
      this.detectBruteForce().catch(() => []),
      this.detectPrivilegeEscalation().catch(() => []),
    ]);
    return [...bf, ...esc];
  }
}
