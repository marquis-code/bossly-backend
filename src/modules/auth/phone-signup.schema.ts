import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { schemaOptions } from '../../common/schemas/schema-options';

export type PhoneSignupDocument = HydratedDocument<PhoneSignup>;

@Schema(schemaOptions('phone_signups'))
export class PhoneSignup {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ type: String, required: true, unique: true, index: true })
  phone: string;

  @Prop({ type: String, required: true })
  codeHash: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  consumedAt: Date | null;

  @Prop({ type: String, default: '' })
  name: string;

  @Prop({ type: String, default: '' })
  businessName: string;

  @Prop({ type: String, default: null })
  email: string | null;

  @Prop({ type: String, default: 'other' })
  category: string;

  @Prop({ type: String, default: null })
  campus: string | null;

  @Prop({ type: String, default: null })
  ambassador: string | null;
}

export const PhoneSignupSchema = SchemaFactory.createForClass(PhoneSignup);
