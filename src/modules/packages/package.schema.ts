import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type ServicePackageDocument = HydratedDocument<ServicePackage>;

@Schema(schemaOptions('service_packages'))
export class ServicePackage {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, trim: true })
  name: string;

  @Prop({ type: String, default: '' })
  description: string;

  @Prop({ type: String, required: true, index: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: Number, required: true, min: 1 })
  sessions: number;

  @Prop({ type: Number, required: true })
  priceKobo: number;

  @Prop({ type: Number, default: 30, min: 1 })
  validityDays: number;

  @Prop({ type: Boolean, default: false })
  isMembership: boolean;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: true })
  isPublic: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder: number;
}

export const ServicePackageSchema = SchemaFactory.createForClass(ServicePackage);
ServicePackageSchema.index({ businessId: 1, isActive: 1, sortOrder: 1 });

export type PackagePurchaseDocument = HydratedDocument<PackagePurchase>;
export type PackagePurchaseStatus = 'pending' | 'active' | 'exhausted' | 'expired' | 'cancelled';
export type PackagePaymentStatus = 'unpaid' | 'paid' | 'refunded';

@Schema(schemaOptions('package_purchases'))
export class PackagePurchase {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, index: true })
  packageId: string;

  @Prop({ type: String, required: true })
  packageName: string;

  @Prop({ type: String, required: true, index: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: String, default: null, index: true })
  customerId: string | null;

  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: String, required: true, index: true })
  customerPhone: string;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: Number, required: true })
  sessionsTotal: number;

  @Prop({ type: Number, required: true })
  sessionsRemaining: number;

  @Prop({ type: Number, required: true })
  priceKobo: number;

  @Prop({ type: Number, default: 0 })
  amountPaidKobo: number;

  @Prop({ type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid', index: true })
  paymentStatus: PackagePaymentStatus;

  @Prop({ type: String, default: null })
  paymentReference: string | null;

  @Prop({ type: String, default: null })
  saleId: string | null;

  @Prop({ type: String, enum: ['pending', 'active', 'exhausted', 'expired', 'cancelled'], default: 'pending', index: true })
  status: PackagePurchaseStatus;

  @Prop({ type: String, required: true, unique: true, index: true })
  publicToken: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  redemptionCode: string;

  @Prop({ type: Date, default: null })
  purchasedAt: Date | null;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: String, default: null })
  createdBy: string | null;
}

export const PackagePurchaseSchema = SchemaFactory.createForClass(PackagePurchase);
PackagePurchaseSchema.index({ businessId: 1, status: 1, expiresAt: 1 });
PackagePurchaseSchema.index({ businessId: 1, customerPhone: 1, status: 1 });
