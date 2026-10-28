import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentBusiness, Permissions } from '../../common/decorators/auth.decorators';
import { PERMISSIONS } from '../../common/constants/permissions';
import { PackagesService } from './packages.service';
import { CreateServicePackageDto, UpdateServicePackageDto } from './package.dto';

@ApiTags('Packages')
@Controller()
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @ApiBearerAuth()
  @Get('packages')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  list(@CurrentBusiness() businessId: string) {
    return this.packages.list(businessId);
  }

  @ApiBearerAuth()
  @Get('packages/purchases')
  @Permissions(PERMISSIONS.BOOKINGS_READ)
  purchases(@CurrentBusiness() businessId: string) {
    return this.packages.listPurchases(businessId);
  }

  @ApiBearerAuth()
  @Post('packages')
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  create(@CurrentBusiness() businessId: string, @Body() dto: CreateServicePackageDto) {
    return this.packages.create(businessId, dto);
  }

  @ApiBearerAuth()
  @Patch('packages/:id')
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  update(@CurrentBusiness() businessId: string, @Param('id') id: string, @Body() dto: UpdateServicePackageDto) {
    return this.packages.update(businessId, id, dto);
  }

  @ApiBearerAuth()
  @Delete('packages/:id')
  @Permissions(PERMISSIONS.SERVICES_WRITE)
  remove(@CurrentBusiness() businessId: string, @Param('id') id: string) {
    return this.packages.remove(businessId, id);
  }

  @Public()
  @Get('public/packages/:token')
  publicView(@Param('token') token: string) {
    return this.packages.publicByToken(token);
  }
}
