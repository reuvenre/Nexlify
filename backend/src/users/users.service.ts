import { Injectable, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User } from './user.entity';

/** Reset tokens are 256-bit random, so a fast cryptographic hash is sufficient
 *  (and lets us look them up by an indexed equality match instead of scanning). */
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The single bootstrap admin — owner of the instance. Override with ADMIN_EMAIL. */
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'rubypc6@gmail.com').toLowerCase();

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /** Promote the configured admin email to 'admin' on every boot. */
  async onModuleInit() {
    try {
      await this.repo
        .createQueryBuilder()
        .update(User)
        .set({ role: 'admin' })
        .where('LOWER(email) = :email AND role != :role', { email: ADMIN_EMAIL, role: 'admin' })
        .execute();
    } catch (err: any) {
      // Table may not exist yet on a brand-new DB before sync/migrations — ignore.
      this.logger.warn(`Admin bootstrap skipped: ${err.message}`);
    }
  }

  /** Lists every user with activity counts — admin only. */
  async listAll(): Promise<any[]> {
    return this.repo.query(`
      SELECT u.id, u.email, u.role, u.created_at,
             u.subscription_plan, u.plan_billing, u.credits_remaining, u.is_blocked,
             (u.google_id IS NOT NULL) AS via_google,
             (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = u.id) AS posts_count,
             (SELECT COUNT(*)::int FROM campaigns c WHERE c.user_id = u.id) AS campaigns_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
  }

  // ── Admin user management ─────────────────────────────────────────────────

  /** Admin-create a user with an initial role. Password is hashed like normal signup. */
  async adminCreate(email: string, password: string, role: 'user' | 'admin' = 'user'): Promise<User> {
    const normalized = email.trim().toLowerCase();
    if (!normalized || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
      throw new ConflictException('כתובת אימייל לא תקינה');
    }
    if (!password || password.length < 6) throw new ConflictException('סיסמה חייבת להכיל לפחות 6 תווים');
    const exists = await this.repo.findOne({ where: { email: normalized } });
    if (exists) throw new ConflictException('האימייל כבר רשום במערכת');
    const password_hash = await bcrypt.hash(password, 12);
    const finalRole = normalized === ADMIN_EMAIL ? 'admin' : (role === 'admin' ? 'admin' : 'user');
    const user = this.repo.create({ email: normalized, password_hash, role: finalRole });
    return this.repo.save(user);
  }

  /** Set a user's role. */
  async setRole(userId: string, role: string): Promise<void> {
    const next = role === 'admin' ? 'admin' : 'user';
    await this.repo.update(userId, { role: next });
  }

  /** Block/unblock a user. Blocking also revokes the active refresh token. */
  async setBlocked(userId: string, blocked: boolean): Promise<void> {
    await this.repo.update(userId, {
      is_blocked: blocked,
      ...(blocked ? { refresh_token_hash: null } : {}),
    });
  }

  /** Email recipients for a broadcast. `target`: 'all' | 'users' | 'admins'. */
  async recipients(target: 'all' | 'users' | 'admins' = 'all'): Promise<{ id: string; email: string }[]> {
    const qb = this.repo.createQueryBuilder('u')
      .select(['u.id AS id', 'u.email AS email'])
      .where("u.email <> ''");
    if (target === 'users') qb.andWhere("u.role != 'admin'");
    else if (target === 'admins') qb.andWhere("u.role = 'admin'");
    return qb.getRawMany();
  }

  /** Aggregate counts for the admin dashboard. */
  async adminStats(): Promise<{ total_users: number; admins: number; google_users: number }> {
    const rows = await this.repo.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE role = 'admin')::int AS admins,
        COUNT(*) FILTER (WHERE google_id IS NOT NULL)::int AS google_users
      FROM users
    `);
    return rows[0] || { total_users: 0, admins: 0, google_users: 0 };
  }

  /**
   * Resolve a Google sign-in to an EXISTING account only — never auto-create one.
   * Google is a login method, not a registration path: a brand-new email must go
   * through registration first. Returns null when no account matches (the caller
   * then bounces the user to register), and links the google_id to an account that
   * was created by email/password so they can use Google next time.
   */
  async findGoogleUserForLogin(email: string, googleId: string): Promise<User | null> {
    const byGoogle = await this.repo.findOne({ where: { google_id: googleId } });
    if (byGoogle) return byGoogle;

    const byEmail = await this.repo.findOne({ where: { email } });
    if (byEmail) {
      await this.repo.update(byEmail.id, { google_id: googleId });
      return { ...byEmail, google_id: googleId };
    }

    return null; // never registered → do NOT create; the callback redirects to register
  }

  async create(email: string, password: string, name?: string): Promise<User> {
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Email already registered');
    const password_hash = await bcrypt.hash(password, 12);
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
    const user = this.repo.create({ email, password_hash, role, name: name?.trim() || null });
    return this.repo.save(user);
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }

  async saveRefreshToken(userId: string, token: string | null) {
    const hash = token ? await bcrypt.hash(token, 10) : null;
    await this.repo.update(userId, { refresh_token_hash: hash });
  }

  async validateRefreshToken(userId: string, token: string): Promise<boolean> {
    const user = await this.findById(userId);
    if (!user?.refresh_token_hash) return false;
    return bcrypt.compare(token, user.refresh_token_hash);
  }

  async saveResetToken(userId: string, token: string, expiresAt: Date) {
    await this.repo.update(userId, {
      reset_token_hash: hashResetToken(token),
      reset_token_expires: expiresAt,
    });
  }

  async findByResetToken(token: string): Promise<User | null> {
    return this.repo.findOne({
      where: {
        reset_token_hash: hashResetToken(token),
        reset_token_expires: MoreThan(new Date()),
      },
    });
  }

  async updatePassword(userId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.repo.update(userId, {
      password_hash: hash,
      reset_token_hash: null,
      reset_token_expires: null,
      // Revoke any active session so a password reset/change kicks out
      // an attacker who still holds a valid refresh token.
      refresh_token_hash: null,
    });
  }

  // ── Two-factor auth ─────────────────────────────────────────────────────────

  /** Store (or clear) the encrypted TOTP secret and enabled flag. */
  async setTotp(userId: string, secretEnc: string | null, enabled: boolean) {
    await this.repo.update(userId, { totp_secret_enc: secretEnc, totp_enabled: enabled });
  }

  toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name || null,
      role: user.role || 'user',
      footer_text: user.footer_text,
      subscription_plan: user.subscription_plan || 'starter',
      credits_remaining: user.credits_remaining ?? 0,
      totp_enabled: user.totp_enabled === true,
      created_at: user.created_at,
    };
  }
}
