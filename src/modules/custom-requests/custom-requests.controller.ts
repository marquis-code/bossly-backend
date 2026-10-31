import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { CustomRequestsService } from './custom-requests.service';
import { CreateCustomQuoteDto, CreateCustomRequestDto, CustomRequestMessageDto } from './custom-request.dto';

@ApiTags('Custom requests')
@Controller('custom-requests')
export class CustomRequestsController {
  constructor(private readonly requests: CustomRequestsService) {}

  @Public()
  @Post('public/:slug')
  create(@Param('slug') slug: string, @Body() dto: CreateCustomRequestDto) {
    return this.requests.createPublic(slug, dto);
  }

  @Public()
  @Get('public/:token')
  byToken(@Param('token') token: string) {
    return this.requests.byToken(token);
  }

  @Public()
  @Post('public/:token/messages')
  messagePublic(@Param('token') token: string, @Body() dto: CustomRequestMessageDto) {
    return this.requests.messagePublic(token, dto.body);
  }

  @Public()
  @Post('public/:token/accept')
  accept(@Param('token') token: string) {
    return this.requests.accept(token);
  }

  @ApiBearerAuth()
  @Get()
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string) {
    return this.requests.list(businessId);
  }

  @ApiBearerAuth()
  @Get(':id')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  one(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.requests.get(businessId, id);
  }

  @ApiBearerAuth()
  @Post(':id/quote')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  quote(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: CreateCustomQuoteDto) {
    return this.requests.quote(businessId, id, dto);
  }

  @ApiBearerAuth()
  @Post(':id/messages')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  message(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: CustomRequestMessageDto) {
    return this.requests.message(businessId, id, dto.body);
  }

  @ApiBearerAuth()
  @Patch(':id/decline')
  @Permissions(PERMISSIONS.BOOKINGS_WRITE)
  decline(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: { reason?: string }) {
    return this.requests.decline(businessId, id, dto.reason);
  }
}
