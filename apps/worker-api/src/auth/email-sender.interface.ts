import { Logger } from '@nestjs/common';

export const EMAIL_SENDER_TOKEN = 'VEXEL_EMAIL_SENDER';

export interface SendMagicLinkEmailParams {
  to: string;
  name: string;
  magicLinkUrl: string;
  token: string;
  expiresInMinutes: number;
  locale: string;
}

export interface EmailSender {
  sendMagicLink(params: SendMagicLinkEmailParams): Promise<void>;
}

/**
 * Development / test email sender that logs magic links without making external HTTP calls.
 */
export class ConsoleEmailSender implements EmailSender {
  private readonly logger = new Logger(ConsoleEmailSender.name);
  public readonly sentEmails: SendMagicLinkEmailParams[] = [];

  async sendMagicLink(params: SendMagicLinkEmailParams): Promise<void> {
    this.sentEmails.push(params);
    this.logger.log(
      `[DEV MAGIC LINK] To: ${params.to} (${params.name}) | Expires: ${params.expiresInMinutes}m | URL: ${params.magicLinkUrl}`,
    );
  }
}

/**
 * Production email sender powered by Resend HTTP API using native fetch (zero external dependencies).
 */
export class ResendEmailSender implements EmailSender {
  private readonly logger = new Logger(ResendEmailSender.name);

  constructor(
    private readonly apiKey: string = process.env.RESEND_API_KEY || '',
    private readonly fromAddress: string = process.env.EMAIL_FROM || 'Vexel <auth@vexel.io>',
  ) {}

  async sendMagicLink(params: SendMagicLinkEmailParams): Promise<void> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY is required when using ResendEmailSender');
    }

    const isArabic = params.locale.toLowerCase().startsWith('ar');
    const subject = isArabic
      ? 'رابط تسجيل الدخول إلى Vexel'
      : 'Your Vexel sign-in link';

    const html = isArabic
      ? `<div dir="rtl" style="font-family:sans-serif;line-height:1.6;">
          <p>مرحباً ${params.name}،</p>
          <p>اضغط على الرابط أدناه لتسجيل الدخول إلى لوحة تحكم Vexel (صالح لمدة ${params.expiresInMinutes} دقيقة ويُستخدم لمرة واحدة فقط):</p>
          <p><a href="${params.magicLinkUrl}">${params.magicLinkUrl}</a></p>
        </div>`
      : `<div style="font-family:sans-serif;line-height:1.6;">
          <p>Hi ${params.name},</p>
          <p>Click the single-use link below to sign in to your Vexel dashboard (expires in ${params.expiresInMinutes} minutes):</p>
          <p><a href="${params.magicLinkUrl}">${params.magicLinkUrl}</a></p>
        </div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: [params.to],
        subject,
        html,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      this.logger.error(`Resend API failed (${response.status}): ${errBody}`);
      throw new Error(`Failed to send magic link email (${response.status})`);
    }
  }
}

export function createDefaultEmailSender(): EmailSender {
  if (
    process.env.EMAIL_PROVIDER?.toLowerCase() === 'resend' ||
    (process.env.NODE_ENV === 'production' && process.env.RESEND_API_KEY)
  ) {
    return new ResendEmailSender();
  }
  return new ConsoleEmailSender();
}

