import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { formatInTimeZone } from 'date-fns-tz';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { User, UserDocument } from '../users/user.schema';
import { WhatsappContact, WhatsappContactDocument } from '../whatsapp/whatsapp-contact.schema';
import { MailService } from '../mail/mail.service';
import { WhatsappClientService } from '../whatsapp/whatsapp-client.service';
import { summaryEmail } from '../mail/email-templates';
import { resolveDateRange } from '../../common/utils/dates';
import { formatNaira } from '../../common/utils/money';

export type SummaryPeriod = 'daily' | 'weekly';

export interface SummaryPayload {
  businessName: string;
  period: SummaryPeriod;
  periodLabel: string;
  revenueKobo: number;
  profitKobo: number;
  expensesKobo: number;
  salesCount: number;
  newDebtsKobo: number;
  outstandingKobo: number;
  lowStockCount: number;
  topProduct: string | null;
  text: string;
  html: string;
  subject: string;
}

@Injectable()
export class SummariesService {
  private readonly logger = new Logger(SummariesService.name);

  constructor(
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(WhatsappContact.name) private readonly contacts: Model<WhatsappContactDocument>,
    private readonly mail: MailService,
    private readonly whatsapp: WhatsappClientService,
    private readonly config: ConfigService,
  ) {}

