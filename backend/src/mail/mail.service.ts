import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  /** True when SMTP is configured — otherwise sends are logged, not delivered. */
  isConfigured(): boolean {
    return !!this.config.get<string>('SMTP_HOST');
  }

  private transporter() {
    return nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT') || 587,
      secure: this.config.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });
  }

  /**
   * Send one broadcast email (admin → user). Returns false when SMTP isn't configured
   * (the caller reports that nothing was actually delivered). The message body is the
   * admin's plain text, wrapped in a simple RTL HTML shell.
   */
  async sendBroadcast(email: string, subject: string, message: string): Promise<boolean> {
    if (!this.isConfigured()) {
      this.logger.warn(`[DEV] Broadcast to ${email} (SMTP not configured): ${subject}`);
      return false;
    }
    const from = this.config.get<string>('SMTP_FROM') || `"Nexlify PRO" <noreply@alibotpro.com>`;
    const safe = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
    await this.transporter().sendMail({
      from,
      to: email,
      subject,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color:#111;">
          <div style="padding:20px 24px;background:#6366f1;color:#fff;border-radius:12px 12px 0 0;">
            <strong style="font-size:18px;">Nexlify PRO</strong>
          </div>
          <div style="padding:24px;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px;line-height:1.7;">
            ${safe}
          </div>
        </div>
      `,
    });
    return true;
  }

  async sendPasswordReset(email: string, resetUrl: string): Promise<void> {
    const smtpHost = this.config.get<string>('SMTP_HOST');

    if (!smtpHost) {
      // Dev fallback: log the link so developers can use it without SMTP
      this.logger.warn(`[DEV] Password reset link for ${email}: ${resetUrl}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: this.config.get<number>('SMTP_PORT') || 587,
      secure: this.config.get<number>('SMTP_PORT') === 465,
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    });

    const from = this.config.get<string>('SMTP_FROM') || `"Nexlify PRO" <noreply@alibotpro.com>`;

    await transporter.sendMail({
      from,
      to: email,
      subject: 'איפוס סיסמה — Nexlify PRO',
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>איפוס סיסמה</h2>
          <p>קיבלנו בקשה לאיפוס הסיסמה שלך. לחץ על הכפתור למטה להמשך:</p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;
                    text-decoration:none;border-radius:8px;font-weight:bold;margin:16px 0;">
            איפוס סיסמה
          </a>
          <p style="color:#6b7280;font-size:13px;">
            הקישור יפוג תוך שעה אחת. אם לא ביקשת איפוס סיסמה, ניתן להתעלם מהודעה זו.
          </p>
          <p style="color:#6b7280;font-size:11px;">
            אם הכפתור לא עובד, העתק את הקישור הבא לדפדפן:<br/>
            <span style="word-break:break-all;">${resetUrl}</span>
          </p>
        </div>
      `,
    });

    this.logger.log(`Password reset email sent to ${email}`);
  }
}
