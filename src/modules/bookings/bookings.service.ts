import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, FilterQuery, Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Counter, CounterDocument } from '../plans/counter.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Provider, ProviderDocument } from '../providers/provider.schema';
import { Service, ServiceDocument } from '../services/service.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { DebtsService } from '../debts/debts.service';
import { ReceiptsService } from '../receipts/receipts.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { AvailabilityService } from './availability.service';
import { Booking, BookingDocument, BookingStatus } from './booking.schema';
import { nextSequence } from '../../common/utils/order-number';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { addMinutes, localDateKey } from './booking.utils';
import { addDays, addMonths } from 'date-fns';
import {
  BookingQueryDto, CancelBookingDto, CreateBookingDto, CreateRecurringBookingDto, RescheduleBookingDto,
} from './booking.dto';

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
    @InjectModel(Service.name) private readonly services: Model<ServiceDocument>,
    @InjectModel(Provider.name) private readonly providers: Model<ProviderDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Counter.name) private readonly counters: Model<CounterDocument>,
    @InjectModel(Debt.name) private readonly debtModel: Model<DebtDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly availability: AvailabilityService,
    private readonly debts: DebtsService,
    private readonly receipts: ReceiptsService,
    private readonly waitlist: WaitlistService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async list(businessId: string, query: BookingQueryDto) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const filter: FilterQuery<BookingDocument> = { businessId };
    if (query.status && query.status !== 'all') filter.status = query.status;
    if (query.providerId) filter.providerId = query.providerId;
    if (query.serviceId) filter.serviceId = query.serviceId;
    if (query.search) {
      const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ customerName: rx }, { customerPhone: rx }, { bookingNumber: rx }, { serviceName: rx }];
    }
    if (query.date) {
      const from = new Date(`${query.date}T00:00:00+01:00`);
      const to = new Date(`${query.date}T23:59:59+01:00`);
      filter.startAt = { $gte: from, $lte: to };
    } else {
      if (query.from) filter.startAt = { ...(filter.startAt || {}), $gte: new Date(query.from) };
      if (query.to) filter.startAt = { ...(filter.startAt || {}), $lte: new Date(query.to) };
    }
    const page = query.page || 1;
    const limit = query.limit || 100;
    const [items, total] = await Promise.all([
      this.bookings.find(filter).sort({ startAt: 1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    const today = localDateKey(new Date(), business.timezone || 'Africa/Lagos');
    const todayStart = new Date(`${today}T00:00:00+01:00`);
    const todayEnd = new Date(`${today}T23:59:59+01:00`);
    const [todayCount, upcomingCount, pendingCount] = await Promise.all([
      this.bookings.countDocuments({ businessId, startAt: { $gte: todayStart, $lte: todayEnd }, status: { $nin: ['cancelled'] } }).exec(),
      this.bookings.countDocuments({ businessId, startAt: { $gte: new Date() }, status: { $in: ['pending', 'confirmed'] } }).exec(),
      this.bookings.countDocuments({ businessId, status: 'pending' }).exec(),
    ]);
    return {
      items: items.map((b) => this.view(b)),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
      summary: { today: todayCount, upcoming: upcomingCount, pending: pendingCount },
    };
  }

  async findOne(businessId: string, id: string) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    return this.view(booking);
  }

  async create(
    userId: string,
    businessId: string,
    dto: CreateBookingDto,
    source: 'dashboard' | 'storefront' | 'whatsapp' | 'walk_in' = 'dashboard',
    series?: { id: string; index: number; total: number },
    notify = true,
  ) {
    const [business, service] = await Promise.all([
      this.businesses.findById(businessId).lean().exec(),
      this.services.findOne({ _id: dto.serviceId, businessId, isActive: true }).lean().exec(),
    ]);
    if (!business) throw new NotFoundException('Business not found.');
    if (!service) throw new NotFoundException('Service not found.');
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    if (!this.normalDate(dto.startAt)) throw new BadRequestException('Choose a valid start time.');
    const startAt = new Date(dto.startAt);
    const provider = await this.resolveProvider(businessId, service, dto.providerId);
    const addOns = this.selectedAddOns(service, dto.addOnNames || []);
    const addonMinutes = addOns.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
    const durationMinutes = service.durationMinutes + addonMinutes;
    const timezone = business.timezone || 'Africa/Lagos';
    await this.availability.assertSlot(businessId, service._id.toString(), startAt, String(provider._id), timezone, durationMinutes, { ignoreWindow: source !== 'storefront' });

    const totalKobo = service.priceKobo + addOns.reduce((sum, a) => sum + a.priceKobo, 0);
    const depositPercent = business.bookingSettings?.depositPercent || 0;
    const depositKobo = service.requiresDeposit
      ? Math.min(totalKobo, service.depositKobo || Math.round((totalKobo * depositPercent) / 100))
      : 0;
    const shouldConfirm = Boolean(business.bookingSettings?.autoConfirm) && depositKobo <= 0;
    const blockStartAt = addMinutes(startAt, -(service.bufferBeforeMinutes || 0));
    const endAt = addMinutes(startAt, durationMinutes);
    const blockEndAt = addMinutes(endAt, service.bufferAfterMinutes || 0);

    const session = await this.connection.startSession();
    let created!: BookingDocument;
    let customerId: string | null = null;
    try {
      await session.withTransaction(async () => {
        const conflict = await this.bookings.find({
          businessId,
          providerId: String(provider._id),
          status: { $in: ['pending', 'confirmed'] },
          blockStartAt: { $lt: blockEndAt },
          blockEndAt: { $gt: blockStartAt },
        }).session(session).lean().exec();
        if (conflict.length >= Math.max(1, service.maxBookingsPerSlot || 1)) {
          throw new ConflictException('That time was just taken. Please choose another slot.');
        }
        let customer = await this.customers.findOne({ businessId, phone }).session(session).exec();
        if (!customer) {
          const [newCustomer] = await this.customers.create([{
            businessId, name: sanitizeText(dto.customerName, 100) || 'Customer', phone,
            email: dto.customerEmail || null, totalSpentKobo: 0, outstandingKobo: 0,
          }], { session });
          customer = newCustomer;
        } else if (dto.customerEmail && !customer.email) {
          customer.email = dto.customerEmail;
          await customer.save({ session });
        }
        customerId = customer._id.toString();
        const bookingNumber = await nextSequence(
          this.counters as unknown as Model<Record<string, unknown>>,
          businessId,
          'booking',
          'BKG',
        );
        const [newBooking] = await this.bookings.create([{
          businessId,
          bookingNumber,
          publicToken: randomToken(24),
          serviceId: service._id.toString(),
          serviceName: service.name,
          serviceCategory: service.category,
          serviceImageUrl: service.imageUrl || null,
          providerId: String(provider._id),
          providerName: provider.name,
          providerAvatarUrl: provider.avatarUrl || null,
          providerColor: provider.color || null,
          customerId,
          customerName: customer.name,
          customerPhone: customer.phone,
          customerEmail: customer.email,
          startAt,
          endAt,
          blockStartAt,
          blockEndAt,
          durationMinutes,
          bufferBeforeMinutes: service.bufferBeforeMinutes || 0,
          bufferAfterMinutes: service.bufferAfterMinutes || 0,
          timezone,
          addOns,
          status: shouldConfirm ? 'confirmed' : 'pending',
          source,
          notes: sanitizeText(dto.notes, 2000),
          priceKobo: totalKobo,
          depositKobo,
          amountPaidKobo: 0,
          paymentStatus: 'unpaid',
          seriesId: series?.id || null,
          seriesIndex: series?.index || 0,
          seriesTotal: series?.total || 1,
          createdBy: userId,
          history: [{ status: shouldConfirm ? 'confirmed' : 'pending', at: new Date(), by: userId, note: 'Booking created' }],
        }], { session });
        created = newBooking;
      });
    } finally {
      await session.endSession();
    }

    if (notify) await this.notifications.create({
      businessId,
      type: 'booking',
      title: `New booking · ${created.bookingNumber}`,
      message: `${created.customerName} booked ${created.serviceName} with ${created.providerName}.`,
      tone: 'success',
      data: { bookingId: created._id.toString(), startAt: created.startAt.toISOString() },
    });
    if (notify) await this.sendConfirmation(created, business as unknown as BusinessDocument).catch(() => undefined);
    return this.view(created);
  }

  async createRecurring(userId: string, businessId: string, dto: CreateRecurringBookingDto) {
    const seriesId = randomToken(12);
    const created: { id: string }[] = [];
    for (let index = 0; index < dto.occurrences; index++) {
      const base = new Date(dto.startAt);
      const startAt = index === 0 ? base
        : dto.frequency === 'monthly' ? addMonths(base, index)
          : addDays(base, index * (dto.frequency === 'biweekly' ? 14 : 7));
      try {
        const booking = await this.create(
          userId,
          businessId,
          { ...dto, startAt: startAt.toISOString() },
          'dashboard',
          { id: seriesId, index, total: dto.occurrences },
          index === 0,
        );
        created.push(booking);
      } catch (error) {
        if (created.length) {
          const ids = created.map((b) => b.id);
          await this.bookings.updateMany(
            { _id: { $in: ids }, businessId },
            { $set: { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Recurring series could not be completed' } },
          ).exec();
        }
        throw new BadRequestException(`Could not create session ${index + 1}: ${error instanceof Error ? error.message : 'that time is unavailable.'}`);
      }
    }
    return { seriesId, bookings: created };
  }

  async createPublic(businessId: string, dto: CreateBookingDto) {
    return this.create(null as unknown as string, businessId, dto, 'storefront');
  }

  async calendar(token: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const stamp = (value: Date) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const clean = (value: unknown) => String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ojaly//Bookings//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${booking.publicToken}@ojaly.org`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(booking.startAt)}`,
      `DTEND:${stamp(booking.endAt)}`,
      `SUMMARY:${clean(`${booking.serviceName} at ${business?.name || 'Ojaly'}`)}`,
      `DESCRIPTION:${clean(`With ${booking.providerName}. Reference ${booking.bookingNumber}. Manage: ${this.config.get('appUrl')}/booking/${booking.publicToken}`)}`,
      `LOCATION:${clean(business?.address || '')}`,
      'STATUS:CONFIRMED',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return { filename: `ojaly-${booking.bookingNumber}.ics`, content: `${lines.join('\r\n')}\r\n` };
  }

  async byToken(token: string) {
    const booking = await this.bookings.findOne({ publicToken: token }).lean().exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    return {
      booking: this.view(booking),
      business: business ? {
        id: String(business._id), name: business.name, slug: business.slug,
        logoUrl: business.logoUrl, brandColor: business.brandColor,
        publicPhone: business.publicPhone, whatsappNumber: business.whatsappNumber,
        address: business.address, bookingSettings: business.bookingSettings,
      } : null,
    };
  }

  async updateStatus(userId: string, businessId: string, id: string, status: BookingStatus, reason?: string) {
    if (status === 'completed') return this.complete(userId, businessId, id);
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'completed') {
      throw new BadRequestException('A completed booking cannot be changed.');
    }
    if (booking.status === 'cancelled' && status !== 'cancelled') {
      throw new BadRequestException('This booking was cancelled.');
    }
    booking.status = status;
    if (status === 'cancelled') {
      booking.cancelledAt = new Date();
      booking.cancellationReason = reason || 'Cancelled by business';
    }
    if (status === 'no_show') booking.notes = `${booking.notes}\nNo-show recorded`.trim();
    booking.history.push({ status, at: new Date(), by: userId, note: reason || '' });
    await booking.save();
    if (status === 'cancelled') await this.waitlist.offerOpening(businessId, booking.serviceId, booking.startAt).catch(() => undefined);
    return this.view(booking);
  }

  async cancel(userId: string, businessId: string, id: string, dto: CancelBookingDto) {
    return this.updateStatus(userId, businessId, id, 'cancelled', dto.reason);
  }

  async cancelPublic(token: string, dto: CancelBookingDto) {
    const booking = await this.bookings.findOne({ publicToken: token }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (['cancelled', 'completed'].includes(booking.status)) throw new BadRequestException('This booking can no longer be cancelled.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    const windowHours = business?.bookingSettings?.cancellationWindowHours ?? 24;
    if (booking.startAt.getTime() - Date.now() < windowHours * 3600000) {
      throw new BadRequestException(`Online cancellation closes ${windowHours} hours before the appointment. Please contact the business.`);
    }
    booking.status = 'cancelled';
    booking.cancelledAt = new Date();
    booking.cancellationReason = dto.reason || 'Cancelled by customer';
    booking.history.push({ status: 'cancelled', at: new Date(), by: 'customer', note: booking.cancellationReason });
    await booking.save();
    await this.waitlist.offerOpening(booking.businessId, booking.serviceId, booking.startAt).catch(() => undefined);
    return { cancelled: true, booking: this.view(booking) };
  }

  async reschedule(userId: string, businessId: string, id: string, dto: RescheduleBookingDto) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    return this.applyReschedule(booking, dto, userId);
  }

  async reschedulePublic(token: string, dto: RescheduleBookingDto) {
    const booking = await this.bookings.findOne({ publicToken: token }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    const business = await this.businesses.findById(booking.businessId).lean().exec();
    if (business?.bookingSettings?.cancellationWindowHours && booking.startAt.getTime() - Date.now() < business.bookingSettings.cancellationWindowHours * 3600000) {
      throw new BadRequestException('Online changes are closed for this appointment. Please contact the business.');
    }
    return this.applyReschedule(booking, dto, null);
  }

  private async applyReschedule(booking: BookingDocument, dto: RescheduleBookingDto, userId: string | null) {
    const oldStartAt = booking.startAt;
    if (['cancelled', 'completed'].includes(booking.status)) throw new BadRequestException('This booking cannot be rescheduled.');
    const service = await this.services.findOne({ _id: booking.serviceId, businessId: booking.businessId }).lean().exec();
    if (!service) throw new NotFoundException('Service not found.');
    const providerId = dto.providerId || booking.providerId;
    const provider = await this.providers.findOne({ _id: providerId, businessId: booking.businessId, isActive: true, isBookable: true }).lean().exec();
    if (!provider) throw new NotFoundException('Team member not found.');
    const startAt = new Date(dto.startAt);
    if (Number.isNaN(startAt.getTime())) throw new BadRequestException('Choose a valid time.');
    await this.availability.assertSlot(booking.businessId, booking.serviceId, startAt, providerId, booking.timezone);
    const duration = booking.durationMinutes;
    const blockStartAt = addMinutes(startAt, -(booking.bufferBeforeMinutes || 0));
    const blockEndAt = addMinutes(addMinutes(startAt, duration), booking.bufferAfterMinutes || 0);
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const conflict = await this.bookings.find({
          _id: { $ne: booking._id }, businessId: booking.businessId, providerId,
          status: { $in: ['pending', 'confirmed'] },
          blockStartAt: { $lt: blockEndAt }, blockEndAt: { $gt: blockStartAt },
        }).session(session).lean().exec();
        if (conflict.length) throw new ConflictException('That time is not available.');
        booking.startAt = startAt;
        booking.endAt = addMinutes(startAt, duration);
        booking.blockStartAt = blockStartAt;
        booking.blockEndAt = blockEndAt;
        booking.providerId = String(provider._id);
        booking.providerName = provider.name;
        booking.providerAvatarUrl = provider.avatarUrl || null;
        booking.providerColor = provider.color || null;
        booking.status = booking.status === 'pending' ? 'pending' : 'confirmed';
        booking.history.push({ status: 'rescheduled', at: new Date(), by: userId, note: `Moved to ${startAt.toISOString()}` });
        await booking.save({ session });
      });
    } finally {
      await session.endSession();
    }
    await this.waitlist.offerOpening(booking.businessId, booking.serviceId, oldStartAt).catch(() => undefined);
    return this.view(booking);
  }

  async recordPayment(bookingId: string, amountKobo: number, reference: string) {
    const booking = await this.bookings.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('This booking was cancelled.');
    booking.amountPaidKobo = Math.min(booking.priceKobo, booking.amountPaidKobo + amountKobo);
    booking.paymentStatus = booking.amountPaidKobo >= booking.priceKobo ? 'paid' : 'deposit_paid';
    booking.paymentReference = reference;
    if (booking.status === 'pending') booking.status = 'confirmed';
    booking.history.push({ status: 'payment', at: new Date(), by: 'paystack', note: `${amountKobo} kobo received` });
    await booking.save();
    return this.view(booking);
  }

  async complete(userId: string, businessId: string, id: string) {
    const booking = await this.bookings.findOne({ _id: id, businessId }).exec();
    if (!booking) throw new NotFoundException('Booking not found.');
    if (booking.status === 'cancelled') throw new BadRequestException('A cancelled booking cannot be completed.');
    if (booking.status === 'completed' && booking.saleId) return this.view(booking);
    if (!booking.customerId) throw new BadRequestException('This booking has no customer record.');
    const session = await this.connection.startSession();
    let sale: SaleDocument | null = null;
    let debtId: string | null = null;
    try {
      await session.withTransaction(async () => {
        const saleNumber = await nextSequence(
          this.counters as unknown as Model<Record<string, unknown>>,
          businessId,
          'sale',
          'SALE',
        );
        const total = booking.priceKobo;
        const paid = Math.min(total, booking.amountPaidKobo);
        const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        const [createdSale] = await this.sales.create([{
          businessId,
          saleNumber,
          customerId: booking.customerId,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          customerEmail: booking.customerEmail,
          items: [{
            productId: `service:${booking.serviceId}`,
            variantId: null,
            name: booking.serviceName,
            variantName: booking.addOns.map((a) => a.name).join(', '),
            sku: '',
            quantity: 1,
            unitPriceKobo: total,
            unitCostKobo: 0,
            discountKobo: 0,
            lineTotalKobo: total,
            lineCostKobo: 0,
            imageUrl: booking.serviceImageUrl,
          }],
          subtotalKobo: total,
          discountKobo: 0,
          deliveryFeeKobo: 0,
          totalKobo: total,
          costKobo: 0,
          grossProfitKobo: total,
          amountPaidKobo: paid,
          paymentStatus: status,
          paymentMethod: paid > 0 ? 'paystack' : 'cash',
          notes: `Service booking ${booking.bookingNumber}`,
          source: 'booking',
          soldAt: booking.startAt,
          createdBy: userId,
        }], { session });
        sale = createdSale;
        if (paid < total && booking.customerId) {
          const debt = await this.debts.createWithinTransaction({
            businessId,
            customerId: booking.customerId,
            customerName: booking.customerName,
            customerPhone: booking.customerPhone,
            customerEmail: booking.customerEmail,
            amountKobo: total - paid,
            dueDate: new Date(Date.now() + 7 * 86400000),
            saleId: createdSale._id.toString(),
            notes: `Balance from service booking ${booking.bookingNumber}`,
            createdBy: userId,
          }, session);
          debtId = debt._id.toString();
          createdSale.debtId = debtId;
          await createdSale.save({ session });
        }
        await this.customers.updateOne(
          { _id: booking.customerId, businessId },
          { $inc: { totalSpentKobo: total, orderCount: 1 }, $set: { lastPurchaseAt: new Date() } },
          { session },
        ).exec();
        booking.status = 'completed';
        booking.completedAt = new Date();
        booking.saleId = createdSale._id.toString();
        booking.history.push({ status: 'completed', at: new Date(), by: userId, note: saleNumber });
        await booking.save({ session });
        await this.businesses.updateOne(
          { _id: businessId, firstSaleAt: null },
          { $set: { firstSaleAt: new Date() } },
          { session },
        ).exec();
      });
    } finally {
      await session.endSession();
    }
    if (sale) {
      try {
        const receipt = await this.receipts.createForSale(sale, true);
        await this.sales.updateOne({ _id: (sale as SaleDocument)._id }, { $set: { receiptId: receipt._id.toString() } }).exec();
      } catch (error) {
        this.logger.warn(`Service receipt failed: ${error instanceof Error ? error.message : 'unknown'}`);
      }
    }
    return this.view(booking);
  }

  private async resolveProvider(businessId: string, service: ServiceDocument | (Service & { _id: unknown }), providerId?: string) {
    const filter: Record<string, unknown> = { businessId, isActive: true, isBookable: true };
    if (providerId) {
      if (service.providerIds?.length && !service.providerIds.includes(providerId)) {
        throw new BadRequestException('That team member does not offer this service.');
      }
      filter._id = providerId;
    }
    else if (service.providerIds?.length) filter._id = { $in: service.providerIds };
    const provider = await this.providers.findOne(filter).sort({ sortOrder: 1 }).lean().exec();
    if (!provider) throw new BadRequestException('No team member is available for this service.');
    return provider;
  }

  private selectedAddOns(service: ServiceDocument | (Service & { _id: unknown }), names: string[]) {
    const available = service.addOns || [];
    return names.map((name) => {
      const addon = available.find((a) => a.name === name);
      if (!addon) throw new BadRequestException(`Add-on “${name}” is not available.`);
      return { name: addon.name, priceKobo: addon.priceKobo, durationMinutes: addon.durationMinutes || 0 };
    });
  }

  private normalDate(value: string) {
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) ? d : null;
  }

  private async sendConfirmation(booking: BookingDocument, business: BusinessDocument) {
    const when = new Intl.DateTimeFormat('en-NG', {
      timeZone: booking.timezone, weekday: 'short', day: 'numeric', month: 'short',
      hour: 'numeric', minute: '2-digit',
    }).format(booking.startAt);
    await this.notifications.create({
      businessId: booking.businessId,
      type: 'booking',
      title: `Booking confirmed · ${booking.bookingNumber}`,
      message: `${booking.customerName} · ${booking.serviceName} · ${when}`,
      tone: 'success',
      data: { bookingId: booking._id.toString(), publicToken: booking.publicToken },
    });
    if (booking.customerEmail) {
      await this.mail.send({
        to: booking.customerEmail,
        subject: `Your ${booking.serviceName} appointment at ${business.name}`,
        html: `<p>Hi ${booking.customerName},</p><p>Your <strong>${booking.serviceName}</strong> appointment with <strong>${booking.providerName}</strong> is booked for <strong>${when}</strong>.</p><p>Reference: ${booking.bookingNumber}</p><p><a href="${this.config.get('appUrl')}/booking/${booking.publicToken}">View or manage your booking</a> · <a href="${this.config.get('apiUrl')}/public/bookings/${booking.publicToken}/calendar.ics">Add to calendar</a></p><p>${business.bookingSettings?.policy || ''}</p>`,
        template: 'booking_confirmation',
        businessId: booking.businessId,
      });
    }
  }

  private view(b: BookingDocument | (Booking & { _id: unknown })) {
    const booking = b as BookingDocument;
    return {
      id: String(booking._id),
      bookingNumber: booking.bookingNumber,
      publicToken: booking.publicToken,
      serviceId: booking.serviceId,
      serviceName: booking.serviceName,
      serviceCategory: booking.serviceCategory,
      serviceImageUrl: booking.serviceImageUrl,
      providerId: booking.providerId,
      providerName: booking.providerName,
      providerAvatarUrl: booking.providerAvatarUrl,
      providerColor: booking.providerColor,
      customerId: booking.customerId,
      customerName: booking.customerName,
      customerPhone: booking.customerPhone,
      customerEmail: booking.customerEmail,
      startAt: booking.startAt,
      endAt: booking.endAt,
      durationMinutes: booking.durationMinutes,
      timezone: booking.timezone,
      addOns: booking.addOns,
      status: booking.status,
      source: booking.source,
      notes: booking.notes,
      priceKobo: booking.priceKobo,
      depositKobo: booking.depositKobo,
      amountPaidKobo: booking.amountPaidKobo,
      paymentStatus: booking.paymentStatus,
      paymentReference: booking.paymentReference,
      seriesId: booking.seriesId,
      seriesIndex: booking.seriesIndex,
      seriesTotal: booking.seriesTotal,
      saleId: booking.saleId,
      cancellationReason: booking.cancellationReason,
      cancelledAt: booking.cancelledAt,
      completedAt: booking.completedAt,
      history: booking.history,
      createdAt: booking.createdAt,
    };
  }
}
