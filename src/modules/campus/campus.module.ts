import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { CampusAdminController, CampusController } from './campus.controller';
import { CampusService } from './campus.service';
import { CampusApplication, CampusApplicationSchema } from './campus.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: CampusApplication.name, schema: CampusApplicationSchema },
    { name: Business.name, schema: BusinessSchema },
  ])],
  controllers: [CampusController, CampusAdminController],
  providers: [CampusService],
  exports: [CampusService],
})
export class CampusModule {}
