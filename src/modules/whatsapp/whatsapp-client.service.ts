import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { WhatsappContact, WhatsappContactDocument } from './whatsapp-contact.schema';
import { WhatsappMessage, WhatsappMessageDocument } from './whatsapp-message.schema';
import { normalizeNigerianPhone } from '../../common/utils/phone';

export interface TemplatePayload {
  name: string;
  language?: string;
  params?: string[];
}

export interface SendWhatsappInput {
  businessId: string;
  phone: string;
  text: string;
  template?: TemplatePayload;
  forceTemplate?: boolean;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class WhatsappClientService {
  private readonly logger = new Logger(WhatsappClientService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    @InjectModel(WhatsappMessage.name) private readonly messages: Model<WhatsappMessageDocument>,
  ) {}

  get provider(): string {
    return this.config.get('whatsapp.provider') || 'cloud';
  }

  get isConfigured(): boolean {
    if (this.provider === 'evolution') {
      return Boolean(this.config.get('whatsapp.evolutionApiUrl') && this.config.get('whatsapp.evolutionApiKey'));
    }
    if (!this.config.get('whatsapp.phoneNumberId')) return false;
    if (this.provider === '360dialog') return Boolean(this.config.get('whatsapp.d360ApiKey'));
    return Boolean(this.config.get('whatsapp.accessToken'));
  }

  get platformNumber(): string | null {
    return this.config.get('whatsapp.platformNumber') || null;
  }

  async withinCustomerWindow(phone: string): Promise<boolean> {
    if (this.provider === 'evolution') return true;
    const normalized = normalizeNigerianPhone(phone) || phone;
    const contact = await this.contacts.findOne({ phone: normalized }).lean().exec();
    return Boolean(contact?.lastInboundAt && Date.now() - new Date(contact.lastInboundAt).getTime() < WINDOW_MS);
  }

  async send(input: SendWhatsappInput): Promise<{ sent: boolean; usedTemplate: boolean; reason?: string }> {
    const phone = normalizeNigerianPhone(input.phone);
    if (!phone) return { sent: false, usedTemplate: false, reason: 'Invalid phone number' };
    if (!this.isConfigured) {
      await this.log(input.businessId, phone, input.text, 'skipped', 'WhatsApp API is not configured', input.template?.name ?? null);
      this.logger.warn(`WhatsApp skipped (not configured) for ${phone.slice(0, 6)}***`);
      return { sent: false, usedTemplate: false, reason: 'not_configured' };
    }

    if (this.provider === 'evolution') {
      try {
        const baseUrl = this.config.get<string>('whatsapp.evolutionApiUrl')!;
        const apiKey = this.config.get<string>('whatsapp.evolutionApiKey')!;
        const instance = this.config.get<string>('whatsapp.evolutionInstance') || 'ojaly';
        const url = `${baseUrl}/message/sendText/${instance}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: apiKey,
          },
          body: JSON.stringify({
            number: phone,
            text: input.text,
          }),
          signal: AbortSignal.timeout(15000),
        });
        const data = (await response.json().catch(() => ({}))) as Record<string, any>;
        if (!response.ok) {
          throw new Error(data?.message || data?.error || `Evolution API ${response.status}`);
        }
        const metaId = data?.key?.id || data?.id || null;
        await this.messages.create({
          businessId: input.businessId || null,
          direction: 'outbound',
          phone,
          body: input.text,
          messageType: 'text',
          templateName: null,
          metaMessageId: metaId,
          status: 'sent',
        });
        await this.contacts.updateOne({ phone }, { $set: { lastOutboundAt: new Date() } }).exec();
        return { sent: true, usedTemplate: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Evolution API send failed';
        await this.log(input.businessId || '', phone, input.text, 'failed', message, null);
        this.logger.error(`Evolution API send failed: ${message}`);
        return { sent: false, usedTemplate: false, reason: 'send_failed' };
      }
    }

    const inWindow = await this.withinCustomerWindow(phone);
    const useTemplate = input.forceTemplate || !inWindow;
    if (useTemplate && !input.template) {
      await this.log(input.businessId, phone, input.text, 'skipped', '24-hour window closed and no template supplied', null);
      return { sent: false, usedTemplate: false, reason: 'template_required' };
    }

    const payload = useTemplate
      ? {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'template',
          template: {
            name: input.template!.name,
            language: { code: input.template!.language || 'en' },
            ...(input.template!.params?.length
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: input.template!.params.map((text) => ({ type: 'text', text })),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: phone,
          type: 'text',
          text: { preview_url: true, body: input.text.slice(0, 4096) },
        };

    try {
      const is360 = this.provider === '360dialog';
      const url = is360
        ? `${this.config.get('whatsapp.d360BaseUrl')}/messages`
        : `https://graph.facebook.com/v21.0/${this.config.get('whatsapp.phoneNumberId')}/messages`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (is360) headers['D360-API-KEY'] = String(this.config.get('whatsapp.d360ApiKey'));
      else headers.Authorization = `Bearer ${this.config.get('whatsapp.accessToken')}`;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });
      const data = (await response.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(data?.error?.message || `WhatsApp API ${response.status}`);
      const metaId = data.messages?.[0]?.id ?? null;
      await this.messages.create({
        businessId: input.businessId,
        direction: 'outbound',
        phone,
        body: input.text,
        messageType: useTemplate ? 'template' : 'text',
        templateName: useTemplate ? input.template!.name : null,
        metaMessageId: metaId,
        status: 'sent',
      });
      await this.contacts.updateOne({ phone }, { $set: { lastOutboundAt: new Date() } }).exec();
      return { sent: true, usedTemplate: useTemplate };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WhatsApp send failed';
      await this.log(input.businessId, phone, input.text, 'failed', message, input.template?.name ?? null);
      this.logger.error(`WhatsApp send failed: ${message}`);
      return { sent: false, usedTemplate: useTemplate, reason: 'send_failed' };
    }
  }

  async sendTextDirect(businessId: string, phone: string, text: string): Promise<{ sent: boolean }> {
    const result = await this.send({ businessId, phone, text });
    return { sent: result.sent };
  }

  async recordInbound(input: {
    phone: string;
    body: string;
    metaMessageId: string;
    displayName?: string;
    messageType?: string;
    timestamp?: Date;
    businessId?: string | null;
  }): Promise<void> {
    const phone = normalizeNigerianPhone(input.phone) || input.phone;
    await this.contacts.updateOne(
      { phone },
      {
        $set: {
          lastInboundAt: input.timestamp || new Date(),
          ...(input.displayName ? { displayName: input.displayName } : {}),
          ...(input.businessId !== undefined ? { businessId: input.businessId } : {}),
        },
      },
      { upsert: true },
    ).exec();
    await this.messages.updateOne(
      { metaMessageId: input.metaMessageId },
      {
        $setOnInsert: {
          businessId: input.businessId ?? null,
          direction: 'inbound',
          phone,
          body: input.body.slice(0, 4096),
          messageType: input.messageType || 'text',
          metaMessageId: input.metaMessageId,
          status: 'received',
          whatsappTimestamp: input.timestamp || new Date(),
        },
      },
      { upsert: true },
    ).exec();
  }

  async updateStatus(metaMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed', error?: string): Promise<void> {
    await this.messages.updateOne(
      { metaMessageId },
      { $set: { status, ...(error ? { error } : {}) } },
    ).exec();
  }

  private async log(
    businessId: string,
    phone: string,
    body: string,
    status: 'failed' | 'skipped',
    error: string,
    templateName: string | null,
  ): Promise<void> {
    try {
      await this.messages.create({
        businessId,
        direction: 'outbound',
        phone,
        body: body.slice(0, 4096),
        messageType: templateName ? 'template' : 'text',
        templateName,
        status,
        error,
      });
    } catch {
      // no-op
    }
  }
}
