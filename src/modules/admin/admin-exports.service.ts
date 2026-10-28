import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/user.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { Subscription, SubscriptionDocument } from '../plans/subscription.schema';
import { Payment, PaymentDocument } from '../payments/payment.schema';
import { AuditLog, AuditLogDocument } from '../audit/audit-log.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { AuditService } from '../audit/audit.service';

const MAX_ROWS = 5000;

@Injectable()
export class AdminExportsService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLogDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    private readonly affiliates: AffiliatesService,
    private readonly audit: AuditService,
  ) {}

  async export(resource: string, actorId: string, query: Record<string, unknown>) {
    const definitions: Record<string, () => Promise<Array<Record<string, unknown>>>> = {
      users: () => this.usersCsv(query),
      businesses: () => this.businessesCsv(query),
      payments: () => this.paymentsCsv(query),
      audit: () => this.auditCsv(query),
      affiliates: () => this.affiliates.exportAffiliates(),
      'affiliate-payouts': () => this.affiliates.exportPayouts(),
    };
    const loader = definitions[resource];
    if (!loader) throw new BadRequestException('Unknown export type.');
    const rows = await loader();
    const csv = toCsv(rows);
    await this.audit.record({
      actorId,
      actorType: 'platform_admin',
      action: 'admin.export',
      entity: 'export',
      entityId: resource,
      metadata: { resource, rows: rows.length },
    });
    return {
      filename: `ojaly-${resource}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      rows: rows.length,
    };
  }

  private async usersCsv(query: Record<string, unknown>) {
    const filter = searchFilter(query, ['name', 'email', 'phone']);
    const users = await this.users.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean().exec();
    const memberships = await this.memberships.find({ userId: { $in: users.map((u) => String(u._id)) } }).lean().exec();
    const businesses = await this.businesses.find({ _id: { $in: memberships.map((m) => m.businessId) } }).select('name slug').lean().exec();
    return users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      phone: u.phone || '',
      platformRole: u.platformRole || '',
      emailVerified: Boolean(u.emailVerifiedAt),
      active: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      businesses: memberships
        .filter((m) => m.userId === String(u._id))
        .map((m) => `${businesses.find((b) => String(b._id) === m.businessId)?.name || m.businessId} (${m.role})`)
        .join(' | '),
    }));
  }

  private async businessesCsv(query: Record<string, unknown>) {
    const filter = searchFilter(query, ['name', 'slug']);
    const businesses = await this.businesses.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean().exec();
    const ids = businesses.map((b) => String(b._id));
    const [owners, subs] = await Promise.all([
      this.memberships.find({ businessId: { $in: ids }, role: 'owner' }).lean().exec(),
      this.subscriptions.find({ businessId: { $in: ids } }).lean().exec(),
    ]);
    const ownerIds = owners.map((o) => o.userId);
    const users = await this.users.find({ _id: { $in: ownerIds } }).select('name email').lean().exec();
    const [products, orders, sales] = await Promise.all([
      this.products.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: '$businessId', count: { $sum: 1 } } }]).exec(),
      this.orders.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: '$businessId', count: { $sum: 1 } } }]).exec(),
      this.sales.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: '$businessId', revenue: { $sum: '$totalKobo' }, count: { $sum: 1 } } }]).exec(),
    ]);
    return businesses.map((b) => {
      const id = String(b._id);
      const owner = owners.find((o) => o.businessId === id);
      const user = users.find((u) => String(u._id) === owner?.userId);
      const sub = subs.find((s) => s.businessId === id);
      const revenue = sales.find((s) => s._id === id);
      return {
        id,
        name: b.name,
        slug: b.slug,
        category: b.category,
        ownerName: user?.name || '',
        ownerEmail: user?.email || '',
        plan: sub?.planKey || 'free',
        subscriptionStatus: sub?.status || 'none',
        published: b.storefrontPublished,
        suspended: b.isSuspended,
        products: products.find((p) => p._id === id)?.count || 0,
        orders: orders.find((o) => o._id === id)?.count || 0,
        sales: revenue?.count || 0,
        revenueNaira: (revenue?.revenue || 0) / 100,
        createdAt: b.createdAt,
      };
    });
  }

  private async paymentsCsv(query: Record<string, unknown>) {
    const filter = searchFilter(query, ['reference', 'email']);
    if (query.status && query.status !== 'all') filter.status = query.status;
    const payments = await this.payments.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean().exec();
    const businesses = await this.businesses.find({ _id: { $in: payments.map((p) => p.businessId) } }).select('name slug').lean().exec();
    return payments.map((p) => ({
      reference: p.reference,
      business: businesses.find((b) => String(b._id) === p.businessId)?.name || p.businessId,
      slug: businesses.find((b) => String(b._id) === p.businessId)?.slug || '',
      purpose: p.purpose,
      amountNaira: p.amountKobo / 100,
      status: p.status,
      email: p.email || '',
      channel: p.channel || '',
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }));
  }

  private async auditCsv(query: Record<string, unknown>) {
    const filter: Record<string, unknown> = {};
    if (query.action) filter.action = query.action;
    if (query.businessId) filter.businessId = query.businessId;
    if (query.actorId) filter.actorId = query.actorId;
    const logs = await this.auditLogs.find(filter).sort({ createdAt: -1 }).limit(MAX_ROWS).lean().exec();
    return logs.map((l) => ({
      createdAt: l.createdAt,
      action: l.action,
      actorType: l.actorType,
      actorId: l.actorId || '',
      businessId: l.businessId || '',
      entity: l.entity || '',
      entityId: l.entityId || '',
      metadata: JSON.stringify(l.metadata || {}),
    }));
  }
}

function searchFilter(query: Record<string, unknown>, fields: string[]) {
  const filter: Record<string, unknown> = {};
  if (typeof query.search === 'string' && query.search.trim()) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = fields.map((field) => ({ [field]: rx }));
  }
  return filter;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Prevent spreadsheet formula injection when an exported field starts with a control character.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
