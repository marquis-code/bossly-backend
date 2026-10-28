import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Booking, BookingSchema } from '../bookings/booking.schema';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarBusyBlock, CalendarBusyBlockSchema, CalendarConnection, CalendarConnectionSchema, CalendarEventLink, CalendarEventLinkSchema } from './calendar.schema';

@Module({
  imports: [MongooseModule.forFeature([
    { name: CalendarConnection.name, schema: CalendarConnectionSchema },
    { name: CalendarBusyBlock.name, schema: CalendarBusyBlockSchema },
    { name: CalendarEventLink.name, schema: CalendarEventLinkSchema },
    { name: Booking.name, schema: BookingSchema },
  ])],
  controllers: [CalendarController],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CalendarModule {}
