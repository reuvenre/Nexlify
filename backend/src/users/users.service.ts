import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

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
    const user = this.repo.create({ email, password_hash });
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
    const hash = await bcrypt.hash(token, 10);
    await this.repo.update(userId, { reset_token_hash: hash, reset_token_expires: expiresAt });
  }

  async findByResetToken(token: string): Promise<User | null> {
    const users = await this.repo.find({
      where: { reset_token_hash: Not(IsNull()) },
    });
    for (const user of users) {
      if (!user.reset_token_hash) continue;
      if (user.reset_token_expires && user.reset_token_expires < new Date()) continue;
      const match = await bcrypt.compare(token, user.reset_token_hash);
      if (match) return user;
    }
    return null;
  }

  async updatePassword(userId: string, newPassword: string) {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.repo.update(userId, {
      password_hash: hash,
      reset_token_hash: null,
      reset_token_expires: null,
    });
  }

  /** All registered user IDs — used by system-level cron jobs (e.g. site manager / architect agents). */
  async findAllIds(): Promise<string[]> {
    const users = await this.repo.find({ select: ['id'] });
    return users.map((u) => u.id);
  }

  toPublic(user: User) {
    return {
      id: user.id,
      email: user.email,
      footer_text: user.footer_text,
      role: user.role,
      plan: user.plan,
      created_at: user.created_at,
    };
  }
}
