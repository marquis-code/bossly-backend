import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ProvidersService } from './providers.service';
import { CreateProviderDto, UpdateProviderDto } from './provider.dto';

@ApiTags('Providers')
@ApiBearerAuth()
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string) {
    return this.providers.list(businessId);
  }

  @Post()
  @Permissions(PERMISSIONS.PROVIDERS_WRITE)
  create(@CurrentBusiness() businessId: string, @Body() dto: CreateProviderDto) {
    return this.providers.create(businessId, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.PROVIDERS_WRITE)
  update(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return this.providers.update(businessId, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.PROVIDERS_WRITE)
  remove(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.providers.remove(businessId, id);
  }
}
