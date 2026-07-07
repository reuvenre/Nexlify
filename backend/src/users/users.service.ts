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
             u.subscription_plan, u.credits_remaining,
             (u.google_id IS NOT NULL) AS via_google,
             (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = u.id) AS posts_count,
             (SELECT COUNT(*)::int FROM campaigns c WHERE c.user_id = u.id) AS campaigns_count
      FROM users u
      ORDER BY u.created_at DESC
    `);
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

  async findOrCreateGoogle(email: string, googleId: string, _displayName: string): Promise<User> {
    let user = await this.repo.findOne({ where: { google_id: googleId } });
    if (user) return user;

    user = await this.repo.findOne({ where: { email } });
    if (user) {
      await this.repo.update(user.id, { google_id: googleId });
      return { ...user, google_id: googleId };
    }

    const newUser = this.repo.create({ email, google_id: googleId, password_hash: '' });
    return this.repo.save(newUser);
  }

  async create(email: string, password: string): Promise<User> {
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new ConflictException('Email already registered');
    const password_hash = await bcrypt.hash(password, 12);
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
    const user = this.repo.create({ email, password_hash, role });
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

  toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      role: user.role || 'user',
      footer_text: user.footer_text,
      subscription_plan: user.subscription_plan || 'starter',
      credits_remaining: user.credits_remaining ?? 0,
      created_at: user.created_at,
    };
  }
}
