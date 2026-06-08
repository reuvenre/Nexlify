import {
  Injectable, UnauthorizedException, BadRequestException, Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/user.entity';
import { AuditLogService } from '../audit/audit-log.service';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_SEC = 60 * 60 * 24 * 30; // 30 days

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
    private audit: AuditLogService,
  ) {}

  // ── Token helpers ──────────────────────────────────────────────────────────

  private signAccess(userId: string) {
    return this.jwt.sign(
      { sub: userId },
      { secret: this.config.get('JWT_SECRET'), expiresIn: '15m' },
    );
  }

  private signRefresh(userId: string) {
    return this.jwt.sign(
      { sub: userId },
      { secret: this.config.get('JWT_REFRESH_SECRET'), expiresIn: '30d' },
    );
  }

  async issueTokensPublic(user: User, res: any) {
    return this.issueTokens(user, res);
  }

  private async issueTokens(user: User, res: any) {
    const access_token = this.signAccess(user.id);
    const refresh = this.signRefresh(user.id);
    await this.users.saveRefreshToken(user.id, refresh);

    const isProd = this.config.get('NODE_ENV') === 'production';
    res.cookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      sameSite: isProd ? 'none' : 'lax',
      secure: isProd,
      maxAge: REFRESH_TTL_SEC * 1000,
      path: '/',
    });

    return { access_token, user: this.users.toPublic(user) };
  }

  // ── Public methods ─────────────────────────────────────────────────────────

  async register(email: string, password: string, res: any) {
    const user = await this.users.create(email, password);
    return this.issueTokens(user, res);
  }

  async login(email: string, password: string, res: any) {
    const user = await this.users.findByEmail(email);
    const valid = user ? await this.users.validatePassword(user, password) : false;

    if (!user || !valid) {
      await this.audit.record({
        user_id: user?.id,
        event_type: 'login_failed',
        metadata: { email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.audit.record({ user_id: user.id, event_type: 'login_success', metadata: { email } });
    return this.issueTokens(user, res);
  }

  async logout(userId: string, res: any) {
    await this.users.saveRefreshToken(userId, null);
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Logged out' };
  }

  async forgotPassword(email: string): Promise<{ message: string; reset_url?: string }> {
    const user = await this.users.findByEmail(email);
    // Always respond the same way to prevent email enumeration
    if (!user) return { message: 'If that email exists, a reset link has been sent.' };

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await this.users.saveResetToken(user.id, token, expires);

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3000');
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await this.mail.sendPasswordReset(email, resetUrl);

    const smtpHost = this.config.get<string>('SMTP_HOST');
    if (!smtpHost) {
      return { message: 'If that email exists, a reset link has been sent.', reset_url: resetUrl };
    }

    return { message: 'If that email exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await this.users.findByResetToken(token);
    if (!user) throw new BadRequestException('Invalid or expired reset token');
    if (newPassword.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    await this.users.updatePassword(user.id, newPassword);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (user.password_hash) {
      const valid = await this.users.validatePassword(user, currentPassword);
      if (!valid) throw new BadRequestException('סיסמה נוכחית שגויה');
    }
    if (newPassword.length < 8) throw new BadRequestException('הסיסמה החדשה חייבת להכיל לפחות 8 תווים');
    await this.users.updatePassword(user.id, newPassword);
  }

  async refresh(req: any, res: any) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No refresh token');

    let payload: { sub: string };
    try {
      payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const valid = await this.users.validateRefreshToken(payload.sub, token);
    if (!valid) throw new UnauthorizedException('Refresh token revoked');

    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return this.issueTokens(user, res);
  }
}
