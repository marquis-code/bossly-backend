import { Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CurrentBusiness, CurrentUser, Permissions } from '../../common/decorators/auth.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { PERMISSIONS } from '../../common/constants/permissions';
import type { AuthenticatedUser } from '../../common/types/auth.types';
import { CalendarService } from './calendar.service';
import type { CalendarProvider } from './calendar.schema';

@ApiTags('Calendar sync')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService, private readonly config: ConfigService) {}

  @Get('connections')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  status(@CurrentBusiness() businessId: string) {
    return this.calendar.status(businessId);
  }

  @Get(':provider/connect')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  connect(@CurrentBusiness() businessId: string, @CurrentUser() user: AuthenticatedUser, @Param('provider') provider: CalendarProvider) {
    return this.calendar.connectUrl(businessId, provider, user.id);
  }

  @Public()
  @Get(':provider/callback')
  async callback(@Param('provider') provider: CalendarProvider, @Query('code') code: string | undefined, @Query('state') state: string | undefined, @Res() res: Response) {
    const base = `${this.config.get('appUrl')}/app/settings?tab=calendar`;
    try {
      await this.calendar.handleCallback(provider, code, state);
      return res.redirect(`${base}&calendar=connected`);
    } catch (error) {
      const message = encodeURIComponent(error instanceof Error ? error.message : 'Calendar connection failed.');
      return res.redirect(`${base}&calendar=error&message=${message}`);
    }
  }

  @Post('sync')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  sync(@CurrentBusiness() businessId: string) {
    return this.calendar.sync(businessId);
  }

  @Delete(':provider')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  disconnect(@CurrentBusiness() businessId: string, @Param('provider') provider: CalendarProvider) {
    return this.calendar.disconnect(businessId, provider);
  }
}
