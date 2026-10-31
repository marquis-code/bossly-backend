import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type CustomRequestDocument = HydratedDocument<CustomRequest>;
export type CustomRequestStatus = 'new' | 'quoted' | 'accepted' | 'booked' | 'declined' | 'expired';
export type CustomRequestSender = 'customer' | 'business';

export interface CustomRequestQuoteItem { label: string; amountKobo: number; }
export interface CustomRequestQuote {
  items: CustomRequestQuoteItem[];
  serviceKobo: number;
  hairKobo: number;
  addOnKobo: number;
  totalKobo: number;
  depositKobo: number;
  durationMinutes: number;
  startAt: Date;
  slots: Date[];
  providerId: string | null;
  note: string;
  expiresAt: Date;
  createdAt: Date;
}
export interface CustomRequestMessage { sender: CustomRequestSender; name: string; body: string; createdAt: Date; redacted?: boolean; }

@Schema(schemaOptions('custom_requests'))
export class CustomRequest {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, required: true })
  serviceId: string;

  @Prop({ type: String, required: true })
  serviceName: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  publicToken: string;

  @Prop({ type: String, required: true })
  customerName: string;

  @Prop({ type: String, required: true })
  customerPhone: string;

  @Prop({ type: String, default: null })
  customerEmail: string | null;

  @Prop({ type: String, default: '' })
  style: string;

  @Prop({ type: String, default: '' })
  length: string;

  @Prop({ type: String, enum: ['vendor', 'client', 'not_sure'], default: 'not_sure' })
  hairOption: 'vendor' | 'client' | 'not_sure';

  @Prop({ type: String, default: '' })
  preferredDate: string;

  @Prop({ type: String, default: '' })
  preferredTime: string;

  @Prop({ type: Number, default: 0 })
  budgetKobo: number;

  @Prop({ type: String, default: '' })
  notes: string;

  @Prop({ type: [String], default: [] })
  referenceUrls: string[];

  @Prop({ type: [String], default: [] })
  referenceImages: string[];

  @Prop({ type: String, enum: ['new', 'quoted', 'accepted', 'booked', 'declined', 'expired'], default: 'new', index: true })
  status: CustomRequestStatus;

  @Prop({ type: Object, default: null })
  quote: CustomRequestQuote | null;

  @Prop({ type: [Object], default: [] })
  messages: CustomRequestMessage[];

  @Prop({ type: String, default: null })
  bookingId: string | null;

  @Prop({ type: String, default: null })
  bookingPublicToken: string | null;

  @Prop({ type: Date, default: null })
  acceptedAt: Date | null;

  @Prop({ type: Date, default: null })
  declinedAt: Date | null;
}

export const CustomRequestSchema = SchemaFactory.createForClass(CustomRequest);
CustomRequestSchema.index({ businessId: 1, status: 1, createdAt: -1 });
