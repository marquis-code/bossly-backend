import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { MailService } from '../mail/mail.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { ApplyCampusDto } from './campus.dto';
import { CampusApplication, CampusApplicationDocument, CampusApplicationStatus, CampusPayout, CampusPayoutDocument } from './campus.schema';
import { campusByCode, LAGOS_CAMPUSES } from './campus.constants';

@Injectable()
export class CampusService {
  constructor(
    @InjectModel(CampusApplication.name) private readonly applicationsModel: Model<CampusApplicationDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(CampusPayout.name) private readonly payoutsModel: Model<CampusPayoutDocument>,
    private readonly mail: MailService,
  ) {}

  async overview() {
    const [businessRows, applicationRows] = await Promise.all([
      this.businesses.aggregate([
        { $match: { campusCode: { $in: LAGOS_CAMPUSES.map((campus) => campus.code) } } },
        { $group: { _id: '$campusCode', signups: { $sum: 1 }, activated: { $sum: { $cond: [{ $ne: ['$firstSaleAt', null] }, 1, 0] } } } },
      ]).exec() as Promise<{ _id: string; signups: number; activated: number }[]>,
      this.applicationsModel.aggregate([
        { $match: { campusCode: { $in: LAGOS_CAMPUSES.map((campus) => campus.code) } } },
        { $group: { _id: { code: '$campusCode', status: '$status' }, count: { $sum: 1 } } },
      ]).exec() as Promise<{ _id: { code: string; status: string }; count: number }[]>,
    ]);
    const campuses = LAGOS_CAMPUSES.map((campus) => {
      const business = businessRows.find((row) => row._id === campus.code);
      const apps = applicationRows.filter((row) => row._id.code === campus.code);
      return {
        ...campus,
        signups: business?.signups || 0,
        activated: business?.activated || 0,
        ambassadors: apps.find((row) => row._id.status === 'approved')?.count || 0,
        applications: apps.find((row) => row._id.status === 'pending')?.count || 0,
      };
    });
    return {
      city: 'Lagos',
      headline: 'Bring Ojaly to your campus.',
      campuses,
      leaderboard: [...campuses].sort((a, b) => (b.activated * 10 + b.signups) - (a.activated * 10 + a.signups)),
    };
  }

  async apply(dto: ApplyCampusDto) {
    const campus = campusByCode(dto.campusCode);
    if (!campus) throw new BadRequestException('Choose a campus.');
    const phone = normalizeNigerianPhone(dto.phone);
    if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
    const existing = await this.applicationsModel.findOne({ phone, campusCode: campus.code, status: { $in: ['pending', 'approved'] } }).lean().exec();
    if (existing) return { application: this.view(existing), already: true };
    const application = await this.applicationsModel.create({
      name: sanitizeText(dto.name, 100),
      phone,
      email: dto.email || null,
      campusCode: campus.code,
      campusName: campus.name,
      year: sanitizeText(dto.year, 40),
      socials: sanitizeText(dto.socials, 300),
      why: sanitizeText(dto.why, 1000),
    });
    await this.mail.send({
      to: 'hello@ojaly.org',
      subject: `Campus ambassador application · ${campus.shortName}`,
      html: `<p><strong>${application.name}</strong> applied for ${campus.name}.</p><p>Phone: ${application.phone}<br>Email: ${application.email || '—'}<br>Year: ${application.year || '—'}<br>Socials: ${application.socials || '—'}</p><p>${application.why || ''}</p>`,
      template: 'campus_application',
    }).catch(() => undefined);
    return { application: this.view(application) };
  }

  async applications(status?: string) {
    const filter: Record<string, unknown> = {};
    if (status && status !== 'all') filter.status = status;
    const items = await this.applicationsModel.find(filter).sort({ createdAt: -1 }).limit(200).lean().exec();
    const codes = items.map((item) => item.ambassadorCode).filter(Boolean) as string[];
    const businessRows = codes.length ? await this.businesses.aggregate([
      { $match: { campusAmbassadorCode: { $in: codes } } },
      { $group: { _id: '$campusAmbassadorCode', signups: { $sum: 1 }, activated: { $sum: { $cond: [{ $ne: ['$firstSaleAt', null] }, 1, 0] } } } },
    ]).exec() as { _id: string; signups: number; activated: number }[] : [];
    const views = [];
    for (const item of items) {
      const stats = businessRows.find((row) => row._id === item.ambassadorCode);
      const activated = stats?.activated || 0;
      const earned = activated * (item.commissionKobo || 1000);
      views.push({ ...this.view(item), signups: stats?.signups || 0, activated, earnedKobo: earned, owedKobo: Math.max(0, earned - (item.totalPaidKobo || 0)) });
    }
    return views;
  }

