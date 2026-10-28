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
    this.from = config.get<string>('resend.from') || 'Ojaly <hello@ojaly.ng>';
  }

  get isConfigured(): boolean {
    return Boolean(this.resend);
  }

  async send(input: SendMailInput): Promise<{ sent: boolean; id?: string }> {
    if (!this.resend) {
      await this.log(input, 'skipped', null, 'RESEND_API_KEY not configured');
      this.logger.warn(`Email skipped (Resend not configured): ${input.template} to ${this.maskEmail(input.to)}`);
      return { sent: false };
    }
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        replyTo: input.replyTo || this.config.get<string>('resend.replyTo') || undefined,
      });
      if (error) throw new Error(error.message);
      await this.log(input, 'sent', data?.id ?? null, null);
      return { sent: true, id: data?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email error';
      await this.log(input, 'failed', null, message);
      this.logger.error(`Email failed: ${input.template} to ${this.maskEmail(input.to)} — ${message}`);
      return { sent: false };
    }
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
