import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import PDFDocument from 'pdfkit';
import { Sale, SaleDocument } from '../sales/sale.schema';
import { Expense, ExpenseDocument } from '../expenses/expense.schema';
import { Product, ProductDocument } from '../products/product.schema';
import { Debt, DebtDocument } from '../debts/debt.schema';
import { Customer, CustomerDocument } from '../customers/customer.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { PlansService } from '../plans/plans.service';
import { resolveDateRange, humanRangeLabel, DateRangePreset } from '../../common/utils/dates';
import { formatNaira, percentChange } from '../../common/utils/money';
import { ReportQueryDto } from './dto/report.dto';

interface PeriodTotals {
  revenueKobo: number;
  cogsKobo: number;
  expensesKobo: number;
  grossProfitKobo: number;
  profitKobo: number;
  salesCount: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Sale.name) private readonly sales: Model<SaleDocument>,
    @InjectModel(Expense.name) private readonly expenses: Model<ExpenseDocument>,
    @InjectModel(Product.name) private readonly products: Model<ProductDocument>,
    @InjectModel(Debt.name) private readonly debts: Model<DebtDocument>,
    @InjectModel(Customer.name) private readonly customers: Model<CustomerDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    private readonly plans: PlansService,
  ) {}

  async dashboard(businessId: string, query: ReportQueryDto) {
    const preset = (query.range || 'month') as DateRangePreset;
    if (preset === 'custom' && (!query.from || !query.to)) {
      throw new BadRequestException('Choose a start and end date.');
    }
    const range = resolveDateRange(preset, query.from, query.to);
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new BadRequestException('Business not found.');

    const [totals, previous, expensesByCategory, chart, bestSellers, debts, stock, customersCount, recentSales, newCustomers] =
      await Promise.all([
        this.periodTotals(businessId, range.from, range.to),
        this.periodTotals(businessId, range.previousFrom, range.previousTo),
        this.expensesByCategory(businessId, range.from, range.to),
        this.chart(businessId, range.from, range.to),
        this.bestSellers(businessId, range.from, range.to),
        this.debtTotals(businessId),
        this.stockTotals(businessId),
        this.customers.countDocuments({ businessId }).exec(),
        this.sales.find({ businessId }).sort({ soldAt: -1 }).limit(5).lean().exec(),
        this.customers.countDocuments({ businessId, createdAt: { $gte: range.from, $lte: range.to } }).exec(),
      ]);

    const slowMovers = await this.slowMovers(businessId);
    const margin = totals.revenueKobo > 0 ? Math.round((totals.profitKobo / totals.revenueKobo) * 1000) / 10 : 0;
    const planInfo = await this.plans.getPlanForBusiness(businessId);
    const comparison = {
      revenuePercent: percentChange(totals.revenueKobo, previous.revenueKobo),
      profitPercent: percentChange(totals.profitKobo, previous.profitKobo),
      expensesPercent: percentChange(totals.expensesKobo, previous.expensesKobo),
      salesPercent: percentChange(totals.salesCount, previous.salesCount),
    };
    return {
      range: {
        preset,
        from: range.from,
        to: range.to,
        label: range.label,
        human: humanRangeLabel(range),
        previousFrom: range.previousFrom,
        previousTo: range.previousTo,
      },
      summary: {
        ...totals,
        profitMargin: margin,
        comparison,
      },
      previousSummary: previous,
      expensesByCategory,
      chart,
      bestSellers,
      slowMovers,
      debts,
      stock,
      customers: { total: customersCount, new: newCustomers },
      recentSales,
      insights: this.buildInsights({ totals, previous, comparison, debts, stock, bestSellers, businessName: business.name, rangeLabel: range.label }),
      capabilities: {
        advancedReports: planInfo.entitlements.advancedReports,
        csvExport: planInfo.entitlements.csvExport,
        pdfExport: planInfo.entitlements.pdfExport,
        planName: planInfo.plan.name,
      },
    };
  }

  async exportCsv(businessId: string, query: ReportQueryDto): Promise<{ filename: string; csv: string }> {
    await this.plans.assertFeature(businessId, 'csvExport');
    const data = await this.exportData(businessId, query);
    const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push('OJALY BUSINESS REPORT');
    lines.push(`${escape(data.business.name)},${escape(data.rangeLabel)}`);
    lines.push('');
    lines.push('SUMMARY');
    lines.push('Metric,Amount (NGN)');
    lines.push(`Revenue,${(data.summary.revenueKobo / 100).toFixed(2)}`);
    lines.push(`Cost of goods,${(data.summary.cogsKobo / 100).toFixed(2)}`);
    lines.push(`Expenses,${(data.summary.expensesKobo / 100).toFixed(2)}`);
    lines.push(`Gross profit,${(data.summary.grossProfitKobo / 100).toFixed(2)}`);
    lines.push(`Net profit,${(data.summary.profitKobo / 100).toFixed(2)}`);
    lines.push(`Sales count,${data.summary.salesCount}`);
    lines.push('');
    lines.push('SALES');
    lines.push('Sale number,Date,Customer,Items,Revenue (NGN),Cost (NGN),Profit (NGN),Payment status');
    for (const s of data.sales) {
      lines.push([
        s.saleNumber,
        new Date(s.soldAt).toISOString(),
        s.customerName,
        s.items.map((i) => `${i.quantity}x ${i.name}`).join(' | '),
        (s.totalKobo / 100).toFixed(2),
        (s.costKobo / 100).toFixed(2),
        (s.grossProfitKobo / 100).toFixed(2),
        s.paymentStatus,
      ].map(escape).join(','));
    }
    lines.push('');
    lines.push('EXPENSES');
    lines.push('Date,Category,Description,Amount (NGN)');
    for (const e of data.expenses) {
      lines.push([new Date(e.date).toISOString().slice(0, 10), e.category, e.notes, (e.amountKobo / 100).toFixed(2)].map(escape).join(','));
    }
    lines.push('');
    lines.push('BEST SELLERS');
    lines.push('Product,Units sold,Revenue (NGN)');
    for (const b of data.bestSellers) {
      lines.push([b.name, b.quantity, (b.revenueKobo / 100).toFixed(2)].map(escape).join(','));
    }
    return { filename: `ojaly-report-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join('\n') };
  }

  async exportPdf(businessId: string, query: ReportQueryDto): Promise<Buffer> {
    await this.plans.assertFeature(businessId, 'pdfExport');
    const data = await this.exportData(businessId, query);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const ink = '#06231A';
      const orange = '#FF5A1F';
      const muted = '#5F6B64';
      doc.rect(0, 0, doc.page.width, 112).fill(ink);
      doc.rect(48, 34, 15, 15).fill(orange);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(25).text('ojaly', 70, 30);
      doc.fillColor('#A8C0B4').font('Helvetica').fontSize(9).text('BUSINESS REPORT', 70, 60, { characterSpacing: 1 });
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text(data.business.name, 48, 36, { width: 500, align: 'right' });
      doc.fillColor('#A8C0B4').font('Helvetica').fontSize(9).text(data.rangeLabel, 48, 58, { width: 500, align: 'right' });

      doc.y = 145;
      const cards = [
        ['Revenue', formatNaira(data.summary.revenueKobo), ink],
        ['Net profit', formatNaira(data.summary.profitKobo), data.summary.profitKobo >= 0 ? '#0B6B45' : '#C92A2A'],
        ['Expenses', formatNaira(data.summary.expensesKobo), ink],
        ['Sales', String(data.summary.salesCount), ink],
      ];
      cards.forEach((card, i) => {
        const x = 48 + (i % 2) * 255;
        const y = 145 + Math.floor(i / 2) * 76;
        doc.roundedRect(x, y, 240, 64, 10).fill('#F7F2E8');
        doc.fillColor(muted).font('Helvetica').fontSize(8).text(card[0].toUpperCase(), x + 14, y + 12);
        doc.fillColor(card[2]).font('Helvetica-Bold').fontSize(19).text(card[1], x + 14, y + 27);
      });

      doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text('What happened', 48, 325);
      doc.font('Helvetica').fontSize(10).fillColor(ink);
      let y = 348;
      for (const insight of data.insights) {
        doc.fillColor(orange).text('•', 48, y);
        doc.fillColor(ink).text(insight, 60, y, { width: 480 });
        y = doc.y + 6;
      }

      y += 12;
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text('Best sellers', 48, y);
      y += 22;
      doc.fillColor(muted).font('Helvetica-Bold').fontSize(8).text('PRODUCT', 48, y);
      doc.text('UNITS', 400, y, { width: 50, align: 'right' });
      doc.text('REVENUE', 460, y, { width: 82, align: 'right' });
      y += 14;
      for (const b of data.bestSellers.slice(0, 6)) {
        if (y > 720) break;
        doc.fillColor(ink).font('Helvetica').fontSize(10).text(b.name, 48, y, { width: 330 });
        doc.text(String(b.quantity), 400, y, { width: 50, align: 'right' });
        doc.text(formatNaira(b.revenueKobo), 460, y, { width: 82, align: 'right' });
        y += 19;
      }

      y += 18;
      doc.fillColor(ink).font('Helvetica-Bold').fontSize(13).text('Expenses', 48, y);
      y += 22;
      for (const e of data.expenses.slice(0, 8)) {
        if (y > 730) break;
        doc.fillColor(muted).font('Helvetica').fontSize(9).text(new Date(e.date).toISOString().slice(0, 10), 48, y, { width: 80 });
        doc.fillColor(ink).font('Helvetica').fontSize(9).text(e.notes || e.category, 130, y, { width: 330 });
        doc.text(formatNaira(e.amountKobo), 460, y, { width: 82, align: 'right' });
        y += 17;
      }

      doc.fillColor(muted).font('Helvetica').fontSize(8).text('Made with Ojaly · ojaly.org', 48, 790, { width: 500, align: 'center' });
      doc.end();
    });
  }

  private async periodTotals(businessId: string, from: Date, to: Date): Promise<PeriodTotals> {
    const [sales, expenses] = await Promise.all([
      this.sales.aggregate([
        { $match: { businessId, soldAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            revenueKobo: { $sum: '$totalKobo' },
            cogsKobo: { $sum: '$costKobo' },
            grossProfitKobo: { $sum: '$grossProfitKobo' },
            salesCount: { $sum: 1 },
          },
        },
      ]).exec(),
      this.expenses.aggregate([
        { $match: { businessId, date: { $gte: from, $lte: to } } },
        { $group: { _id: null, total: { $sum: '$amountKobo' } } },
      ]).exec(),
    ]);
    const s = sales[0] || { revenueKobo: 0, cogsKobo: 0, grossProfitKobo: 0, salesCount: 0 };
    const expensesKobo = expenses[0]?.total || 0;
    return {
      revenueKobo: s.revenueKobo,
      cogsKobo: s.cogsKobo,
      expensesKobo,
      grossProfitKobo: s.grossProfitKobo,
      profitKobo: s.grossProfitKobo - expensesKobo,
      salesCount: s.salesCount,
    };
  }

  private async expensesByCategory(businessId: string, from: Date, to: Date) {
    const result = await this.expenses.aggregate([
      { $match: { businessId, date: { $gte: from, $lte: to } } },
      { $group: { _id: '$category', totalKobo: { $sum: '$amountKobo' }, count: { $sum: 1 } } },
      { $sort: { totalKobo: -1 } },
    ]).exec();
    return result.map((r: { _id: string; totalKobo: number; count: number }) => ({ category: r._id, totalKobo: r.totalKobo, count: r.count }));
  }

  private async chart(businessId: string, from: Date, to: Date) {
    const result = await this.sales.aggregate([
      { $match: { businessId, soldAt: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$soldAt', timezone: 'Africa/Lagos' } },
          revenueKobo: { $sum: '$totalKobo' },
          profitKobo: { $sum: '$grossProfitKobo' },
          sales: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();
    const expenseChart = await this.expenses.aggregate([
      { $match: { businessId, date: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: 'Africa/Lagos' } },
          expensesKobo: { $sum: '$amountKobo' },
        },
      },
    ]).exec();
    const map = new Map<string, { date: string; revenueKobo: number; profitKobo: number; expensesKobo: number; sales: number }>();
    for (const r of result) map.set(r._id, { date: r._id, revenueKobo: r.revenueKobo, profitKobo: r.profitKobo, expensesKobo: 0, sales: r.sales });
    for (const e of expenseChart) {
      const entry = map.get(e._id) || { date: e._id, revenueKobo: 0, profitKobo: 0, expensesKobo: 0, sales: 0 };
      entry.expensesKobo = e.expensesKobo;
      entry.profitKobo -= e.expensesKobo;
      map.set(e._id, entry);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private async bestSellers(businessId: string, from: Date, to: Date) {
    const result = await this.sales.aggregate([
      { $match: { businessId, soldAt: { $gte: from, $lte: to } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.name' },
          quantity: { $sum: '$items.quantity' },
          revenueKobo: { $sum: '$items.lineTotalKobo' },
          costKobo: { $sum: '$items.lineCostKobo' },
        },
      },
      { $sort: { quantity: -1, revenueKobo: -1 } },
      { $limit: 5 },
    ]).exec();
    return result.map((r: { _id: string; name: string; quantity: number; revenueKobo: number; costKobo: number }) => ({
      productId: r._id,
      name: r.name,
      quantity: r.quantity,
      revenueKobo: r.revenueKobo,
      profitKobo: r.revenueKobo - r.costKobo,
    }));
  }

  private async slowMovers(businessId: string) {
    const since = new Date(Date.now() - 30 * 86400000);
    const sold = await this.sales.aggregate([
      { $match: { businessId, soldAt: { $gte: since } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.productId', quantity: { $sum: '$items.quantity' } } },
    ]).exec();
    const soldMap = new Map(sold.map((s: { _id: string; quantity: number }) => [s._id, s.quantity]));
    const products = await this.products.find({ businessId, isActive: true }).select('name quantity priceKobo images category').lean().exec();
    return products
      .map((p) => ({
        productId: p._id.toString(),
        name: p.name,
        stock: p.quantity,
        priceKobo: p.priceKobo,
        imageUrl: p.images[0] || null,
        unitsSold: soldMap.get(p._id.toString()) || 0,
      }))
      .sort((a, b) => a.unitsSold - b.unitsSold || b.stock - a.stock)
      .slice(0, 5);
  }

  private async debtTotals(businessId: string) {
    const result = await this.debts.aggregate([
      { $match: { businessId, balanceKobo: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          outstandingKobo: { $sum: '$balanceKobo' },
          count: { $sum: 1 },
          overdueKobo: { $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, '$balanceKobo', 0] } },
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

  private async stockTotals(businessId: string) {
    const products = await this.products.find({ businessId, isActive: true }).select('variants').lean().exec();
    let units = 0;
    let costValueKobo = 0;
    let retailValueKobo = 0;
    let lowStock = 0;
    for (const p of products) {
      for (const v of p.variants) {
        units += v.quantity;
        costValueKobo += v.quantity * v.costPriceKobo;
        retailValueKobo += v.quantity * v.priceKobo;
        if (v.quantity <= v.lowStockThreshold) lowStock++;
      }
    }
    return { units, costValueKobo, retailValueKobo, potentialProfitKobo: retailValueKobo - costValueKobo, lowStock, products: products.length };
  }

  private buildInsights(input: {
    totals: PeriodTotals;
    previous: PeriodTotals;
    comparison: { profitPercent: number; revenuePercent: number };
    debts: { outstandingKobo: number; count: number; overdueCount: number };
    stock: { lowStock: number };
    bestSellers: { name: string; quantity: number }[];
    businessName: string;
    rangeLabel: string;
  }): string[] {
    const { totals, previous, comparison, debts, stock, bestSellers, rangeLabel } = input;
    const insights: string[] = [];
    if (totals.salesCount === 0) {
      insights.push(`No sales recorded ${rangeLabel === 'today' ? 'today' : `for ${rangeLabel}`} yet. Record one as soon as money enters your hand — that's how the truth starts.`);
    } else {
      const direction = comparison.profitPercent > 0 ? 'up' : comparison.profitPercent < 0 ? 'down' : 'flat';
      insights.push(
        `You made ${formatNaira(totals.profitKobo)} profit ${rangeLabel}, ${direction === 'flat' ? 'about the same as' : `${direction} ${Math.abs(comparison.profitPercent)}% from`} the previous period.`,
      );
      if (bestSellers[0]) {
        insights.push(`${bestSellers[0].name} is your best seller — ${bestSellers[0].quantity} sold. Keep it in stock.`);
      }
    }
    if (previous.profitKobo === 0 && totals.profitKobo > 0) {
      insights.push('This is your first profitable period on record. Save this report.');
    }
    if (debts.outstandingKobo > 0) {
      insights.push(
        `${formatNaira(debts.outstandingKobo)} is sitting in debts across ${debts.count} customer${debts.count === 1 ? '' : 's'}${debts.overdueCount ? `, and ${debts.overdueCount} is overdue` : ''}. Send a reminder today.`,
      );
    }
    if (stock.lowStock > 0) {
      insights.push(`${stock.lowStock} item${stock.lowStock === 1 ? '' : 's'} ${stock.lowStock === 1 ? 'is' : 'are'} at or below your low-stock line. Restock before it costs you a sale.`);
    }
    if (totals.revenueKobo > 0) {
      const margin = Math.round((totals.profitKobo / totals.revenueKobo) * 100);
      insights.push(`Your profit margin is ${margin}%. ${margin < 20 ? 'Look at your costs — there may be money hiding there.' : 'That is healthy. Keep your prices and costs where they are.'}`);
    }
    return insights;
  }

  private async exportData(businessId: string, query: ReportQueryDto) {
    const preset = (query.range || 'month') as DateRangePreset;
    const range = resolveDateRange(preset, query.from, query.to);
    const business = await this.businesses.findById(businessId).lean().exec();
    if (!business) throw new BadRequestException('Business not found.');
    const [summary, sales, expenses, bestSellers] = await Promise.all([
      this.periodTotals(businessId, range.from, range.to),
      this.sales.find({ businessId, soldAt: { $gte: range.from, $lte: range.to } }).sort({ soldAt: 1 }).lean().exec(),
      this.expenses.find({ businessId, date: { $gte: range.from, $lte: range.to } }).sort({ date: 1 }).lean().exec(),
      this.bestSellers(businessId, range.from, range.to),
    ]);
    return {
      business,
      rangeLabel: humanRangeLabel(range),
      summary,
      sales,
      expenses,
      bestSellers,
      insights: [
        `Revenue: ${formatNaira(summary.revenueKobo)} from ${summary.salesCount} sale${summary.salesCount === 1 ? '' : 's'}.`,
        `Net profit: ${formatNaira(summary.profitKobo)} after ${formatNaira(summary.expensesKobo)} in expenses.`,
        `Cost of goods sold: ${formatNaira(summary.cogsKobo)}.`,
        `Generated by Ojaly on ${new Date().toLocaleDateString('en-NG')}.`,
      ],
    };
  }
}
