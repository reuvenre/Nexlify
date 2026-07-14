import {
  Injectable, UnauthorizedException, BadRequestException, Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/user.entity';
import { encrypt, decrypt } from '../common/crypto';
import { generateTotpSecret, verifyTotp, totpUri } from '../common/totp';
import { primaryUrl } from '../common/urls';
import * as QRCode from 'qrcode';

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
    // Blocked accounts can't get a session — enforced on EVERY login path (password,
    // 2FA, Google, refresh) since they all funnel through here.
    if ((user as any).is_blocked) {
      throw new UnauthorizedException('החשבון חסום — פנה למנהל המערכת');
    }
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

    // refresh_token is also returned in the body so cross-domain clients (frontend on
    // a different domain than the API) can persist it — the HttpOnly cookie above is
    // a third-party cookie there and gets blocked by browsers.
    return { access_token, refresh_token: refresh, user: this.users.toPublic(user) };
  }

  // ── Public methods ─────────────────────────────────────────────────────────

  async register(email: string, password: string, res: any) {
    const user = await this.users.create(email, password);
    return this.issueTokens(user, res);
  }

  async login(email: string, password: string, res: any) {
    const user = await this.users.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await this.users.validatePassword(user, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // 2FA gate: don't issue session tokens yet — hand back a short-lived
    // challenge token the client exchanges together with a TOTP code.
    if (user.totp_enabled) {
      const mfa_token = this.jwt.sign(
        { sub: user.id, mfa: true },
        { secret: this.config.get('JWT_SECRET'), expiresIn: '5m' },
      );
      return { mfa_required: true, mfa_token };
    }
    return this.issueTokens(user, res);
  }

  // ── Two-factor auth (TOTP) ─────────────────────────────────────────────────

  /** Second login step: verify the TOTP code against the short-lived mfa_token. */
  async loginMfa(mfaToken: string, code: string, res: any) {
    let payload: any;
    try {
      payload = this.jwt.verify(mfaToken, { secret: this.config.get('JWT_SECRET') });
    } catch {
      throw new UnauthorizedException('פג תוקף — התחבר שוב');
    }
    if (!payload?.mfa || !payload?.sub) throw new UnauthorizedException('Invalid challenge');

    const user = await this.users.findById(payload.sub);
    if (!user?.totp_enabled || !user.totp_secret_enc) throw new UnauthorizedException('2FA not active');
    const secret = decrypt(user.totp_secret_enc);
    if (!verifyTotp(secret, code)) throw new UnauthorizedException('קוד שגוי');

    return this.issueTokens(user, res);
  }

  /** Begin enrollment: create a secret (not yet enabled) and return a QR + manual key. */
  async setup2fa(userId: string): Promise<{ qr: string; secret: string; otpauth: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    if (user.totp_enabled) throw new BadRequestException('אימות דו-שלבי כבר פעיל');

    const secret = generateTotpSecret();
    await this.users.setTotp(userId, encrypt(secret), false); // store pending, not enabled
    const otpauth = totpUri(secret, user.email);
    const qr = await QRCode.toDataURL(otpauth);
    return { qr, secret, otpauth };
  }

  /** Confirm enrollment: verify a code against the pending secret and activate. */
  async enable2fa(userId: string, code: string): Promise<{ enabled: true }> {
    const user = await this.users.findById(userId);
    if (!user?.totp_secret_enc) throw new BadRequestException('התחל הגדרה קודם');
    const secret = decrypt(user.totp_secret_enc);
    if (!verifyTotp(secret, code)) throw new BadRequestException('קוד שגוי — נסה שוב');
    await this.users.setTotp(userId, user.totp_secret_enc, true);
    return { enabled: true };
  }

  /** Disable 2FA — requires a valid current code (or password) to prevent hijack. */
  async disable2fa(userId: string, code: string): Promise<{ enabled: false }> {
    const user = await this.users.findById(userId);
    if (!user?.totp_enabled || !user.totp_secret_enc) return { enabled: false };
    const secret = decrypt(user.totp_secret_enc);
    if (!verifyTotp(secret, code)) throw new BadRequestException('קוד שגוי');
    await this.users.setTotp(userId, null, false);
    return { enabled: false };
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

    // FRONTEND_URL may list several domains (CORS) — email the canonical first one.
    const frontendUrl = primaryUrl(this.config.get<string>('FRONTEND_URL'));
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    await this.mail.sendPasswordReset(email, resetUrl);

    // Only expose the reset URL in local development (convenience when SMTP isn't set up).
    // NEVER return it otherwise — doing so lets any unauthenticated caller obtain a
    // victim's reset token directly from the API response → account takeover.
    const isDev = this.config.get('NODE_ENV') === 'development';
    const smtpHost = this.config.get<string>('SMTP_HOST');
    if (isDev && !smtpHost) {
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
    // Prefer the HttpOnly cookie (same-domain), fall back to the x-refresh-token header
    // (cross-domain clients that can't rely on the third-party cookie).
    const token = req.cookies?.[REFRESH_COOKIE] || req.headers?.['x-refresh-token'];
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
