import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Resend } from 'resend';
import { MailLog, MailLogDocument } from './mail-log.schema';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  template: string;
  businessId?: string | null;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly config: ConfigService;

  constructor(
    config: ConfigService,
    @InjectModel(MailLog.name) private readonly logs: Model<MailLogDocument>,
  ) {
    this.config = config;
    const key = config.get<string>('resend.apiKey');
    this.resend = key ? new Resend(key) : null;
    let configuredFrom = (config.get<string>('resend.from') || 'Ojaly <hello@ojaly.org>').trim();
    if ((configuredFrom.startsWith('"') && configuredFrom.endsWith('"')) || (configuredFrom.startsWith("'") && configuredFrom.endsWith("'"))) {
      configuredFrom = configuredFrom.slice(1, -1).trim();
    }
    configuredFrom = configuredFrom
      .replace(/@ojaly\.ng/gi, '@ojaly.org')
      .replace(/@bossly\.[a-z]+/gi, '@ojaly.org');

    if (!configuredFrom.includes('@ojaly.org')) {
      configuredFrom = 'Ojaly <hello@ojaly.org>';
    }

    this.from = configuredFrom;
    this.logger.log(`MailService ready: sender="${this.from}", resendConfigured=${Boolean(this.resend)}`);
  }

  get isConfigured(): boolean {
    return Boolean(this.resend);
  }

  async send(input: SendMailInput, retries = 2): Promise<{ sent: boolean; id?: string }> {
    if (!this.resend) {
      await this.log(input, 'skipped', null, 'RESEND_API_KEY not configured');
      this.logger.warn(`Email skipped (Resend not configured): ${input.template} to ${this.maskEmail(input.to)}`);
      return { sent: false };
    }

    let fromAddress = this.from;
    if (fromAddress.includes('@ojaly.ng') || fromAddress.includes('@bossly.')) {
      fromAddress = fromAddress
        .replace(/@ojaly\.ng/gi, '@ojaly.org')
        .replace(/@bossly\.[a-z]+/gi, '@ojaly.org');
    }

    let replyToAddress = (input.replyTo || this.config.get<string>('resend.replyTo') || 'hello@ojaly.org').trim();
    if ((replyToAddress.startsWith('"') && replyToAddress.endsWith('"')) || (replyToAddress.startsWith("'") && replyToAddress.endsWith("'"))) {
      replyToAddress = replyToAddress.slice(1, -1).trim();
    }
    replyToAddress = replyToAddress
      .replace(/@ojaly\.ng/gi, '@ojaly.org')
      .replace(/@bossly\.[a-z]+/gi, '@ojaly.org');

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = Math.round(1000 * attempt + Math.random() * 500);
          this.logger.warn(`Retrying email delivery (${attempt}/${retries}) for ${input.template} in ${delay}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const { data, error } = await this.resend.emails.send({
          from: fromAddress,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          replyTo: replyToAddress || undefined,
        });

        if (error) {
          throw new Error(error.message || 'Resend error');
        }

        await this.log(input, 'sent', data?.id ?? null, null);
        this.logger.log(`Email sent: ${input.template} to ${this.maskEmail(input.to)} [id: ${data?.id}]`);
        return { sent: true, id: data?.id };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const message = lastError.message;
        const isRateLimit = message.toLowerCase().includes('rate limit') || message.includes('429');
        const isTransient = isRateLimit || message.toLowerCase().includes('timeout') || message.includes('500') || message.includes('502') || message.includes('503');

        if (!isTransient && attempt < retries) {
          this.logger.error(`Non-retryable email error for ${input.template}: ${message}`);
          break;
        }
      }
    }

    const finalMessage = lastError?.message || 'Unknown email error';
    await this.log(input, 'failed', null, finalMessage);
    this.logger.error(`Email delivery failed: ${input.template} to ${this.maskEmail(input.to)} — ${finalMessage}`);
    return { sent: false };
  }

  private async log(
    input: SendMailInput,
    status: 'sent' | 'failed' | 'skipped',
    providerMessageId: string | null,
    error: string | null,
  ): Promise<void> {
    try {
      await this.logs.create({
        businessId: input.businessId ?? null,
        to: input.to,
        template: input.template,
        subject: input.subject,
        status,
        providerMessageId,
        error,
        metadata: input.metadata ?? {},
      });
    } catch {
      // Swallow log failure.
    }
  }

  private maskEmail(email: string): string {
    const [name, domain] = email.split('@');
    if (!domain) return '***';
    return `${name.slice(0, 2)}***@${domain}`;
  }
}
