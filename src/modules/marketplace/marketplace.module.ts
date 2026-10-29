import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { Review, ReviewSchema } from '../reviews/review.schema';
import { Service, ServiceSchema } from '../services/service.schema';
import { MarketplaceAdminController, MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';

@Module({
  imports: [MongooseModule.forFeature([
    { name: Business.name, schema: BusinessSchema },
    { name: Service.name, schema: ServiceSchema },
    { name: Review.name, schema: ReviewSchema },
    { name: Booking.name, schema: BookingSchema },
  ])],
  controllers: [MarketplaceController, MarketplaceAdminController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