  async payouts(applicationId?: string) {
    const filter: Record<string, unknown> = {};
    if (applicationId) filter.applicationId = applicationId;
    const items = await this.payoutsModel.find(filter).sort({ createdAt: -1 }).limit(300).lean().exec();
    return items.map((item) => ({
      id: String(item._id), applicationId: item.applicationId, ambassadorCode: item.ambassadorCode,
      ambassadorName: item.ambassadorName, campusCode: item.campusCode, amountKobo: item.amountKobo,
      status: item.status, reference: item.reference, note: item.note, paidAt: item.paidAt, createdAt: item.createdAt,
    }));
  }

  async createPayout(applicationId: string, amountKobo: number, note = '') {
    const application = await this.applicationsModel.findById(applicationId).lean().exec();
    if (!application) throw new NotFoundException('Application not found.');
    if (application.status !== 'approved' || !application.ambassadorCode) throw new BadRequestException('Approve the ambassador before recording payouts.');
    if (amountKobo < 100) throw new BadRequestException('Payout must be at least ₦1.');
    const payout = await this.payoutsModel.create({
      applicationId, ambassadorCode: application.ambassadorCode, ambassadorName: application.name,
      campusCode: application.campusCode, amountKobo, note: sanitizeText(note, 300), status: 'pending',
    });
    return this.payoutView(payout);
  }

  async updatePayout(id: string, status: 'pending' | 'paid' | 'cancelled', reference?: string) {
    const payout = await this.payoutsModel.findById(id).exec();
    if (!payout) throw new NotFoundException('Payout not found.');
    const wasPaid = payout.status === 'paid';
    payout.status = status;
    if (reference) payout.reference = reference;
    if (status === 'paid') payout.paidAt = new Date();
    await payout.save();
    if (status === 'paid' && !wasPaid) {
      await this.applicationsModel.updateOne({ _id: payout.applicationId }, { $inc: { totalPaidKobo: payout.amountKobo } }).exec();
    }
    return this.payoutView(payout);
  }

  async setStatus(id: string, status: CampusApplicationStatus) {
    const application = await this.applicationsModel.findById(id).exec();
    if (!application) throw new NotFoundException('Application not found.');
    application.status = status;
    if (status === 'approved' && !application.ambassadorCode) {
      let code = `${application.campusCode}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      while (await this.applicationsModel.exists({ ambassadorCode: code })) code = `${application.campusCode}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      application.ambassadorCode = code;
    }
    await application.save();
    return this.view(application);
  }

  private payoutView(p: CampusPayout | (CampusPayout & { _id: unknown })) {
    const payout = p as CampusPayout & { _id: unknown };
    return {
      id: String(payout._id), applicationId: payout.applicationId, ambassadorCode: payout.ambassadorCode,
      ambassadorName: payout.ambassadorName, campusCode: payout.campusCode, amountKobo: payout.amountKobo,
      status: payout.status, reference: payout.reference, note: payout.note, paidAt: payout.paidAt, createdAt: payout.createdAt,
    };
  }

  private view(application: CampusApplication | (CampusApplication & { _id: unknown })) {
    const a = application as CampusApplication & { _id: unknown };
    return {
      id: String(a._id), name: a.name, phone: a.phone, email: a.email,
      campusCode: a.campusCode, campusName: a.campusName, year: a.year,
      socials: a.socials, why: a.why, status: a.status, createdAt: a.createdAt,
      ambassadorCode: a.ambassadorCode, commissionKobo: a.commissionKobo || 1000, totalPaidKobo: a.totalPaidKobo || 0,
    };
  }
}
