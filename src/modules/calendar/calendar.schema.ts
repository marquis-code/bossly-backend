import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type CalendarConnectionDocument = HydratedDocument<CalendarConnection>;
export type CalendarProvider = 'google' | 'outlook';

@Schema(schemaOptions('calendar_connections'))
export class CalendarConnection {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, enum: ['google', 'outlook'], required: true })
  provider: CalendarProvider;

  @Prop({ type: String, required: true })
  accessToken: string;

  @Prop({ type: String, default: null })
  refreshToken: string | null;

  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ type: String, default: 'primary' })
  calendarId: string;

  @Prop({ type: Date, default: null })
  lastSyncAt: Date | null;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const CalendarConnectionSchema = SchemaFactory.createForClass(CalendarConnection);
CalendarConnectionSchema.index({ businessId: 1, provider: 1 }, { unique: true });

export type CalendarBusyBlockDocument = HydratedDocument<CalendarBusyBlock>;

@Schema(schemaOptions('calendar_busy_blocks'))
export class CalendarBusyBlock {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, enum: ['google', 'outlook'], required: true })
  provider: CalendarProvider;

  @Prop({ type: String, required: true })
  externalId: string;

  @Prop({ type: Date, required: true, index: true })
  startAt: Date;

  @Prop({ type: Date, required: true })
  endAt: Date;

  @Prop({ type: String, default: '' })
  title: string;
}

export const CalendarBusyBlockSchema = SchemaFactory.createForClass(CalendarBusyBlock);
CalendarBusyBlockSchema.index({ businessId: 1, startAt: 1, endAt: 1 });
CalendarBusyBlockSchema.index({ businessId: 1, provider: 1, externalId: 1 }, { unique: true });

export type CalendarEventDocument = HydratedDocument<CalendarEventLink>;

@Schema(schemaOptions('calendar_event_links'))
export class CalendarEventLink {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, index: true })
  businessId: string;

  @Prop({ type: String, enum: ['google', 'outlook'], required: true })
  provider: CalendarProvider;

  @Prop({ type: String, required: true, index: true })
  bookingId: string;

  @Prop({ type: String, required: true })
  externalId: string;
}

export const CalendarEventLinkSchema = SchemaFactory.createForClass(CalendarEventLink);
CalendarEventLinkSchema.index({ businessId: 1, provider: 1, bookingId: 1 }, { unique: true });
