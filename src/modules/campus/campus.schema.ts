import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type CampusApplicationDocument = HydratedDocument<CampusApplication>;
export type CampusApplicationStatus = 'pending' | 'approved' | 'rejected';

@Schema(schemaOptions('campus_applications'))
export class CampusApplication {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  phone: string;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, required: true, index: true })
  campusCode: string;

  @Prop({ type: String, required: true })
  campusName: string;

  @Prop({ type: String, default: '' })
  year: string;

  @Prop({ type: String, default: '' })
  socials: string;

  @Prop({ type: String, default: '' })
  why: string;

  @Prop({ type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true })
  status: CampusApplicationStatus;

  @Prop({ type: String, default: null })
  ambassadorCode: string | null;

  @Prop({ type: Number, default: 1000 })
  commissionKobo: number;

  @Prop({ type: Number, default: 0 })
  totalPaidKobo: number;
}

export const CampusApplicationSchema = SchemaFactory.createForClass(CampusApplication);
CampusApplicationSchema.index({ campusCode: 1, createdAt: -1 });


export type CampusPayoutDocument = HydratedDocument<CampusPayout>;
export type CampusPayoutStatus = 'pending' | 'paid' | 'cancelled';

@Schema(schemaOptions('campus_payouts'))
export class CampusPayout {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  applicationId: string;

  @Prop({ type: String, required: true, index: true })
  ambassadorCode: string;

  @Prop({ type: String, required: true })
  ambassadorName: string;

  @Prop({ type: String, required: true })
  campusCode: string;

  @Prop({ type: Number, required: true })
  amountKobo: number;

  @Prop({ type: String, enum: ['pending', 'paid', 'cancelled'], default: 'pending', index: true })
  status: CampusPayoutStatus;

  @Prop({ type: String, default: null })
  reference: string | null;

  @Prop({ type: String, default: '' })
  note: string;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;
}

export const CampusPayoutSchema = SchemaFactory.createForClass(CampusPayout);
CampusPayoutSchema.index({ applicationId: 1, createdAt: -1 });
CampusPayoutSchema.index({ ambassadorCode: 1, status: 1 });