  async build(businessId: string, period: SummaryPeriod): Promise<SummaryPayload> {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new BadRequestException('Business not found.');
    const range = resolveDateRange(period === 'daily' ? 'today' : 'week');
    const [salesAgg, expensesAgg, debtsAgg, newDebtsAgg, lowStock, topProductAgg] = await Promise.all([
      this.sales.aggregate([
        { $match: { businessId, soldAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: null, revenueKobo: { $sum: '$totalKobo' }, profitKobo: { $sum: '$grossProfitKobo' }, count: { $sum: 1 } } },
      ]).exec(),
      this.expenses.aggregate([
        { $match: { businessId, date: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: null, total: { $sum: '$amountKobo' } } },
      ]).exec(),
      this.debts.aggregate([
        { $match: { businessId, balanceKobo: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$balanceKobo' } } },
      ]).exec(),
      this.debts.aggregate([
        { $match: { businessId, createdAt: { $gte: range.from, $lte: range.to } } },
        { $group: { _id: null, total: { $sum: '$principalKobo' } } },
      ]).exec(),
      this.products.aggregate([
        { $match: { businessId, isActive: true } },
        { $unwind: '$variants' },
        { $match: { 'variants.isActive': true, $expr: { $lte: ['$variants.quantity', '$variants.lowStockThreshold'] } } },
        { $count: 'count' },
      ]).exec(),
      this.sales.aggregate([
        { $match: { businessId, soldAt: { $gte: range.from, $lte: range.to } } },
        { $unwind: '$items' },
        { $group: { _id: '$items.productId', name: { $first: '$items.name' }, qty: { $sum: '$items.quantity' } } },
        { $sort: { qty: -1 } },
        { $limit: 1 },
      ]).exec(),
    ]);
    const revenueKobo = salesAgg[0]?.revenueKobo || 0;
    const grossProfitKobo = salesAgg[0]?.profitKobo || 0;
    const expensesKobo = expensesAgg[0]?.total || 0;
    const profitKobo = grossProfitKobo - expensesKobo;
    const salesCount = salesAgg[0]?.count || 0;
    const newDebtsKobo = newDebtsAgg[0]?.total || 0;
    const outstandingKobo = debtsAgg[0]?.total || 0;
    const lowStockCount = lowStock[0]?.count || 0;
    const topProduct = topProductAgg[0]?.name || null;
    const periodLabel = period === 'daily' ? 'today' : 'this week';
    const text = [
      `📊 *${business.name} — ${periodLabel}*`,
      '',
      `💰 Sales: ${formatNaira(revenueKobo)} (${salesCount} sale${salesCount === 1 ? '' : 's'})`,
      `📈 Profit: ${formatNaira(profitKobo)}`,
      `🧾 Expenses: ${formatNaira(expensesKobo)}`,
      `🤝 New debts: ${formatNaira(newDebtsKobo)}`,
      `⏳ Owed to you: ${formatNaira(outstandingKobo)}`,
      `📦 Low stock: ${lowStockCount} item${lowStockCount === 1 ? '' : 's'}`,
      topProduct ? `🔥 Top product: ${topProduct}` : '🔥 Top product: none yet',
      '',
      `See the full picture: ${this.config.get('appUrl')}/app/reports`,
      '',
      'Reply HELP for WhatsApp commands. Reply STOP to opt out of alerts.',
    ].join('\n');
    const mail = summaryEmail({
      businessName: business.name,
      periodLabel,
      revenueKobo,
      profitKobo,
      expensesKobo,
      newDebtsKobo,
      topProduct: topProduct || undefined,
      lowStockCount,
      dashboardUrl: `${this.config.get('appUrl')}/app/reports`,
    });
    return {
      businessName: business.name,
      period,
      periodLabel,
      revenueKobo,
      profitKobo,
      expensesKobo,
      salesCount,
      newDebtsKobo,
      outstandingKobo,
      lowStockCount,
      topProduct,
      text,
      html: mail.html,
      subject: mail.subject,
    };
  }

  async preview(businessId: string, period: SummaryPeriod) {
    const payload = await this.build(businessId, period);
    return {
      ...payload,
      shareLink: `https://wa.me/?text=${encodeURIComponent(payload.text)}`,
    };
  }

  async sendNow(businessId: string, period: SummaryPeriod) {
    const payload = await this.build(businessId, period);
    return this.deliver(businessId, payload);
  }

  async deliver(businessId: string, payload: SummaryPayload) {
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) return { whatsapp: false, email: false };
    const settings = business.summarySettings || { channels: { whatsapp: true, email: true } };
    const owner = await this.memberships.findOne({ businessId, role: 'owner', status: 'active' }).lean().exec();
    const user = owner ? await this.users.findById(owner.userId).lean().exec() : null;
    let whatsappSent = false;
    let emailSent = false;
    if (settings.channels?.whatsapp !== false) {
      const contact = owner ? await this.contacts.findOne({ userId: owner.userId, verifiedAt: { $ne: null }, alertsOptOut: false }).lean().exec() : null;
      if (contact) {
        const result = await this.whatsapp.send({
          businessId,
          phone: contact.phone,
          text: payload.text,
          template: {
            name: payload.period === 'daily' ? 'ojaly_daily_summary' : 'ojaly_weekly_summary',
            language: 'en',
            params: [
              business.name,
              formatNaira(payload.revenueKobo),
              formatNaira(payload.profitKobo),
              formatNaira(payload.expensesKobo),
              formatNaira(payload.newDebtsKobo),
              String(payload.lowStockCount),
              payload.topProduct || 'None yet',
            ],
          },
        });
        whatsappSent = result.sent;
      }
    }
    if (settings.channels?.email !== false && user?.email && user.notificationPrefs?.weeklySummary !== false) {
      const result = await this.mail.send({
        to: user.email,
        subject: payload.subject,
        html: payload.html,
        template: payload.period === 'daily' ? 'daily_summary' : 'weekly_summary',
        businessId,
      });
      emailSent = result.sent;
    }
    return { whatsapp: whatsappSent, email: emailSent };
  }

  @Cron('* * * * *', { timeZone: 'Africa/Lagos', name: 'summary-dispatcher' })
  async dispatchDueSummaries(): Promise<void> {
    try {
      const now = new Date();
      const lagosTime = formatInTimeZone(now, 'Africa/Lagos', 'HH:mm');
      const lagosDay = Number(formatInTimeZone(now, 'Africa/Lagos', 'i')) % 7; // 1=Mon..7=Sun -> 0=Sun
      const todayKey = formatInTimeZone(now, 'Africa/Lagos', 'yyyy-MM-dd');
      const businesses = await this.businesses.find({
        $or: [
          { 'summarySettings.dailyEnabled': true },
          { 'summarySettings.weeklyEnabled': true },
        ],
      }).limit(500).exec();
      for (const business of businesses) {
        const settings = business.summarySettings;
        if (!settings) continue;
        const sendTime = settings.sendTime || '20:00';
        if (lagosTime < sendTime) continue;
        if (settings.dailyEnabled) {
          const claimed = await this.businesses.findOneAndUpdate(
            {
              _id: business._id,
              $or: [
                { lastDailySummaryAt: null },
                { lastDailySummaryAt: { $lt: new Date(`${todayKey}T00:00:00+01:00`) } },
              ],
            },
            { $set: { lastDailySummaryAt: now } },
            { new: true },
          ).exec();
          if (claimed) {
            try {
              const payload = await this.build(business._id.toString(), 'daily');
              await this.deliver(business._id.toString(), payload);
            } catch (error) {
              this.logger.warn(`Daily summary failed: ${error instanceof Error ? error.message : 'unknown'}`);
            }
          }
        }
        if (settings.weeklyEnabled && Number(settings.weeklyDay) === lagosDay) {
          const claimedWeekly = await this.businesses.findOneAndUpdate(
            {
              _id: business._id,
              $or: [
                { lastWeeklySummaryAt: null },
                { lastWeeklySummaryAt: { $lt: new Date(now.getTime() - 6 * 86400000) } },
              ],
            },
            { $set: { lastWeeklySummaryAt: now } },
            { new: true },
          ).exec();
          if (claimedWeekly) {
            try {
              const payload = await this.build(business._id.toString(), 'weekly');
              await this.deliver(business._id.toString(), payload);
            } catch (error) {
              this.logger.warn(`Weekly summary failed: ${error instanceof Error ? error.message : 'unknown'}`);
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Summary dispatcher failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
