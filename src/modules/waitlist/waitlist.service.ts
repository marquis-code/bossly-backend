import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { CreateWaitlistDto, WaitlistQueryDto } from './waitlist.dto';
import { WaitlistEntry, WaitlistDocument, WaitlistStatus } from './waitlist.schema';

@Injectable()
export class WaitlistService {
  constructor(
    @InjectModel(WaitlistEntry.name) private readonly entries: Model<WaitlistDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsappClientService,
  ) {}

  async join(businessId: string, dto: CreateWaitlistDto) {
    const service = await this.services.findOne({ _id: dto.serviceId, businessId, isActive: true, isPublic: true }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const from = this.localDate(dto.preferredFrom);
    const to = dto.days ? new Date(from.getTime() + (dto.days - 1) * 86400000) : this.localDate(dto.preferredTo || dto.preferredFrom);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new BadRequestException('Choose a valid date range.');
    if (to < from) throw new BadRequestException('The end of your preferred window must be after the start.');
    if (to.getTime() - from.getTime() > 90 * 86400000) throw new BadRequestException('Choose a waitlist window of 90 days or less.');
    const existing = await this.entries.findOne({ businessId, serviceId: dto.serviceId, customerPhone: phone, status: { $in: ['waiting', 'notified'] } }).lean().exec();
    if (existing) return { ...this.view(existing), already: true };
    const entry = await this.entries.create({
      businessId,
      serviceId: service._id.toString(),
      serviceName: service.name,
      providerId: dto.providerId || null,
      providerName: null,
      customerName: sanitizeText(dto.customerName, 100),
      customerPhone: phone,
      customerEmail: dto.customerEmail || null,
      preferredFrom: from,
      preferredTo: to,
      notes: sanitizeText(dto.notes, 500),
      status: 'waiting',
    });
    await this.notifications.create({
      businessId, type: 'booking', tone: 'info',
      title: 'New waitlist request',
      message: `${entry.customerName} wants ${service.name} between ${dto.preferredFrom} and ${to.toISOString().slice(0, 10)}.`,
      data: { waitlistId: entry._id.toString() },
    });
    return this.view(entry);
  }

  async list(businessId: string, query: WaitlistQueryDto) {
    const filter: Record<string, unknown> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    const entries = await this.entries.find(filter).sort({ preferredFrom: 1, createdAt: 1 }).limit(200).lean().exec();
    return entries.map((entry) => this.view(entry));
  }

  async setStatus(businessId: string, id: string, status: WaitlistStatus) {
    const entry = await this.entries.findOneAndUpdate({ _id: id, businessId }, { $set: { status } }, { new: true }).lean().exec();
    if (!entry) throw new NotFoundException('Waitlist request not found.');
    return this.view(entry);
  }

  async notify(businessId: string, id: string) {
    const entry = await this.entries.findOne({ _id: id, businessId }).exec();
    if (!entry) throw new NotFoundException('Waitlist request not found.');
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: entry.serviceId, businessId }).lean().exec(),
    ]);
    const when = `${entry.preferredFrom.toISOString().slice(0, 10)} – ${entry.preferredTo.toISOString().slice(0, 10)}`;
    const link = `${this.configUrl()}/s/${business?.slug || ''}/services/${entry.serviceId}`;
    if (entry.customerEmail) {
      await this.mail.send({
        to: entry.customerEmail,
        subject: `A spot may be open for ${entry.serviceName}`,
        html: `<p>Hi ${entry.customerName},</p><p>A slot may have opened for <strong>${entry.serviceName}</strong> at ${business?.name || 'your business'} in your preferred window (${when}).</p><p><a href="${link}">Check availability and book</a></p>`,
        template: 'waitlist_opening',
        businessId,
      }).catch(() => undefined);
    }
    if (entry.customerPhone) {
      await this.whatsapp.send({
        businessId,
        phone: entry.customerPhone,
        text: `Hi ${entry.customerName}! A spot may have opened for ${entry.serviceName} (${when}). Book: ${link}`,
      }).catch(() => undefined);
    }
    entry.status = 'notified';
    entry.notifiedAt = new Date();
    await entry.save();
    return this.view(entry);
  }

  async offerOpening(businessId: string, serviceId: string, startAt: Date) {
    const entries = await this.entries.find({
      businessId, serviceId, status: 'waiting',
      preferredFrom: { $lte: startAt }, preferredTo: { $gte: startAt },
    }).sort({ preferredFrom: 1, createdAt: 1 }).limit(3).exec();
    let notified = 0;
    for (const entry of entries) {
      try { await this.notify(businessId, entry._id.toString()); notified++; } catch { /* keep the rest of the list intact */ }
    }
    return { notified };
  }

  async remove(businessId: string, id: string) {
    const result = await this.entries.deleteOne({ _id: id, businessId }).exec();
    if (!result.deletedCount) throw new NotFoundException('Waitlist request not found.');
    return { removed: true };
  }

  private localDate(value: string) {
    return new Date(value.length === 10 ? `${value}T00:00:00+01:00` : value);
  }

  private configUrl() {
    return process.env.APP_URL || 'https://ojaly.org';
  }

  private view(entry: WaitlistEntry | (WaitlistEntry & { _id: unknown })) {
    const e = entry as WaitlistEntry & { _id: unknown };
    return {
      id: String(e._id), serviceId: e.serviceId, serviceName: e.serviceName,
      providerId: e.providerId, providerName: e.providerName,
      customerName: e.customerName, customerPhone: e.customerPhone, customerEmail: e.customerEmail,
      preferredFrom: e.preferredFrom, preferredTo: e.preferredTo,
      notes: e.notes, status: e.status, notifiedAt: e.notifiedAt, createdAt: e.createdAt,
    };
  }
}
