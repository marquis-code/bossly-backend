import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Connection, Model } from 'mongoose';
import { randomToken, sha256 } from '../../common/utils/tokens';
import { makeSlug, uniqueSuffix } from '../../common/utils/slug';
import { normalizeNigerianPhone } from '../../common/utils/phone';
import type { BusinessRole, JwtPayload, PlatformRole } from '../../common/types/auth.types';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { User, UserDocument } from '../users/user.schema';
import { Business, BusinessDocument } from '../businesses/business.schema';
import { Membership, MembershipDocument } from '../memberships/membership.schema';
import { PlansService } from '../plans/plans.service';
import { MailService } from '../mail/mail.service';
import { welcomeEmail, verificationEmail, resetPasswordEmail } from '../mail/email-templates';
import { AuditService } from '../audit/audit.service';
import { AffiliatesService } from '../affiliates/affiliates.service';
import { RefreshSession, RefreshSessionDocument } from './refresh-session.schema';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  SwitchBusinessDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/auth.dto';

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

interface BusinessSummary {
  id: string;
  name: string;
  slug: string;
  role: BusinessRole;
  logoUrl: string | null;
  category: string;
  storefrontPublished: boolean;
}

export interface AuthResponse {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
    emailVerified: boolean;
    platformRole: PlatformRole | null;
  };
  businesses: BusinessSummary[];
  activeBusinessId: string | null;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(RefreshSession.name) private readonly sessions: Model<RefreshSessionDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly plans: PlansService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly affiliates: AffiliatesService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.users.findOne({ email }).lean().exec();
    if (existing) throw new ConflictException('An account with this email already exists. Try signing in.');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const phone = dto.phone ? normalizeNigerianPhone(dto.phone) : null;
    if (dto.phone && !phone) throw new BadRequestException('Enter a valid Nigerian phone number.');

    const baseSlug = makeSlug(dto.businessName);
    let slug = baseSlug;
    for (let i = 0; i < 15; i++) {
      const clash = await this.businesses.exists({ slug });
      if (!clash) break;
      slug = `${baseSlug}-${uniqueSuffix()}`;
    }
    if (await this.businesses.exists({ slug })) {
      throw new ConflictException('We could not create a unique storefront link. Please try a slightly different business name.');
    }

    let user!: UserDocument;
    let business!: BusinessDocument;
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        const createdUsers = await this.users.create(
          [
            {
              name: dto.name,
              email,
              passwordHash,
              phone,
              platformRole: null,
            },
          ],
          { session },
        );
        user = createdUsers[0];
        const createdBusinesses = await this.businesses.create(
          [
            {
              name: dto.businessName,
              slug,
              ownerId: user._id.toString(),
              category: dto.category || 'other',
              email,
              publicPhone: phone,
              whatsappNumber: phone,
              embedKey: randomToken(12),
              seoTitle: `${dto.businessName} — shop online`,
              seoDescription: `Shop from ${dto.businessName} on Ojaly.`,
            },
          ],
          { session },
        );
        business = createdBusinesses[0];
        await this.memberships.create(
          [
            {
              businessId: business._id.toString(),
              userId: user._id.toString(),
              role: 'owner',
              permissions: [],
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }

    const trialPlan = await this.plans.getTrialPlan();
    await this.plans.createTrialSubscription(
      business._id.toString(),
      trialPlan._id.toString(),
      trialPlan.key,
      trialPlan.trialDays ?? 0,
      trialPlan.trialMilestoneOrders ?? 0,
    );

    await this.affiliates.attributeRegistration(dto.referral, business._id.toString(), business.name);

    const verification = randomToken(32);
    await this.users.updateOne(
      { _id: user._id },
      {
        $set: {
          emailVerificationTokenHash: sha256(verification),
          emailVerificationExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      },
    ).exec();

    const verifyUrl = `${this.config.get<string>('appUrl')}/verify-email?token=${verification}`;
    const welcome = welcomeEmail(dto.name, dto.businessName, `${this.config.get<string>('appUrl')}/app`);
    const verificationMail = verificationEmail(dto.name, verifyUrl);
    // Deliver email verification followed by welcome email
    await this.mail.send({
      to: email,
      subject: verificationMail.subject,
      html: verificationMail.html,
      template: 'email_verification',
      businessId: business._id.toString(),
      metadata: { purpose: 'verify_email' },
    }).catch(() => undefined);

    await this.mail.send({
      to: email,
      subject: welcome.subject,
      html: welcome.html,
      template: 'welcome',
      businessId: business._id.toString(),
    }).catch(() => undefined);

    await this.audit.record({
      businessId: business._id.toString(),
      actorId: user._id.toString(),
      action: 'auth.register',
      entity: 'business',
      entityId: business._id.toString(),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.issueAuthResponse(user, business._id.toString(), 'owner', meta);
  }

  async login(dto: LoginDto, meta: RequestMeta, platformOnly = false): Promise<AuthResponse> {
    const user = await this.users
      .findOne({ email: dto.email.toLowerCase().trim() })
      .select('+passwordHash')
      .exec();
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!user.isActive) throw new ForbiddenException('This account has been disabled. Contact support.');

    const membership = await this.memberships
      .findOne({ userId: user._id.toString(), status: 'active' })
      .sort({ role: 1, createdAt: 1 })
      .exec();

    if (platformOnly) {
      if (!user.platformRole) throw new ForbiddenException('This account does not have platform access.');
      user.lastLoginAt = new Date();
      await user.save();
      return this.issueAuthResponse(user, null, null, meta);
    }

    if (!membership && !user.platformRole) {
      throw new ForbiddenException('This account is not attached to a business. Contact support.');
    }

    user.lastLoginAt = new Date();
    await user.save();
    await this.audit.record({
      businessId: membership?.businessId ?? null,
      actorId: user._id.toString(),
      action: 'auth.login',
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return this.issueAuthResponse(user, membership?.businessId ?? null, membership?.role ?? null, meta);
  }

  async refresh(dto: RefreshDto, meta: RequestMeta): Promise<AuthResponse> {
    const tokenHash = sha256(dto.refreshToken);
    const session = await this.sessions.findOne({ tokenHash }).exec();
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    const user = await this.users.findById(session.userId).exec();
    if (!user || !user.isActive) throw new UnauthorizedException('Account unavailable.');

    let businessId = session.businessId;
    let role: BusinessRole | null = null;
    if (businessId) {
      const membership = await this.memberships
        .findOne({ businessId, userId: user._id.toString(), status: 'active' })
        .lean()
        .exec();
      if (!membership) {
        if (!user.platformRole) throw new ForbiddenException('You no longer have access to this business.');
        businessId = null;
      } else {
        role = membership.role as BusinessRole;
      }
    }

    const newToken = randomToken(48);
    session.revokedAt = new Date();
    session.replacedByTokenHash = sha256(newToken);
    await session.save();
    await this.sessions.create({
      userId: user._id.toString(),
      businessId,
      tokenHash: sha256(newToken),
      expiresAt: new Date(Date.now() + this.refreshDays() * 86400000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return this.issueAuthResponse(user, businessId, role, meta, newToken);
  }

  async logout(user: AuthenticatedUser, dto: LogoutDto): Promise<{ loggedOut: true }> {
    if (dto.refreshToken) {
      await this.sessions.updateOne(
        { tokenHash: sha256(dto.refreshToken) },
        { $set: { revokedAt: new Date() } },
      ).exec();
    } else {
      await this.sessions.updateMany(
        { userId: user.id, revokedAt: null },
        { $set: { revokedAt: new Date() } },
      ).exec();
    }
    return { loggedOut: true };
  }

  async switchBusiness(user: AuthenticatedUser, dto: SwitchBusinessDto, meta: RequestMeta): Promise<AuthResponse> {
    const membership = await this.memberships
      .findOne({ businessId: dto.businessId, userId: user.id, status: 'active' })
      .exec();
    if (!membership) throw new ForbiddenException('You do not have access to this business.');
    const dbUser = await this.users.findById(user.id).exec();
    if (!dbUser) throw new UnauthorizedException('Account not found.');
    if (dto.refreshToken) {
      await this.sessions.updateOne(
        { tokenHash: sha256(dto.refreshToken) },
        { $set: { revokedAt: new Date() } },
      ).exec();
    }
    return this.issueAuthResponse(dbUser, dto.businessId, membership.role, meta);
  }

  async me(user: AuthenticatedUser): Promise<Omit<AuthResponse, 'accessToken' | 'refreshToken' | 'expiresIn'>> {
    const dbUser = await this.users.findById(user.id).exec();
    if (!dbUser) throw new UnauthorizedException('Account not found.');
    const memberships = await this.memberships.find({ userId: user.id, status: 'active' }).lean().exec();
    const businessIds = memberships.map((m) => m.businessId);
    const businesses = await this.businesses.find({ _id: { $in: businessIds } }).lean().exec();
    const summaries: BusinessSummary[] = memberships
      .map((m) => {
        const b = businesses.find((x) => x._id.toString() === m.businessId);
        if (!b) return null;
        return {
          id: b._id.toString(),
          name: b.name,
          slug: b.slug,
          role: m.role as BusinessRole,
          logoUrl: b.logoUrl,
          category: b.category,
          storefrontPublished: b.storefrontPublished,
        };
      })
      .filter((b): b is BusinessSummary => Boolean(b));
    return {
      user: {
        id: dbUser._id.toString(),
        name: dbUser.name,
        email: dbUser.email,
        phone: dbUser.phone,
        avatarUrl: dbUser.avatarUrl,
        emailVerified: Boolean(dbUser.emailVerifiedAt),
        platformRole: dbUser.platformRole,
      },
      businesses: summaries,
      activeBusinessId: user.businessId,
    };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ verified: true }> {
    const tokenHash = sha256(dto.token);
    const user = await this.users
      .findOne({ emailVerificationTokenHash: tokenHash })
      .select('+emailVerificationTokenHash +emailVerificationExpiresAt')
      .exec();
    if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This verification link is invalid or has expired. Request a new one.');
    }
    user.emailVerifiedAt = new Date();
    user.emailVerificationTokenHash = null as unknown as string;
    user.emailVerificationExpiresAt = null as unknown as Date;
    await user.save();
    return { verified: true };
  }

  async resendVerification(user: AuthenticatedUser): Promise<{ sent: true }> {
    const dbUser = await this.users.findById(user.id).exec();
    if (!dbUser) throw new UnauthorizedException('Account not found.');
    if (dbUser.emailVerifiedAt) throw new BadRequestException('Your email is already verified.');
    const token = randomToken(32);
    await this.users.updateOne(
      { _id: dbUser._id },
      {
        $set: {
          emailVerificationTokenHash: sha256(token),
          emailVerificationExpiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      },
    ).exec();
    const mail = verificationEmail(dbUser.name, `${this.config.get<string>('appUrl')}/verify-email?token=${token}`);
    await this.mail.send({ to: dbUser.email, subject: mail.subject, html: mail.html, template: 'email_verification' });
    return { sent: true };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    const user = await this.users.findOne({ email: dto.email.toLowerCase().trim() }).exec();
    if (user) {
      const token = randomToken(32);
      await this.users.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordResetTokenHash: sha256(token),
            passwordResetExpiresAt: new Date(Date.now() + 3600 * 1000),
          },
        },
      ).exec();
      const mail = resetPasswordEmail(user.name, `${this.config.get<string>('appUrl')}/reset-password?token=${token}`);
      await this.mail.send({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
        template: 'password_reset',
      });
    }
    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ reset: true }> {
    const user = await this.users
      .findOne({ passwordResetTokenHash: sha256(dto.token) })
      .select('+passwordResetTokenHash +passwordResetExpiresAt')
      .exec();
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This reset link is invalid or expired. Request a new one.');
    }
    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.passwordResetTokenHash = null as unknown as string;
    user.passwordResetExpiresAt = null as unknown as Date;
    await user.save();
    await this.sessions.updateMany({ userId: user._id.toString(), revokedAt: null }, { $set: { revokedAt: new Date() } });
    await this.audit.record({ actorId: user._id.toString(), action: 'auth.password_reset', entity: 'user', entityId: user._id.toString() });
    return { reset: true };
  }

  async changePassword(user: AuthenticatedUser, dto: ChangePasswordDto): Promise<{ changed: true }> {
    const dbUser = await this.users.findById(user.id).select('+passwordHash').exec();
    if (!dbUser) throw new UnauthorizedException('Account not found.');
    if (!(await bcrypt.compare(dto.currentPassword, dbUser.passwordHash))) {
      throw new BadRequestException('Your current password is incorrect.');
    }
    dbUser.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await dbUser.save();
    await this.sessions.updateMany(
      { userId: user.id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    ).exec();
    return { changed: true };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateProfileDto): Promise<Record<string, unknown>> {
    const update: Record<string, unknown> = {};
    if (dto.name !== undefined) update.name = dto.name;
    if (dto.phone !== undefined) {
      const phone = dto.phone ? normalizeNigerianPhone(dto.phone) : null;
      if (dto.phone && !phone) throw new BadRequestException('Enter a valid Nigerian phone number.');
      update.phone = phone;
    }
    if (dto.avatarUrl !== undefined) update.avatarUrl = dto.avatarUrl || null;
    const updated = await this.users.findByIdAndUpdate(user.id, { $set: update }, { new: true }).lean().exec();
    if (!updated) throw new UnauthorizedException('Account not found.');
    return {
      id: String(updated._id),
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      avatarUrl: updated.avatarUrl,
      emailVerified: Boolean(updated.emailVerifiedAt),
      platformRole: updated.platformRole,
    };
  }

  private async issueAuthResponse(
    user: UserDocument,
    businessId: string | null,
    role: BusinessRole | null,
    meta: RequestMeta,
    existingRefreshToken?: string,
  ): Promise<AuthResponse> {
    let resolvedBusinessId = businessId;
    let resolvedRole = role;
    if (!resolvedBusinessId) {
      const first = await this.memberships
        .findOne({ userId: user._id.toString(), status: 'active' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      if (first) {
        resolvedBusinessId = first.businessId;
        resolvedRole = first.role as BusinessRole;
      }
    }

    const payload: JwtPayload = {
      sub: user._id.toString(),
      email: user.email,
      businessId: resolvedBusinessId,
      role: resolvedRole,
      platformRole: user.platformRole,
      tokenType: 'access',
    };
    const accessTtl = this.config.get<string>('jwt.accessTtl') || '15m';
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: accessTtl as unknown as number,
    });
    const refreshToken = existingRefreshToken || randomToken(48);
    if (!existingRefreshToken) {
      const ttlDays = this.refreshDays();
      await this.sessions.create({
        userId: user._id.toString(),
        businessId: resolvedBusinessId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + ttlDays * 86400000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    }

    const memberships = await this.memberships.find({ userId: user._id.toString(), status: 'active' }).lean().exec();
    const bizIds = memberships.map((m) => m.businessId);
    const businesses = await this.businesses
      .find({ _id: { $in: bizIds } })
      .select('name slug logoUrl category storefrontPublished')
      .lean()
      .exec();
    const summaries: BusinessSummary[] = memberships
      .map((m) => {
        const b = businesses.find((x) => x._id.toString() === m.businessId);
        if (!b) return null;
        return {
          id: b._id.toString(),
          name: b.name,
          slug: b.slug,
          role: m.role as BusinessRole,
          logoUrl: b.logoUrl,
          category: b.category,
          storefrontPublished: b.storefrontPublished,
        };
      })
      .filter((b): b is BusinessSummary => Boolean(b));

    return {
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        emailVerified: Boolean(user.emailVerifiedAt),
        platformRole: user.platformRole,
      },
      businesses: summaries,
      activeBusinessId: resolvedBusinessId,
      accessToken,
      refreshToken,
      expiresIn: 900,
    };
  }

  private refreshDays(): number {
    const ttl = this.config.get<string>('jwt.refreshTtl') || '30d';
    const match = /^(\d+)([dhm])$/.exec(ttl);
    if (!match) return 30;
    const value = Number(match[1]);
    if (match[2] === 'd') return value;
    if (match[2] === 'h') return value / 24;
    return value / 1440;
  }
}
