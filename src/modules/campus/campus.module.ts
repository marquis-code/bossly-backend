import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { CampusAdminController, CampusController, CampusPayoutAdminController } from './campus.controller';
import { CampusService } from './campus.service';
import { CampusApplication, CampusApplicationSchema, CampusPayout, CampusPayoutSchema } from './campus.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: CampusApplication.name, schema: CampusApplicationSchema },
    { name: CampusPayout.name, schema: CampusPayoutSchema },
    { name: Business.name, schema: BusinessSchema },
  ])],
  controllers: [CampusController, CampusAdminController, CampusPayoutAdminController],
  providers: [CampusService],
  exports: [CampusService],
})
export class CampusModule {}
