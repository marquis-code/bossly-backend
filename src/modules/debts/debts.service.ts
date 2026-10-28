import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { Debt, DebtDocument, DebtStatus } from './debt.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { MailService } from '../mail/mail.service';
import { debtReminderEmail } from '../mail/email-templates';
import { randomToken } from '../../common/utils/tokens';
import { normalizeNigerianPhone, waLink } from '../../common/utils/phone';
import { lagosDisplay } from '../../common/utils/dates';
import { CreateDebtDto, DebtQueryDto, RecordDebtPaymentDto } from './dto/debt.dto';
import { formatNaira } from '../../common/utils/money';

export interface CreateDebtInput {
  businessId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  amountKobo: number;
  dueDate: Date;
  saleId?: string | null;
  orderId?: string | null;
  notes?: string;
  createdBy?: string | null;
}

@Injectable()
export class DebtsService {
  constructor(
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  statusFor(balance: number, paid: number, dueDate: Date): DebtStatus {
    if (balance <= 0) return 'paid';
    if (dueDate.getTime() < Date.now()) return 'overdue';
    return paid > 0 ? 'partial' : 'unpaid';
  }

  async createWithinTransaction(input: CreateDebtInput, session: ClientSession): Promise<DebtDocument> {
    if (input.amountKobo <= 0) throw new BadRequestException('A debt must be above zero.');
    const [debt] = await this.debts.create(
      [{
        businessId: input.businessId,
        customerId: input.customerId,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        customerEmail: input.customerEmail ?? null,
        saleId: input.saleId ?? null,
        orderId: input.orderId ?? null,
        principalKobo: input.amountKobo,
        paidKobo: 0,
        balanceKobo: input.amountKobo,
        dueDate: input.dueDate,
        status: 'unpaid',
        notes: input.notes ?? '',
        publicToken: randomToken(24),
        createdBy: input.createdBy ?? null,
      }],
      { session },
    );
    await this.customers.updateOne(
      { _id: input.customerId, businessId: input.businessId },
      { $inc: { outstandingKobo: input.amountKobo } },
      { session },
    ).exec();
    return debt;
  }

  async create(userId: string, businessId: string, dto: CreateDebtDto) {
    const phone = normalizeNigerianPhone(dto.customerPhone);
    if (!phone) throw new BadRequestException('Enter a valid customer phone number.');
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new BadRequestException('Enter a valid due date.');
    if (dueDate.getTime() < Date.now() - 86400000) {
      // Backdated debts are valid records.
    }
    let customer: CustomerDocument | null = null;
    if (dto.customerId) {
      customer = await this.customers.findOne({ _id: dto.customerId, businessId }).exec();
      if (!customer) throw new NotFoundException('Customer not found.');
    } else {
      customer = await this.customers.findOne({ businessId, phone }).exec();
      if (!customer) {
        customer = await this.customers.create({
          businessId,
          name: dto.customerName,
          phone,
          email: dto.customerEmail || null,
        });
      }
    }
    const debt = await this.debts.create({
      businessId,
      customerId: customer._id.toString(),
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      principalKobo: dto.amountKobo,
      paidKobo: 0,
      balanceKobo: dto.amountKobo,
      dueDate,
      status: this.statusFor(dto.amountKobo, 0, dueDate),
      notes: dto.notes || '',
      publicToken: randomToken(24),
      createdBy: userId,
    });
    await this.customers.updateOne(
      { _id: customer._id, businessId },
      { $inc: { outstandingKobo: dto.amountKobo } },
    ).exec();
    return debt;
  }

  async list(businessId: string, query: DebtQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<DebtDocument> = { businessId };
    if (query.customerId) filter.customerId = query.customerId;
    if (query.search) {
      const rx = new RegExp(this.escapeRegex(query.search), 'i');
      filter.$or = [{ customerName: rx }, { customerPhone: rx }, { customerEmail: rx }];
    }
    if (query.status && query.status !== 'all') {
      if (query.status === 'overdue') {
        filter.balanceKobo = { $gt: 0 };
        filter.dueDate = { $lt: new Date() };
      } else if (query.status === 'paid') {
        filter.balanceKobo = { $lte: 0 };
      } else {
        filter.status = query.status;
        filter.balanceKobo = { $gt: 0 };
      }
    }
    const [items, total, summary, overdueCount] = await Promise.all([
      this.debts.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.debts.countDocuments(filter).exec(),
      this.debts.aggregate([
        { $match: { businessId } },
        {
          $group: {
            _id: null,
            totalOutstanding: { $sum: { $cond: [{ $gt: ['$balanceKobo', 0] }, '$balanceKobo', 0] } },
            overdue: {
              $sum: {
                $cond: [
                  { $and: [{ $gt: ['$balanceKobo', 0] }, { $lt: ['$dueDate', new Date()] }] },
                  '$balanceKobo',
                  0,
                ],
              },
            },
            count: { $sum: 1 },
          },
        },
      ]).exec(),
      this.debts.countDocuments({ businessId, balanceKobo: { $gt: 0 }, dueDate: { $lt: new Date() } }).exec(),
    ]);
    const now = Date.now();
    return {
      items: items.map((d) => ({
        ...d,
        displayStatus: d.balanceKobo <= 0 ? 'paid' : new Date(d.dueDate).getTime() < now ? 'overdue' : d.status,
        daysOverdue: d.balanceKobo > 0 && new Date(d.dueDate).getTime() < now
          ? Math.floor((now - new Date(d.dueDate).getTime()) / 86400000)
          : 0,
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        totalOutstandingKobo: summary[0]?.totalOutstanding || 0,
        overdueKobo: summary[0]?.overdue || 0,
        overdueCount,
      },
    };
  }

  async summary(businessId: string) {
    const result = await this.debts.aggregate([
      { $match: { businessId, balanceKobo: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          outstandingKobo: { $sum: '$balanceKobo' },
          count: { $sum: 1 },
          overdueKobo: {
            $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, '$balanceKobo', 0] },
          },
          overdueCount: { $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, 1, 0] } },
        },
      },
    ]).exec();
    return {
      outstandingKobo: result[0]?.outstandingKobo || 0,
      count: result[0]?.count || 0,
      overdueKobo: result[0]?.overdueKobo || 0,
      overdueCount: result[0]?.overdueCount || 0,
    };
  }

  async findOne(businessId: string, debtId: string) {
    const debt = await this.debts.findOne({ _id: debtId, businessId }).lean().exec();
    if (!debt) throw new NotFoundException('Debt not found.');
    return debt;
  }

  async recordPayment(userId: string, businessId: string, debtId: string, dto: RecordDebtPaymentDto) {
    const debt = await this.debts.findOne({ _id: debtId, businessId }).exec();
    if (!debt) throw new NotFoundException('Debt not found.');
    if (dto.amountKobo > debt.balanceKobo) {
      throw new BadRequestException(`The balance is ${formatNaira(debt.balanceKobo)}. Enter that amount or less.`);
    }
    if (dto.reference && debt.payments.some((p) => p.reference === dto.reference)) {
      return debt;
    }
    debt.paidKobo += dto.amountKobo;
    debt.balanceKobo = Math.max(0, debt.principalKobo - debt.paidKobo);
    debt.payments.push({
      amountKobo: dto.amountKobo,
      method: dto.method || 'cash',
      reference: dto.reference || null,
      note: dto.note || null,
      paidAt: new Date(),
      recordedBy: userId,
      paymentId: null,
    });
    debt.status = this.statusFor(debt.balanceKobo, debt.paidKobo, debt.dueDate);
    if (debt.balanceKobo === 0) debt.settledAt = new Date();
    await debt.save();
    await this.customers.updateOne(
      { _id: debt.customerId, businessId },
      { $inc: { outstandingKobo: -dto.amountKobo } },
    ).exec();
    if (debt.saleId) {
      const sale = await this.sales.findOne({ _id: debt.saleId, businessId }).exec();
      if (sale) {
        sale.amountPaidKobo = Math.min(sale.totalKobo, sale.amountPaidKobo + dto.amountKobo);
        sale.paymentStatus = sale.amountPaidKobo >= sale.totalKobo ? 'paid' : sale.amountPaidKobo > 0 ? 'partial' : 'unpaid';
        await sale.save();
      }
    }
    if (debt.orderId) {
      const order = await this.orders.findOne({ _id: debt.orderId, businessId }).exec();
      if (order) {
        order.amountPaidKobo = Math.min(order.totalKobo, order.amountPaidKobo + dto.amountKobo);
        order.paymentStatus = order.amountPaidKobo >= order.totalKobo ? 'paid' : order.amountPaidKobo > 0 ? 'partial' : 'unpaid';
        if (order.paymentStatus === 'paid' && order.status === 'confirmed') order.status = 'paid';
        await order.save();
      }
    }
    return debt;
  }

  async sendReminder(userId: string, businessId: string, debtId: string, channel: 'whatsapp' | 'email') {
    const debt = await this.debts.findOne({ _id: debtId, businessId }).exec();
    if (!debt) throw new NotFoundException('Debt not found.');
    if (debt.balanceKobo <= 0) throw new BadRequestException('This debt is already paid.');
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new NotFoundException('Business not found.');
    const payUrl = `${this.config.get('appUrl')}/pay/debt/${debt.publicToken}`;
    if (channel === 'whatsapp') {
      if (!debt.customerPhone) throw new BadRequestException('This customer has no phone number.');
      const message =
        `Hello ${debt.customerName.split(' ')[0]}, this is a friendly reminder from ${business.name}.\n\n` +
        `Outstanding: ${formatNaira(debt.balanceKobo)}\nDue: ${lagosDisplay(debt.dueDate, 'd MMM yyyy')}\n\n` +
        `Pay securely: ${payUrl}\n\nThank you!`;
      debt.reminders.push({ channel: 'whatsapp', kind: 'manual', sentAt: new Date() });
      debt.lastReminderAt = new Date();
      await debt.save();
      return { link: waLink(debt.customerPhone, message), message, channel };
    }
    if (!debt.customerEmail) throw new BadRequestException('This customer has no email address.');
    const mail = debtReminderEmail({
      businessName: business.name,
      businessLogo: business.logoUrl,
      businessTagline: business.tagline,
      customerName: debt.customerName,
      amountKobo: debt.balanceKobo,
      dueDate: lagosDisplay(debt.dueDate, 'd MMM yyyy'),
      paymentUrl: payUrl,
      businessPhone: business.publicPhone || business.whatsappNumber || undefined,
    });
    const result = await this.mail.send({
      to: debt.customerEmail,
      subject: mail.subject,
      html: mail.html,
      template: 'debt_reminder',
      businessId,
      replyTo: business.email || undefined,
    });
    debt.reminders.push({ channel: 'email', kind: 'manual', sentAt: new Date() });
    debt.lastReminderAt = new Date();
    await debt.save();
    return { sent: result.sent, channel: 'email' };
  }

  /** Used by the daily cron. Sends at most one email per debt per configured interval. */
  async sendScheduledReminders(): Promise<{ sent: number; failed: number }> {
    const businesses = await this.businesses.find({}).lean().exec();
    let sent = 0;
    let failed = 0;
    for (const business of businesses) {
      const settings = business.alertSettings || {};
      if (settings.debtReminders === false) continue;
      const daysBefore = Number(settings.reminderDaysBefore ?? 2);
      const repeatDays = Number(settings.repeatOverdueEveryDays ?? 7);
      const threshold = new Date(Date.now() + daysBefore * 86400000);
      const candidates = await this.debts.find({
        businessId: business._id.toString(),
        balanceKobo: { $gt: 0 },
        customerEmail: { $ne: null },
        dueDate: { $lte: threshold },
        $or: [
          { lastReminderAt: null },
          { lastReminderAt: { $lte: new Date(Date.now() - repeatDays * 86400000) } },
          { status: { $ne: 'overdue' }, lastReminderAt: null },
        ],
      }).limit(100).exec();
      for (const debt of candidates) {
        if (!debt.customerEmail) continue;
        const mail = debtReminderEmail({
          businessName: business.name,
          businessLogo: business.logoUrl,
          businessTagline: business.tagline,
          customerName: debt.customerName,
          amountKobo: debt.balanceKobo,
          dueDate: lagosDisplay(debt.dueDate, 'd MMM yyyy'),
          paymentUrl: `${this.config.get('appUrl')}/pay/debt/${debt.publicToken}`,
          businessPhone: business.publicPhone || business.whatsappNumber || undefined,
        });
        const result = await this.mail.send({
          to: debt.customerEmail,
          subject: mail.subject,
          html: mail.html,
          template: 'debt_reminder',
          businessId: debt.businessId,
          replyTo: business.email || undefined,
        });
        if (result.sent) sent++;
        else failed++;
        debt.reminders.push({ channel: 'email', kind: 'scheduled', sentAt: new Date() });
        debt.lastReminderAt = new Date();
        debt.status = this.statusFor(debt.balanceKobo, debt.paidKobo, debt.dueDate);
        await debt.save();
      }
    }
    return { sent, failed };
  }

  async refreshOverdueStatuses(): Promise<void> {
    await this.debts.updateMany(
      { balanceKobo: { $gt: 0 }, dueDate: { $lt: new Date() }, status: { $ne: 'overdue' } },
      { $set: { status: 'overdue' } },
    ).exec();
    await this.debts.updateMany(
      { balanceKobo: { $gt: 0 }, dueDate: { $gte: new Date() }, status: 'overdue' },
      [
        {
          $set: {
            status: { $cond: [{ $gt: ['$paidKobo', 0] }, 'partial', 'unpaid'] },
          },
        },
      ],
    ).exec();
  }

  async publicTokenFor(businessId: string, debtId: string): Promise<string | null> {
    const debt = await this.debts.findOne({ _id: debtId, businessId }).select('publicToken').lean().exec();
    return debt?.publicToken || null;
  }

  async publicByToken(token: string) {
    const debt = await this.debts.findOne({ publicToken: token }).lean().exec();
    if (!debt) throw new NotFoundException('This payment link is invalid.');
    const business = await this.businesses.findById(debt.businessId).select('name slug logoUrl brandColor whatsappNumber').lean().exec();
    return {
      debt: {
        id: debt._id,
        customerName: debt.customerName,
        balanceKobo: debt.balanceKobo,
        principalKobo: debt.principalKobo,
        paidKobo: debt.paidKobo,
        dueDate: debt.dueDate,
        status: debt.status,
        publicToken: debt.publicToken,
      },
      business,
    };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
