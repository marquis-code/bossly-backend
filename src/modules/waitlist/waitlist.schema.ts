import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type WaitlistDocument = HydratedDocument<WaitlistEntry>;
export type WaitlistStatus = 'waiting' | 'notified' | 'booked' | 'cancelled';

@Schema(schemaOptions('waitlist_entries'))
export class WaitlistEntry {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true, index: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: String, default: null })
  providerId: string | null;

  @Prop({ type: String, default: null })
  providerName: string | null;

  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: String, required: true, index: true })
  customerPhone: string;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: Date, required: true })
  preferredFrom: Date;

  @Prop({ type: Date, required: true })
  preferredTo: Date;

  @Prop({ type: Date, default: null })
  preferredStartAt: Date | null;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: String, enum: ['waiting', 'notified', 'booked', 'cancelled'], default: 'waiting', index: true })
  status: WaitlistStatus;

  @Prop({ type: Date, default: null })
  notifiedAt: Date | null;
}

export const WaitlistSchema = SchemaFactory.createForClass(WaitlistEntry);
WaitlistSchema.index({ businessId: 1, status: 1, preferredFrom: 1 });
WaitlistSchema.index({ businessId: 1, serviceId: 1, customerPhone: 1, status: 1 });
