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
}

export const CampusApplicationSchema = SchemaFactory.createForClass(CampusApplication);
CampusApplicationSchema.index({ campusCode: 1, createdAt: -1 });
