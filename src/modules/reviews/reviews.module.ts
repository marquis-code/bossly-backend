import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { Review, ReviewSchema } from './review.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Business.name, schema: BusinessSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
