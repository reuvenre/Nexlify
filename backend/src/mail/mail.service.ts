import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

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
