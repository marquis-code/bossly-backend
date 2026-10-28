import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, RescheduleBookingDto } from './booking.dto';

@ApiTags('Public bookings')
@Public()
@Controller('public/bookings')
export class PublicBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(':token')
  byToken(@Param('token') token: string) {
    return this.bookings.byToken(token);
  }

  @Post(':token/cancel')
  cancel(@Param('token') token: string, @Body() dto: CancelBookingDto) {
    return this.bookings.cancelPublic(token, dto);
  }

  @Post(':token/reschedule')
  reschedule(@Param('token') token: string, @Body() dto: RescheduleBookingDto) {
    return this.bookings.reschedulePublic(token, dto);
  }
}
