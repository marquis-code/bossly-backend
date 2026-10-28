import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { WhatsappClientService } from './whatsapp-client.service';
import { WhatsappContact, WhatsappContactDocument } from './whatsapp-contact.schema';
import { WhatsappOtp, WhatsappOtpDocument } from './whatsapp-otp.schema';
import { AuditService } from '../audit/audit.service';
import { numericOtp, sha256 } from '../../common/utils/tokens';
import { toWhatsAppNumber } from '../../common/utils/phone';
import type { AuthenticatedUser } from '../../common/types/auth.types';

@ApiTags('WhatsApp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappSettingsController {
  constructor(
    private readonly config: ConfigService,
    private readonly client: WhatsappClientService,
    private readonly audit: AuditService,
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    @InjectModel(WhatsappOtp.name) private readonly otps: Model<WhatsappOtpDocument>,
  ) {}

  @Get('status')
  async status(@CurrentBusiness() businessId: string) {
    const contacts = await this.contacts.find({ businessId }).sort({ verifiedAt: -1 }).lean().exec();
    const readiness = {
      accessToken: Boolean(this.config.get('whatsapp.accessToken')),
      phoneNumberId: Boolean(this.config.get('whatsapp.phoneNumberId')),
      appSecret: Boolean(this.config.get('whatsapp.appSecret')),
      verifyToken: Boolean(this.config.get('whatsapp.verifyToken')),
      platformNumber: Boolean(this.config.get('whatsapp.platformNumber')),
    };
    return {
      configured: this.client.isConfigured,
      readiness,
      missing: Object.entries(readiness).filter(([, ready]) => !ready).map(([key]) => key),
      platformNumber: this.client.platformNumber,
      contacts: contacts.map((c) => ({
        id: c._id,
        phone: c.phone,
        verifiedAt: c.verifiedAt,
        lastInboundAt: c.lastInboundAt,
        displayName: c.displayName,
        alertsOptOut: c.alertsOptOut,
      })),
      templates: [
        { name: 'ojaly_daily_summary', params: 7, description: 'Business name, revenue, profit, expenses, new debts, low stock count, top product' },
        { name: 'ojaly_weekly_summary', params: 7, description: 'Same as daily summary, sent weekly' },
        { name: 'ojaly_low_stock', params: 3, description: 'Business name, product, remaining quantity' },
        { name: 'ojaly_debt_reminder', params: 4, description: 'Business name, customer, amount, due date (for approved customer reminders)' },
      ],
      webhookUrl: `${this.config.get('apiUrl')}/whatsapp/webhook`,
    };
  }

  @Post('otp')
  @Permissions(PERMISSIONS.WHATSAPP_MANAGE)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async generateOtp(@CurrentUser() user: AuthenticatedUser, @CurrentBusiness() businessId: string) {
    const code = numericOtp(6);
    await this.otps.updateMany(
      { userId: user.id, businessId, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    ).exec();
    await this.otps.create({
      businessId,
      userId: user.id,
      codeHash: sha256(code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const platform = this.client.platformNumber;
    const waNumber = platform ? toWhatsAppNumber(platform) : null;
    await this.audit.record({ businessId, actorId: user.id, action: 'whatsapp.otp_generated', entity: 'whatsapp_otp' });
    return {
      code,
      expiresInSeconds: 600,
      platformNumber: platform,
      waLink: waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(`LINK ${code}`)}` : null,
      instructions: platform
        ? `Open WhatsApp, message ${platform} and send LINK ${code}. The code expires in 10 minutes.`
        : 'Add WHATSAPP_PLATFORM_NUMBER to your environment so customers and sellers can message your bot.',
    };
  }

  @Delete('contacts/:id')
  @Permissions(PERMISSIONS.WHATSAPP_MANAGE)
  async unlink(@CurrentUser() user: AuthenticatedUser, @CurrentBusiness() businessId: string, @Param('id') id: string) {
    const contact = await this.contacts.findOne({ _id: id, businessId }).exec();
    if (contact) {
      contact.businessId = null;
      contact.userId = null;
      contact.verifiedAt = null;
      await contact.save();
    }
    await this.audit.record({ businessId, actorId: user.id, action: 'whatsapp.unlinked', entity: 'whatsapp_contact', entityId: id });
    return { unlinked: true };
  }

  @Post('test')
  @Permissions(PERMISSIONS.WHATSAPP_MANAGE)
  async test(@CurrentBusiness() businessId: string) {
    const contact = await this.contacts.findOne({ businessId, verifiedAt: { $ne: null } }).sort({ verifiedAt: -1 }).lean().exec();
    if (!contact) return { sent: false, reason: 'no_linked_number' };
    const result = await this.client.send({
      businessId,
      phone: contact.phone,
      text: '✅ Ojaly WhatsApp is connected. Send HELP to see what you can do.',
    });
    return { sent: result.sent, usedTemplate: result.usedTemplate, reason: result.reason };
  }
}
