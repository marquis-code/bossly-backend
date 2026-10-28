import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  @Get(':token/calendar.ics')
  async calendar(@Param('token') token: string, @Res() res: Response) {
    const file = await this.bookings.calendar(token);
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'no-store',
    }).send(file.content);
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
