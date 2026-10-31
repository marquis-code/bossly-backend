import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { Model } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { WhatsappClientService } from './whatsapp-client.service';
import { WhatsappMessage, WhatsappMessageDocument } from './whatsapp-message.schema';
import { WhatsappContact, WhatsappContactDocument } from './whatsapp-contact.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { BotService } from './bot.service';
import { LlmParserService } from './llm-parser.service';

@ApiExcludeController()
@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly config: ConfigService,
    private readonly client: WhatsappClientService,
    private readonly bot: BotService,
    private readonly llm: LlmParserService,
    @InjectModel(WhatsappMessage.name) private readonly messages: Model<WhatsappMessageDocument>,
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  @Public()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    if (mode === 'subscribe' && token === this.config.get('whatsapp.verifyToken')) {
      res.status(200).send(challenge);
      return;
    }
    res.status(403).send('Forbidden');
  }

  @Public()
  @Post('webhook/evolution')
  @HttpCode(200)
  async receiveEvolution(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Query('token') queryToken?: string,
  ) {
    return this.handleEvolutionEvent(body, req.headers, queryToken);
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: Record<string, unknown>,
    @Query('token') queryToken?: string,
  ) {
    // If request has Evolution API format or Evolution API header, route to Evolution handler
    if (body.event || req.headers['apikey'] || this.client.provider === 'evolution') {
      return this.handleEvolutionEvent(body, req.headers, queryToken);
    }

    const secret = this.config.get('whatsapp.appSecret');
    if (!secret) throw new UnauthorizedException('WhatsApp app secret is not configured.');
    if (!req.rawBody || !signature) throw new UnauthorizedException('Missing WhatsApp signature.');
    const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Invalid WhatsApp signature.');

    const entries = (body.entry as unknown[]) || [];
    for (const entry of entries) {
      const changes = ((entry as Record<string, unknown>).changes as unknown[]) || [];
      for (const change of changes) {
        const value = (change as Record<string, unknown>).value as Record<string, unknown> | undefined;
        if (!value) continue;
        const statuses = (value.statuses as unknown[]) || [];
        for (const s of statuses) {
          const st = s as Record<string, unknown>;
          if (st.id && st.status) {
            await this.client.updateStatus(
              String(st.id),
              st.status as 'sent' | 'delivered' | 'read' | 'failed',
              Array.isArray(st.errors) ? JSON.stringify(st.errors).slice(0, 500) : undefined,
            );
          }
        }
        const messages = (value.messages as unknown[]) || [];
        for (const m of messages) {
          const msg = m as Record<string, unknown>;
          const from = String(msg.from || '');
          const id = String(msg.id || '');
          if (!from || !id) continue;
          const contacts = (value.contacts as unknown[]) || [];
          const profile = (contacts[0] as Record<string, unknown> | undefined)?.profile as Record<string, unknown> | undefined;
          const text = ((msg.text as Record<string, unknown> | undefined)?.body as string) || '';
          const type = String(msg.type || 'unknown');
          await this.client.recordInbound({
            phone: from,
            body: text || `[${type}]`,
            metaMessageId: id,
            displayName: profile?.name ? String(profile.name) : undefined,
            messageType: type,
            timestamp: msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : undefined,
          });
          // Claim this message exactly once, even if Meta retries the webhook.
          const claimed = await this.messages.findOneAndUpdate(
            { metaMessageId: id, botProcessedAt: null },
            { $set: { botProcessedAt: new Date() } },
            { new: true },
          ).exec();
          if (!claimed) continue;
          if (type !== 'text') {
            await this.client.sendTextDirect('', from, 'I can only read text right now. Send your sale as a message, for example: sold 2 shirts 5000, Tola owes 2000.');
            continue;
          }
          await this.bot.handleIncoming({ phone: from, name: profile?.name ? String(profile.name) : undefined, text });
        }
      }
    }
    return { received: true };
  }

  private async handleEvolutionEvent(
    body: Record<string, unknown>,
    headers: Record<string, unknown>,
    queryToken?: string,
  ) {
    const configuredKey = this.config.get<string>('whatsapp.evolutionApiKey');
    const verifyToken = this.config.get<string>('whatsapp.verifyToken');
    const incomingKey = String(
      headers['apikey'] || headers['x-api-key'] || headers['authorization'] || body['apikey'] || queryToken || '',
    ).replace(/^Bearer\s+/i, '');

    if (configuredKey && incomingKey && incomingKey !== configuredKey && incomingKey !== verifyToken) {
      throw new UnauthorizedException('Invalid Evolution API key or token.');
    }

    const event = String(body.event || '').toLowerCase().replace(/_/g, '.');

    // 1. Inbound messages
    if (event === 'messages.upsert') {
      const data = body.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const items = Array.isArray(data) ? data : data ? [data] : [];

      for (const item of items) {
        const key = item.key as Record<string, unknown> | undefined;
        if (!key) continue;

        const remoteJid = String(key.remoteJid || '');
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.includes('status@broadcast')) {
          continue; // Skip group messages and status broadcasts
        }

        const phone = remoteJid.replace(/@.*$/, '');
        const id = String(key.id || '');
        if (!phone || !id) continue;

        // If fromMe is true, only skip if it was an automated message sent by our API.
        // This allows users to test/use the bot by texting their own number ("Message yourself").
        if (key.fromMe === true) {
          if (item.source === 'api') continue;
          const isOutbound = await this.messages.findOne({ metaMessageId: id, direction: 'outbound' }).lean().exec();
          if (isOutbound) continue;
        }

        const messageObj = item.message as Record<string, unknown> | undefined;
        let text = String(
          messageObj?.conversation ||
          (messageObj?.extendedTextMessage as Record<string, unknown>)?.text ||
          (messageObj?.imageMessage as Record<string, unknown>)?.caption ||
          (messageObj?.videoMessage as Record<string, unknown>)?.caption ||
          (messageObj?.buttonsResponseMessage as Record<string, unknown>)?.selectedButtonId ||
          (messageObj?.buttonsResponseMessage as Record<string, unknown>)?.selectedDisplayText ||
          (messageObj?.templateButtonReplyMessage as Record<string, unknown>)?.selectedId ||
          ((messageObj?.listResponseMessage as Record<string, unknown>)?.singleSelectReply as Record<string, unknown>)?.selectedRowId ||
          '',
        ).trim();

        const isAudio = item.messageType === 'audioMessage' || Boolean(messageObj?.audioMessage);
        let audioTranscript: string | undefined;

        if (!text && isAudio) {
          const contact = await this.contacts.findOne({ phone: normalizeNigerianPhone(phone) || phone }).lean().exec();
          if (contact?.businessId && contact?.verifiedAt) {
            const business = await this.businesses.findById(contact.businessId).select('name').lean().exec();
            const catalog = (await this.products.find({ businessId: contact.businessId, isActive: true }).select('name priceKobo').lean().exec()) || [];
            const media = await this.client.downloadMediaBase64(item);
            if (media?.base64) {
              const parsedAudio = await this.llm.parseAudioVoiceNote(
                media.base64,
                media.mimetype,
                catalog as { name: string; priceKobo: number }[],
                business?.name || 'this business',
              );
              if (parsedAudio?.command) {
                text = parsedAudio.command;
                audioTranscript = parsedAudio.transcript;
              } else if (parsedAudio?.transcript) {
                audioTranscript = parsedAudio.transcript;
                text = parsedAudio.transcript;
              }
            }
          }
        }

        const pushName = item.pushName ? String(item.pushName) : undefined;
        const timestamp = item.messageTimestamp
          ? new Date(Number(item.messageTimestamp) * 1000)
          : new Date();

        await this.client.recordInbound({
          phone,
          body: text || (isAudio ? '[voice note]' : '[media]'),
          metaMessageId: id,
          displayName: pushName,
          messageType: isAudio ? 'audio' : text ? 'text' : String(item.messageType || 'media'),
          timestamp,
        });

        // Deduplicate message processing
        const claimed = await this.messages.findOneAndUpdate(
          { metaMessageId: id, botProcessedAt: null },
          { $set: { botProcessedAt: new Date() } },
          { new: true },
        ).exec();
        if (!claimed) continue;

        if (!text) {
          if (isAudio) {
            if (!this.llm.hasGemini) {
              await this.client.sendTextDirect('', phone, '🎙️ Voice note received, but Speech-to-Text is not active yet (GEMINI_API_KEY is not configured). Send your sale as text for now.');
            } else {
              await this.client.sendTextDirect('', phone, '🎙️ I heard your voice note, but could not detect a command. Try saying: "sold 2 Vintage Denim Jacket 10000, James owes 2000" or "expense 2500 transport".');
            }
          } else {
            await this.client.sendTextDirect('', phone, 'I can only read text and voice notes right now. Send your sale as a message, for example: sold 2 shirts 5000, Tola owes 2000.');
          }
          continue;
        }

        await this.bot.handleIncoming({ phone, name: pushName, text, audioTranscript });
      }
    } else if (event === 'messages.update') {
      // 2. Message status updates (sent, delivered, read, failed)
      const data = body.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const items = Array.isArray(data) ? data : data ? [data] : [];
      for (const item of items) {
        const key = item.key as Record<string, unknown> | undefined;
        const update = item.update as Record<string, unknown> | undefined;
        const id = String(key?.id || item.id || '');
        const rawStatus = String(update?.status || item.status || '').toUpperCase();
        if (id && rawStatus) {
          let status: 'sent' | 'delivered' | 'read' | 'failed' = 'sent';
          if (rawStatus === 'DELIVERY_ACK' || rawStatus === 'DELIVERED') status = 'delivered';
          else if (rawStatus === 'READ') status = 'read';
          else if (rawStatus === 'ERROR' || rawStatus === 'FAILED') status = 'failed';
          await this.client.updateStatus(id, status);
        }
      }
    }

    return { received: true };
  }
}
