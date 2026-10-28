import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { MailService } from '../mail/mail.service';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import { sanitizeText } from '../../common/utils/sanitize';
import { ApplyCampusDto } from './campus.dto';
import { CampusApplication, CampusApplicationDocument, CampusApplicationStatus } from './campus.schema';
import { campusByCode, LAGOS_CAMPUSES } from './campus.constants';

@Injectable()
export class CampusService {
  constructor(
    @InjectModel(CampusApplication.name) private readonly applicationsModel: Model<CampusApplicationDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
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
    return items.map((item) => this.view(item));
  }

  async setStatus(id: string, status: CampusApplicationStatus) {
    const application = await this.applicationsModel.findByIdAndUpdate(id, { $set: { status } }, { new: true }).lean().exec();
    if (!application) throw new NotFoundException('Application not found.');
    return this.view(application);
  }

  private view(application: CampusApplication | (CampusApplication & { _id: unknown })) {
    const a = application as CampusApplication & { _id: unknown };
    return {
      id: String(a._id), name: a.name, phone: a.phone, email: a.email,
      campusCode: a.campusCode, campusName: a.campusName, year: a.year,
      socials: a.socials, why: a.why, status: a.status, createdAt: a.createdAt,
    };
  }
}
