import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Business, BusinessSchema } from '../businesses/business.schema';
import { Service, ServiceSchema } from '../services/service.schema';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';
import { CustomRequest, CustomRequestSchema } from './custom-request.schema';
import { CustomRequestsController } from './custom-requests.controller';
import { CustomRequestsService } from './custom-requests.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomRequest.name, schema: CustomRequestSchema },
      { name: Business.name, schema: BusinessSchema },
      { name: Service.name, schema: ServiceSchema },
    ]),
    BookingsModule, NotificationsModule, MailModule,
  ],
  controllers: [CustomRequestsController],
  providers: [CustomRequestsService],
  exports: [CustomRequestsService],
})
export class CustomRequestsModule {}
