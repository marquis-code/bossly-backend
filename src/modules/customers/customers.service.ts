import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Customer, CustomerDocument } from './customer.schema';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Order, OrderDocument } from '../orders/order.schema';
import { Booking, BookingDocument } from '../bookings/booking.schema';
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './dto/customer.dto';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Order.name) private readonly orders: Model<OrderDocument>,
    @InjectModel(Booking.name) private readonly bookings: Model<BookingDocument>,
  ) {}

  normalizePhone(phone: string): string {
    const normalized = normalizeNigerianPhone(phone);
    if (!normalized) throw new BadRequestException('Enter a valid Nigerian phone number.');
    return normalized;
  }

  async create(businessId: string, dto: CreateCustomerDto) {
    const phone = this.normalizePhone(dto.phone);
    const existing = await this.customers.findOne({ businessId, phone }).lean().exec();
    if (existing) throw new ConflictException('A customer with this phone number already exists.');
    return this.customers.create({
      businessId,
      name: sanitizeText(dto.name, 100),
      phone,
      email: dto.email || null,
      address: sanitizeText(dto.address, 300),
      notes: sanitizeText(dto.notes, 1000),
      tags: (dto.tags || []).map((t) => sanitizeText(t, 30)),
    });
  }

  async findOrCreate(
    businessId: string,
    input: { name: string; phone: string; email?: string | null; address?: string | null },
  ): Promise<CustomerDocument> {
    const phone = this.normalizePhone(input.phone);
    let customer = await this.customers.findOne({ businessId, phone }).exec();
    if (!customer) {
      customer = await this.customers.create({
        businessId,
        name: sanitizeText(input.name, 100) || 'Customer',
        phone,
        email: input.email || null,
        address: sanitizeText(input.address, 300),
      });
    } else {
      if (input.name && (!customer.name || customer.name === 'Customer')) customer.name = sanitizeText(input.name, 100);
      if (input.email && !customer.email) customer.email = input.email;
      if (input.address && !customer.address) customer.address = sanitizeText(input.address, 300);
      await customer.save();
    }
    return customer;
  }

  async list(businessId: string, query: CustomerQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const filter: FilterQuery<CustomerDocument> = { businessId };
    if (query.filter === 'owing') filter.outstandingKobo = { $gt: 0 };
    if (query.filter === 'paid') filter.outstandingKobo = { $lte: 0 };
    if (query.filter === 'inactive') filter.isActive = false;
    if (query.search) {
      const rx = new RegExp(this.escapeRegex(query.search), 'i');
      filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { tags: rx }];
    }
    const [items, total, owing, totalOutstanding] = await Promise.all([
      this.customers.find(filter).sort({ outstandingKobo: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean().exec(),
      this.customers.countDocuments(filter).exec(),
      this.customers.countDocuments({ businessId, outstandingKobo: { $gt: 0 } }).exec(),
      this.customers.aggregate([
        { $match: { businessId, outstandingKobo: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$outstandingKobo' } } },
      ]).exec(),
    ]);
    return {
      items,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
        owing,
        totalOutstandingKobo: totalOutstanding[0]?.total || 0,
      },
    };
  }

  async findOne(businessId: string, customerId: string) {
    const customer = await this.customers.findOne({ _id: customerId, businessId }).lean().exec();
    if (!customer) throw new NotFoundException('Customer not found.');
    const [sales, debts, orders, bookings] = await Promise.all([
      this.sales.find({ businessId, customerId }).sort({ soldAt: -1 }).limit(50).lean().exec(),
      this.debts.find({ businessId, customerId }).sort({ createdAt: -1 }).limit(50).lean().exec(),
      this.orders.find({ businessId, customerId }).sort({ createdAt: -1 }).limit(20).lean().exec(),
      this.bookings.find({ businessId, customerId }).sort({ startAt: -1 }).limit(50).lean().exec(),
    ]);
    return { customer, sales, debts, orders, bookings };
  }

  async update(businessId: string, customerId: string, dto: UpdateCustomerDto) {
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = sanitizeText(dto.name, 100);
    if (dto.phone !== undefined) {
      const phone = this.normalizePhone(dto.phone);
      const clash = await this.customers.findOne({ businessId, phone, _id: { $ne: customerId } }).lean().exec();
      if (clash) throw new ConflictException('Another customer already uses this phone number.');
      update.phone = phone;
    }
    if (dto.email !== undefined) update.email = dto.email;
    if (dto.address !== undefined) update.address = sanitizeText(dto.address, 300);
    if (dto.notes !== undefined) update.notes = sanitizeText(dto.notes, 1000);
    if (dto.tags !== undefined) update.tags = dto.tags.map((t) => sanitizeText(t, 30));
    const updated = await this.customers.findOneAndUpdate(
      { _id: customerId, businessId },
      { $set: update },
      { new: true },
    ).exec();
    if (!updated) throw new NotFoundException('Customer not found.');
    return updated;
  }

  async remove(businessId: string, customerId: string) {
    const owing = await this.debts.countDocuments({ businessId, customerId, balanceKobo: { $gt: 0 } }).exec();
    if (owing > 0) throw new BadRequestException('Settle this customer’s debts before removing them.');
    await this.customers.updateOne({ _id: customerId, businessId }, { $set: { isActive: false } }).exec();
    return { removed: true };
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
