import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request } from 'express';
import { SKIP_TENANT_KEY } from '../decorators/skip-tenant.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Membership, MembershipDocument } from '../../modules/memberships/membership.schema';
import { Business, BusinessDocument } from '../../modules/businesses/business.schema';
import type { AuthenticatedUser, BusinessRole } from '../types/auth.types';
import { ALL_PERMISSIONS } from '../constants/permissions';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Membership.name) private readonly memberships: Model<MembershipDocument>,
    @InjectModel(Business.name) private readonly businesses: Model<BusinessDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip =
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]) ||
      this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [context.getHandler(), context.getClass()]);
    if (skip) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser; businessId?: string }>();
    const user = req.user;
    if (!user?.businessId) {
      throw new ForbiddenException('Select a business to continue.');
    }
    const membership = await this.memberships
      .findOne({ businessId: user.businessId, userId: user.id, status: 'active' })
      .lean()
      .exec();
    if (!membership) {
      throw new ForbiddenException('You do not have access to this business.');
    }
    const business = await this.businesses.findOne({ _id: user.businessId, isSuspended: false }).lean().exec();
    if (!business) {
      throw new ForbiddenException('This business is suspended. Contact Ojaly support.');
    }
    const role = membership.role as BusinessRole;
    user.role = role;
    user.permissions = role === 'owner' ? ALL_PERMISSIONS : membership.permissions;
    req.businessId = user.businessId;
    return true;
  }
}
