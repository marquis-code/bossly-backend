import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { ServicesService } from './services.service';
import { CreateServiceDto, UpdateServiceDto } from './service.dto';

@ApiTags('Services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @Permissions(PERMISSIONS.SERVICES_READ)
  list(@CurrentBusiness() businessId: string, @Query('includeInactive') includeInactive?: string) {
    return this.services.list(businessId, includeInactive !== 'false');
  }

  @Get('categories')
  @Permissions(PERMISSIONS.SERVICES_READ)
  categories(@CurrentBusiness() businessId: string) {
    return this.services.categories(businessId);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.SERVICES_READ)
  one(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.services.findOne(businessId, id);
  }

  @Post()
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  create(@CurrentBusiness() businessId: string, @Body() dto: CreateServiceDto) {
    return this.services.create(businessId, dto);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  update(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.services.update(businessId, id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  remove(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.services.remove(businessId, id);
  }
}
